# Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
#
# This file is a part of `hoardy-web` project.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.

import abc as _abc
import cbor2 as _cbor2
import dataclasses as _dc
import gzip as _gzip
import hashlib as _hashlib
import io as _io
import os as _os
import sys as _sys
import time as _time
import typing as _t
import urllib.parse as _up

from decimal import Decimal
from gettext import gettext

from kisstdlib.exceptions import *
from kisstdlib.io.stdio import *
from kisstdlib.path import *

from .util import *
from .time import *
from .tracking import *
from .linst import *
from .source import *
from .web import *

class RRCommon:
    _dtc : dict[SniffContentType, DiscernContentType]

    def discern_content_type(self, sniff : SniffContentType) -> DiscernContentType:
        """Run `mime.discern_content_type` on this."""
        try:
            return self._dtc[sniff]
        except KeyError:
            pass
        except AttributeError:
            self._dtc = {}

        ct, do_sniff = self.get_content_type() # type: ignore
        if do_sniff and sniff == SniffContentType.NONE:
            sniff = SniffContentType.FORCE
        res = discern_content_type(ct, sniff, self.body) # type: ignore

        self._dtc[sniff] = res
        return res

@_dc.dataclass
class Request(RRCommon):
    started_at : TimeStamp
    method : str
    url : ParsedURL
    headers : Headers
    complete : bool
    body : bytes | str

    def approx_size(self) -> int:
        return 56 + 2 * len(self.url.raw_url) + len(self.body) \
            + sum(map(lambda x: len(x[0]) + len(x[1]), self.headers))

    def get_content_type(self) -> tuple[str, bool]:
        ct = get_header_value(self.headers, "content-type", "application/x-www-form-urlencoded")
        assert ct is not None
        return ct, False

@_dc.dataclass
class Response(RRCommon):
    started_at : TimeStamp
    code : int
    reason : str
    headers : Headers
    complete : bool
    body : bytes | str

    def approx_size(self) -> int:
        return 56 + len(self.body) \
            + sum(map(lambda x: len(x[0]) + len(x[1]), self.headers))

    def get_content_type(self) -> tuple[str, bool]:
        ct = get_header_value(self.headers, "content-type", "application/octet-stream")
        ct_opts = get_header_value(self.headers, "x-content-type-options", "")
        if ct_opts == "nosniff" or ct_opts == "no-sniff":
            sniff = False
        else:
            sniff = True
        return ct, sniff

@_dc.dataclass
class WebSocketFrame:
    sent_at : TimeStamp
    from_client : bool
    opcode : int
    content : bytes

    def approx_size(self) -> int:
        return 40 + len(self.content)

Reqres_fields = {
    "version": "WEBREQRES format version; int",
    "agent": "`+`-separated list of applications that produced this reqres; str",
    "protocol": 'protocol; e.g. `"HTTP/1.1"`, `"HTTP/2.0"`; str',
    "request.started_at": "request start time in seconds since 1970-01-01 00:00; TimeStamp",
    "request.method": 'request `HTTP` method; e.g. `"GET"`, `"POST"`, etc; str',
    "request.url": "request URL, including the `fragment`/hash part; str",
    "request.headers": "request headers; list[tuple[str, bytes]]",
    "request.complete": "is request body complete?; bool",
    "request.body": "request body; bytes",
    "response.started_at": "response start time in seconds since 1970-01-01 00:00; TimeStamp",
    "response.code": "`HTTP` response code; e.g. `200`, `404`, etc; int",
    "response.reason": '`HTTP` response reason; e.g. `"OK"`, `"Not Found"`, etc; usually empty for Chromium and filled for Firefox; str',
    "response.headers": "response headers; list[tuple[str, bytes]]",
    "response.complete": "is response body complete?; bool",
    "response.body": "response body; Firefox gives raw bytes, Chromium gives UTF-8 encoded strings; bytes | str",
    "finished_at": "request completion time in seconds since 1970-01-01 00:00; TimeStamp",
    "websocket": "a list of WebSocket frames",
}

@_dc.dataclass
class Reqres:
    version : int
    agent : str
    protocol : str
    request : Request
    response : _t.Optional[Response]
    finished_at : TimeStamp
    extra : dict[str, _t.Any]
    websocket : _t.Optional[list[WebSocketFrame]]
    _approx_size : int = 0

    def _resize(self) -> int:
        self._approx_size = res = 128 + \
            self.request.approx_size() + \
            (self.response.approx_size() if self.response is not None else 0) + \
            (sum(map(lambda x: x.approx_size(), self.websocket)) if self.websocket is not None else 0)
        return res

    def approx_size(self) -> int:
        if self._approx_size == 0:
            return self._resize()
        return self._approx_size

Reqres_url_schemes = frozenset(["http", "https", "ftp", "ftps", "ws", "wss"])

class WRRParsingError(Failure): pass
class WRRTypeError(WRRParsingError): pass

def _t_bool(n : str, x : _t.Any) -> bool:
    if isinstance(x, bool): return x
    raise WRRTypeError(gettext("Reqres field `%s`: wrong type: want %s, got %s"), n, "bool", type(x).__name__)

def _t_bytes(n : str, x : _t.Any) -> bytes:
    if isinstance(x, bytes): return x
    raise WRRTypeError(gettext("Reqres field `%s`: wrong type: want %s, got %s"), n, "bytes", type(x).__name__)

def _t_str(n : str, x : _t.Any) -> str:
    if isinstance(x, str): return x
    raise WRRTypeError(gettext("Reqres field `%s`: wrong type: want %s, got %s"), n, "str", type(x).__name__)

def _t_bytes_or_str(n : str, x : _t.Any) -> bytes | str:
    if isinstance(x, bytes): return x
    if isinstance(x, str): return x
    raise WRRTypeError(gettext("Reqres field `%s`: wrong type: want %s or %s, got %s"), n, "bytes", "str", type(x).__name__)

def _t_int(n : str, x : _t.Any) -> int:
    if isinstance(x, int): return x
    raise WRRTypeError(gettext("Reqres field `%s`: wrong type: want %s, got %s"), n, "int", type(x).__name__)

def _t_timestamp(n : str, x : _t.Any) -> TimeStamp:
    return TimeStamp(Decimal(_t_int(n, x)) / 1000)

def _f_timestamp(x : TimeStamp) -> int:
    return int(x * 1000)

def _t_headers(n : str, x : _t.Any) -> Headers:
    if Headers.__instancecheck__(x):
        return _t.cast(Headers, x)
    raise WRRTypeError(gettext("Reqres field `%s`: wrong type: want %s, got %s"), "Headers", type(x).__name__)

def wrr_load_cbor_struct(data : _t.Any) -> Reqres:
    if not isinstance(data, list):
        raise WRRParsingError(gettext("Reqres parsing failure: wrong spine"))
    elif len(data) == 7 and data[0] == "WEBREQRES/1":
        _, agent, protocol, request_, response_, finished_at, extra = data
        rq_started_at, rq_method, rq_url, rq_headers, rq_complete, rq_body = request_
        purl = parse_url(_t_str("request.url", rq_url))
        if purl.scheme not in Reqres_url_schemes:
            raise WRRParsingError(gettext("Reqres field `request.url`: unsupported URL scheme `%s`"), purl.scheme)
        request = Request(_t_timestamp("request.started_at", rq_started_at),
                          _t_str("request.method", rq_method),
                          purl,
                          _t_headers("request.headers", rq_headers),
                          _t_bool("request.complete", rq_complete),
                          _t_bytes_or_str("request.body", rq_body))
        if response_ is None:
            response = None
        else:
            rs_started_at, rs_code, rs_reason, rs_headers, rs_complete, rs_body = response_
            response = Response(_t_timestamp("response.started_at", rs_started_at),
                                _t_int("response.code", rs_code),
                                _t_str("responese.reason", rs_reason),
                                _t_headers("responese.headers", rs_headers),
                                _t_bool("response.complete", rs_complete),
                                _t_bytes_or_str("responese.body", rs_body))

        try:
            wsframes = extra["websocket"]
        except KeyError:
            websocket = None
        else:
            del extra["websocket"]
            websocket = []
            for frame in wsframes:
                sent_at, from_client, opcode, content = frame
                websocket.append(WebSocketFrame(_t_timestamp("ws.sent_at", sent_at),
                                                _t_bool("ws.from_client", from_client),
                                                _t_int("ws.opcode", opcode),
                                                _t_bytes("ws.content", content)))

        return Reqres(1, agent, protocol, request, response, _t_timestamp("finished_at", finished_at), extra, websocket)
    else:
        raise WRRParsingError(gettext("Reqres parsing failure: unknown format `%s`"), data[0])

def wrr_load_cbor_fileobj(fobj : _io.BufferedReader) -> Reqres:
    try:
        struct = _cbor2.load(fobj)
    except _cbor2.CBORDecodeValueError:
        raise WRRParsingError(gettext("CBOR parsing failure"))

    return wrr_load_cbor_struct(struct)

def wrr_load(fobj : _io.BufferedReader) -> Reqres:
    fobj = ungzip_fileobj_maybe(fobj)
    if fobj.peek(1) == b"":
        raise WRRParsingError(gettext("expected CBOR data, got EOF"))
    reqres = wrr_load_cbor_fileobj(fobj)
    p = fobj.peek(1)
    if p != b"":
        # there's some junk after the end of the Reqres structure
        raise WRRParsingError(gettext("expected EOF, got `%s`"), p)
    return reqres

def wrr_bundle_load(fobj : _io.BufferedReader) -> _t.Iterator[Reqres]:
    fobj = ungzip_fileobj_maybe(fobj)
    while True:
        if fobj.peek(1) == b"": break
        yield wrr_load_cbor_fileobj(fobj)

def wrr_loadf(path : _t.AnyStr) -> Reqres:
    with open(path, "rb") as f:
        return wrr_load(f)

def wrr_dumps(reqres : Reqres, compress : bool = True) -> bytes:
    req = reqres.request
    request = _f_timestamp(req.started_at), req.method, req.url.raw_url, req.headers, req.complete, req.body
    del req

    if reqres.response is None:
        response = None
    else:
        res = reqres.response
        response = _f_timestamp(res.started_at), res.code, res.reason, res.headers, res.complete, res.body
        del res

    extra = reqres.extra
    if reqres.websocket is not None:
        extra = extra.copy()
        wsframes = []
        for frame in reqres.websocket:
            wsframes.append([_f_timestamp(frame.sent_at), frame.from_client, frame.opcode, frame.content])
        extra["websocket"] = wsframes

    structure = ["WEBREQRES/1", reqres.agent, reqres.protocol, request, response, _f_timestamp(reqres.finished_at), extra]

    data = _cbor2.dumps(structure)
    if compress:
        data = gzip_maybe(data)
    return data

def wrr_dump(fobj : _io.BufferedWriter, reqres : Reqres, compress : bool = True) -> None:
    fobj.write(wrr_dumps(reqres, compress))

ReqresExpr_derived_attrs = {
    "fs_path": "file system path for the WRR file containing this reqres; str | bytes | None",

    "raw_url": "aliast for `request.url`; str",
    "method": "aliast for `request.method`; str",

    "qtime": 'aliast for `request.started_at`; mnemonic: "reQuest TIME"; seconds since UNIX epoch; TimeStamp',
    "qtime_ms": "`qtime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch; int",
    "qtime_msq": "three least significant digits of `qtime_ms`; int",
    "qyear": "year number of `gmtime(qtime)` (UTC year number of `qtime`); int",
    "qmonth": "month number of `gmtime(qtime)`; int",
    "qday": "day of the month of `gmtime(qtime)`; int",
    "qhour": "hour of `gmtime(qtime)` in 24h format; int",
    "qminute": "minute of `gmtime(qtime)`; int",
    "qsecond": "second of `gmtime(qtime)`; int",

    "stime": '`response.started_at` if there was a response, `finished_at` otherwise; mnemonic: "reSponse TIME"; seconds since UNIX epoch; TimeStamp',
    "stime_ms": "`stime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch; int",
    "stime_msq": "three least significant digits of `stime_ms`; int",
    "syear": "similar to `qyear`, but for `stime`; int",
    "smonth": "similar to `qmonth`, but for `stime`; int",
    "sday": "similar to `qday`, but for `stime`; int",
    "shour": "similar to `qhour`, but for `stime`; int",
    "sminute": "similar to `qminute`, but for `stime`; int",
    "ssecond": "similar to `qsecond`, but for `stime`; int",

    "ftime": "aliast for `finished_at`; seconds since UNIX epoch; TimeStamp",
    "ftime_ms": "`ftime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch; int",
    "ftime_msq": "three least significant digits of `ftime_ms`; int",
    "fyear": "similar to `qyear`, but for `ftime`; int",
    "fmonth": "similar to `qmonth`, but for `ftime`; int",
    "fday": "similar to `qday`, but for `ftime`; int",
    "fhour": "similar to `qhour`, but for `ftime`; int",
    "fminute": "similar to `qminute`, but for `ftime`; int",
    "fsecond": "similar to `qsecond`, but for `ftime`; int",
}

ReqresExpr_url_attrs = {
    "net_url": "a variant of `raw_url` that uses Punycode UTS46 IDNA encoded `net_hostname`, has all unsafe characters of `raw_path` and `raw_query` quoted, and comes without the `fragment`/hash part; this is the URL that actually gets sent to an `HTTP` server when you request `raw_url`; str",
    "url": "`net_url` with `fragment`/hash part appended; str",
    "pretty_net_url": "a variant of `raw_url` that uses UNICODE IDNA `hostname` without Punycode, minimally quoted `mq_path` and `mq_query`, and comes without the `fragment`/hash part; this is a human-readable version of `net_url`; str",
    "pretty_url": "`pretty_net_url` with `fragment`/hash part appended; str",
    "pretty_net_nurl": "a variant of `pretty_net_url` that uses `mq_npath` instead of `mq_path` and `mq_nquery` instead of `mq_query`; i.e. this is `pretty_net_url` with normalized path and query; str",
    "pretty_nurl": "`pretty_net_nurl` with `fragment`/hash part appended; str",
    "scheme": "scheme part of `raw_url`; e.g. `http`, `https`, etc; str",
    "raw_hostname": "hostname part of `raw_url` as it is recorded in the reqres; str",
    "net_hostname": "hostname part of `raw_url`, encoded as Punycode UTS46 IDNA; this is what actually gets sent to the server; ASCII str",
    "hostname": "`net_hostname` decoded back into UNICODE; this is the canonical hostname representation for which IDNA-encoding and decoding are bijective; UNICODE str",
    "rhostname": '`hostname` with the order of its parts reversed; e.g. `"www.example.org"` -> `"com.example.www"`; str',
    "port": 'port part of `raw_url`; str',
    "netloc": "netloc part of `raw_url`; i.e., in the most general case, `<username>:<password>@<hostname>:<port>`; str",
    "raw_path": 'raw path part of `raw_url` as it is recorded is the reqres; e.g. `"https://www.example.org"` -> `""`, `"https://www.example.org/"` -> `"/"`, `"https://www.example.org/index.html"` -> `"/index.html"`; str',
    "path_parts": 'component-wise unquoted "/"-split `raw_path`; list[str]',
    "path": "`path_parts` turned back into a quoted string, i.e. `raw_path` normalized like browsers do it; str",
    "npath_parts": '`path_parts` with empty components removed and dots and double dots interpreted away; e.g. `"https://www.example.org"` -> `[]`, `"https://www.example.org/"` -> `[]`, `"https://www.example.org/index.html"` -> `["index.html"]` , `"https://www.example.org/skipped/.//../used/"` -> `["used"]`; list[str]',
    "mq_path": "`path_parts` turned back into a minimally-quoted string; str",
    "mq_npath": "`npath_parts` turned back into a minimally-quoted string; str",
    "raw_query": "query part of `raw_url`, i.e. everything after the `?` character and before the `#` character; str",
    "query_parts": "parsed and component-wise unquoted `raw_query`; list[tuple[str, str | None]]",
    "query": "`query_parts` turned back into a quoted string, i.e. `raw_query` normalized like browsers do it; str",
    "query_nparts": "`query_parts` with empty query parameters removed; list[tuple[str, str]]",
    "mq_query": "`query_parts` turned back into a minimally-quoted string appropriate for use in filenames; str",
    "mq_nquery": "`query_ne_parts` turned back into a minimally-quoted string appropriate for use in filenames; str",
    "oqm": "optional query mark: `?` character if `query` is non-empty, an empty string otherwise; str",
    "fragment": "fragment (hash) part of the url; str",
    "ofm": "optional fragment mark: `#` character if `fragment` is non-empty, an empty string otherwise; str",
}
ReqresExpr_derived_attrs.update(ReqresExpr_url_attrs)
ReqresExpr_derived_attrs.update({
    "status": '`"I"` or  `"C"` for `request.complete` (`I` for `false` , `C` for `true`) followed by either `"N"` when `response is None`, or `str(response.code)` followed by `"I"` or  `"C"` for `response.complete`; e.g. `C200C` (all "OK"), `CN` (request was sent, but it got no response), `I200C` (partial request with complete "OK" response), `C200I` (complete request with incomplete response, e.g. if download was interrupted), `C404C` (complete request with complete "Not Found" response), etc; str',

    "request_mime": "`request.body` `MIME` type, note the underscore, this is not a field of `request`, this is a derived value that depends on `request` `Content-Type` header and `--sniff*` settings; str or None",
    "response_mime": "`response.body` `MIME` type, note the underscore, this is not a field of `response`, this is a derived value that depends on `response` `Content-Type` header and `--sniff*` settings; str or None",

    "filepath_parts": '`npath_parts` transformed into components usable as an exportable file name; i.e. `npath_parts` with an optional additional `"index"` appended, depending on `raw_url` and `response_mime`; extension will be stored separately in `filepath_ext`; e.g. for `HTML` documents `"https://www.example.org/"` -> `["index"]`, `"https://www.example.org/test.html"` -> `["test"]`, `"https://www.example.org/test"` -> `["test", "index"]`, `"https://www.example.org/test.json"` -> `["test.json", "index"]`, but if it has a `JSON` `MIME` type then `"https://www.example.org/test.json"` -> `["test"]` (and `filepath_ext` will be set to `".json"`); this is similar to what `wget -mpk` does, but a bit smarter; list[str]',
    "filepath_ext": 'extension of the last component of `filepath_parts` for recognized `MIME` types, `".data"` otherwise; str',
})

def _parse_rt(opt : str) -> RemapType:
    x = opt[:1]
    if x == "+":
        return RemapType.ID
    elif x == "-":
        return RemapType.VOID
    elif x == "*":
        return RemapType.OPEN
    elif x == "/":
        return RemapType.CLOSED
    elif x == "&":
        return RemapType.FALLBACK
    raise CatastrophicFailure("unknown `scrub` option `%s`", opt)

def linst_scrub() -> LinstAtom:
    def func(part : str, optstr : str) -> _t.Callable[..., LinstFunc]:
        rere = check_request_response("scrub", part)

        scrub_opts = ScrubbingOptions()
        if optstr != "defaults":
            for opt in optstr.split(","):
                oname = opt[1:]

                if oname in ScrubbingReferenceOptions:
                    rtvalue = _parse_rt(opt)
                    setattr(scrub_opts, oname, rtvalue)
                    continue
                elif oname == "all_refs":
                    rtvalue = _parse_rt(opt)
                    for oname in ScrubbingReferenceOptions:
                        setattr(scrub_opts, oname, rtvalue)
                    continue

                value = opt.startswith("+")
                if not value and not opt.startswith("-"):
                    raise CatastrophicFailure("unknown `scrub` option `%s`", opt)

                if oname == "pretty":
                    scrub_opts.whitespace = not value
                    scrub_opts.indent = value
                elif oname == "debug" and value == True:
                    scrub_opts.verbose = True
                    scrub_opts.whitespace = False
                    scrub_opts.indent = True
                    scrub_opts.debug = True
                elif oname in ScrubbingOptions.__dataclass_fields__:
                    setattr(scrub_opts, oname, value)
                elif oname == "all_dyns":
                    for oname in ScrubbingDynamicOpts:
                        setattr(scrub_opts, oname, value)
                else:
                    raise CatastrophicFailure("unknown `scrub` option `%s`", opt)

        scrubbers = make_scrubbers(scrub_opts)

        def envfunc(rrexpr : _t.Any, v : _t.Any) -> _t.Any:
            rrexpr = check_rrexpr("scrub", rrexpr)

            reqres : Reqres = rrexpr.reqres
            request = reqres.request

            rere_obj : Request | Response
            if rere:
                rere_obj = request
            elif reqres.response is None:
                return ""
            else:
                rere_obj = reqres.response

            if len(rere_obj.body) == 0:
                return rere_obj.body

            kinds : set[str]
            kinds, mime, charset, _ = rere_obj.discern_content_type(rrexpr.sniff)

            censor = []
            if not scrub_opts.scripts and "javascript" in kinds:
                censor.append("JavaScript")
            if not scrub_opts.styles and "css" in kinds:
                censor.append("CSS")
            if (not scrub_opts.scripts or not scrub_opts.styles) and "dyndoc" in kinds:
                # PDF, PostScript, EPub
                censor.append("dynamic document")
            if not scrub_opts.unknown and "unknown" in kinds:
                censor.append("unknown data")

            if len(censor) > 0:
                what = ", or ".join(censor)
                return f"/* hoardy censored out {what} blob ({mime}) from here */\n" if scrub_opts.verbose else b""

            if "html" in kinds:
                return scrub_html(scrubbers, rrexpr.net_url, rrexpr.remap_url, rere_obj.headers, rere_obj.body, charset)
            elif "css" in kinds:
                return scrub_css(scrubbers, rrexpr.net_url, rrexpr.remap_url, rere_obj.headers, rere_obj.body, charset)
            else:
                # no scrubbing needed
                return rere_obj.body

        return envfunc
    return [str, str], func

def _scrub_to(x : str) -> str:
    return "this is only supported when `scrub` is used with `mirror` sub-command; under other sub-commands this is equivalent to `%s`" % (x,)
_in_out = "should be kept in or censored out"

ReqresExpr_atoms = linst_atoms.copy()
ReqresExpr_atoms.update({
    "parse_path": ("parse a URL path component `str` into `path_parts` `list`",
        linst_apply0(lambda v: parse_path(v))),
    "unparse_path": ("encode `path_parts` `list` into a URL path component `str`",
        linst_apply0(lambda v: unparse_path(v))),
    "parse_query": ("parse a URL query component `str` into `query_parts` `list`",
        linst_apply0(lambda v: parse_query(v))),
    "unparse_query": ("encode `query_parts` `list` into a URL query component `str`",
        linst_apply0(lambda v: unparse_query(v))),
    "pp_to_path": ("encode `*path_parts` `list` into a POSIX path, quoting as little as needed",
        linst_apply0(lambda v: pp_to_path(v))),
    "qsl_to_path": ("encode `query_parts` `list` into a POSIX path, quoting as little as needed",
        linst_apply0(lambda v: qsl_to_path(v))),
    "scrub": (f"""scrub the value by optionally rewriting links and/or removing dynamic content from it; what gets done depends on the `MIME` type of the value itself and the scrubbing options described below; this function takes two arguments:
  - the first must be either of `request|response`, it controls which `HTTP` headers `scrub` should inspect to help it detect the `MIME` type;
  - the second is either `defaults` or ","-separated string of tokens which control the scrubbing behaviour:
    - `(+|-|*|/|&)jumps` controls how jump-links (`a href`, `area href`, and similar `HTML` tag attributes) should be remapped or censored out:
      - `+` rewrites their values into full URLs, e.g. `<a href="/path?query">` -> `<a href="https://example.org/path?query">`;
      - `-` "voids" all of them, i.e. rewrites them to `javascript:void(0)` and empty `data:` URLs;
      - `*` rewrites links in an "open"-ended way, i.e. points them to locally mirrored versions of their URLs when available and leaves them pointing to their original URL otherwise; {_scrub_to("+")};
      - `/` rewrites links in a "close"-ended way, i.e. points them to locally mirrored versions of their URLs when available and voids them otherwise; {_scrub_to("-")};
      - `&` rewrites links in a "close"-ended way like `/` does, except this option uses fallbacks to remap unavailable URLs whenever possible; {_scrub_to("-")}; see the documentation of the `--remap-all` option for more info;
    - `(+|-|*|/|&)actions` controls how action-links (`a ping`, `form action`, and similar `HTML` tag attributes) should be remapped or censored out; same rewrite options as above;
    - `(+|-|*|/|&)reqs` controls how references to page requisites (`img src`, `iframe src`, and similar `HTML` tag attributes, as well as `link src` attributes which have `rel` attribute of their `HTML` tag set to `stylesheet` or `icon`, `CSS` `url` references, etc) should be remapped or censored out; same rewrite options as above;
    - `(+|-|*|/|&)all_refs` is equivalent to setting all of `jumps`, `actions`, and `reqs` simultaneously;
    - `(+|-)styles` controls whether `CSS` stylesheets (both separate files and `HTML` tags and attributes) {_in_out};
    - `(+|-)scripts` controls whether `JavaScript` (both separate files and `HTML` tags and attributes) {_in_out};
    - `(+|-)iepragmas` controls whether Internet Explorer's `HTML` pragmas {_in_out};
    - `(+|-)iframes` controls whether `<iframe>` `HTML` tags {_in_out};
    - `(+|-)prefetches` controls whether `HTML` content prefetch `link` tags {_in_out};
    - `(+|-)tracking` controls whether other tracking `HTML` tags and attributes (like `a ping`) {_in_out};
    - `(+|-)navigations` controls whether automatic navigations (`Refresh` `HTTP` headers and `<meta http-equiv>` `HTML` tags) {_in_out};
    - `(+|-)all_dyns` is equivalent to setting all of `styles`, `scripts`, `iepragmas`, `iframes`, `prefetches`, `tracking`, and `navigations` simultaneously;
    - `(+|-)inline_headers` controls whether certain `HTTP` headers (`Content-Security-Policy`, `Default-Style`, `Link`, `Refresh`, and `X-UA-Compatible`) should be inlined as `<meta http-equiv=*>` `HTML` tags;
       `scrub` will then interpret the contents of and process those tags as usual, as if they were present in the document to begin with;
    - `(+|-)inline_fallback_icon` controls whether `<link rel="icon" href="/favicon.ico">` `HTML` tag browsers use as a fallback when a page does not declare any icons should be made explicit and inlined into the result; that URL will then get remapped like a normal page requisite using `reqs` and the tag will not be added if that `/favicon.ico` URL gets remapped into void;
    - `(+|-)interpret_noscript` controls whether the contents of `noscript` tags should be inlined when `-scripts` is set;
    - `(+|-)unknown` controls if the data with unknown content types should passed to the output unchanged or censored out (respectively);
    - `(+|-)verbose` controls whether tag censoring controlled by the above options is to be reported in the output (as comments) or stuff should be wiped from existence without evidence instead;
    - `(+|-)whitespace` controls whether `HTML` and `CSS` renderers should keep the original whitespace as-is or collapse it away;
    - `(+|-)optional_tags` controls whether `HTML` renderer should put optional `HTML` tags into the output or skip them;
    - `(+|-)indent` controls whether `HTML` and `CSS` renderers should indent their outputs (where whitespace placement in the original markup allows for it) or not;
    - `+pretty` is an alias for `-whitespace,+indent` which produces the prettiest possible human-readable output that keeps the original whitespace semantics;
    - `-pretty` is an alias for `+whitespace,-indent` which produces the approximation of the original markup with censoring applied;
    - `+debug` is a variant of `+pretty` that also uses a much more aggressive version of `indent` that ignores the semantics of original whitespace placement, i.e. it indents `<p>not<em>sep</em>arated</p>` as if there was whitespace before and after `p`, `em`, `/em`, and `/p` tags; this is useful for debugging;
    - `-debug` is a noop;
  - the `defaults` are:
    - `*jumps,&actions,&reqs`, because these produce a self-contained result that can be fed into another tool --- be it a web browser or `pandoc` --- without that tool trying to access the Internet;
    - `-prefetches,-tracking,-navigations`, because these ensure the result will not try to prefetch or track anything, or re-navigate elsewhere, when loaded in a web browser;
    - `+styles,+iframes`, because these are are `scrub`bed properly;
    - `-scripts`, because `scrub`bing of `JavaScript` (code whitelisting) is not supported yet;
    - `-iepragmas`, because censoring of contents of such pragmas is not supported yet;
    - `+inline_headers`, because otherwise the result won't be self-contained;
    - `+inline_fallback_icon` when `reqs` is `/` or `&`, `-interpret_favicon` otherwise;
       i.e., by default, `scrub` inlines fallback favicons if they remap to something non-void and keep the result self-contained;
    - `+interpret_noscript`, because this usually helps;
    - `+verbose`, because this allows you to inspect the generated output and see what `hoardy-web` did to it, i.e., this minimizes surprises;
    - `+whitespace,-indent`, to keep the output as close to the original as possible;
    - `+optional_tags`, because many tools fail to parse minimized `HTML` properly;
    - `+unknown` which keeps data of unknown content `MIME` types as-is;
  - note however, that most `--remap-*` options set different defaults;
""",
        linst_scrub()),
})

ReqresExpr_lookup = linst_custom_or_env(ReqresExpr_atoms)

ReqresExpr_time_attrs = frozenset(["time", "time_ms", "time_msq", "year", "month", "day", "hour", "minute", "second"])

@_dc.dataclass
class ReqresExpr(DeferredSource, LinstEvaluator, _t.Generic[DeferredSourceType]):
    source : DeferredSourceType

    _reqres : Reqres | None

    sniff : SniffContentType = _dc.field(default=SniffContentType.NONE)
    remap_url : URLRemapperType | None = _dc.field(default = None)

    _original : _t.Any | None = _dc.field(default = None)
    _approx_size : int = _dc.field(default = 0)

    def __post_init__(self) -> None:
        LinstEvaluator.__init__(self, ReqresExpr_lookup)
        mem.consumption += self._resize()

    def __del__(self) -> None:
        mem.consumption -= self._approx_size

    def _resize(self) -> int:
        self._approx_size = res = 128 + \
            (self.source.approx_size() if self.source is not None else 0) + \
            (self._reqres._resize() if self._reqres is not None else 0) + \
            sum(map(lambda k: len(k) + 16, self.values.keys()))
        return res

    def approx_size(self) -> int:
        return self._approx_size

    @property
    def reqres(self) -> Reqres:
        reqres = self._reqres
        if reqres is not None:
            return reqres

        source = self.source
        if isinstance(self.source, FileSource):
            with source.get_fileobj() as f:
                reqres = wrr_load(f)
        else:
            raise NotImplementedError()

        self._reqres = reqres
        mem.consumption -= self._approx_size - self._resize()
        return reqres

    def unload(self, completely : bool = True) -> None:
        if isinstance(self.source, FileSource):
            # this `reqres` is cheap to re-load
            self._reqres = None
        if completely:
            self.values = dict()
        mem.consumption -= self._approx_size - self._resize()

    def show_source(self) -> str:
        return self.source.show_source()

    def get_fileobj(self) -> _io.BufferedReader:
        return BytesIOReader(wrr_dumps(self.reqres))

    def same_as(self, other : DeferredSource) -> bool:
        if isinstance(other, ReqresExpr):
            return self.source.same_as(other.source)
        return self.source.same_as(other)

    def replaces(self, other : DeferredSource) -> bool:
        if isinstance(other, ReqresExpr):
            return self.source.replaces(other.source)
        return self.source.replaces(other)

    def _fill_time(self, prefix : str, ts : TimeStamp) -> None:
        dt = _time.gmtime(int(ts))
        self.values[prefix + "year"] = dt.tm_year
        self.values[prefix + "month"] = dt.tm_mon
        self.values[prefix + "day"] = dt.tm_mday
        self.values[prefix + "hour"] = dt.tm_hour
        self.values[prefix + "minute"] = dt.tm_min
        self.values[prefix + "second"] = dt.tm_sec

    def get_attr(self, name : str) -> _t.Any:
        if name == "fs_path":
            if isinstance(self.source, FileSource):
                return self.source.path
            else:
                return None

        reqres = self.reqres
        if name == "method":
            self.values[name] = reqres.request.method
        elif name == "raw_url" or name == "request.url":
            self.values[name] = reqres.request.url.raw_url
        elif (name.startswith("q") and \
              name[1:] in ReqresExpr_time_attrs):
            qtime = reqres.request.started_at
            qtime_ms = int(qtime * 1000)
            self.values["qtime"] = qtime
            self.values["qtime_ms"] = qtime_ms
            self.values["qtime_msq"] = qtime_ms % 1000
            self._fill_time("q", qtime)
        elif (name.startswith("s") and \
              name[1:] in ReqresExpr_time_attrs) or \
              name == "status":
            if reqres.request.complete:
                status = "C"
            else:
                status = "I"
            if reqres.response is not None:
                stime = reqres.response.started_at
                status += str(reqres.response.code)
                if reqres.response.complete:
                    status += "C"
                else:
                    status += "I"
            else:
                stime = reqres.finished_at
                status += "N"
            stime_ms = int(stime * 1000)
            self.values["status"] = status
            self.values["stime"] = stime
            self.values["stime_ms"] = stime_ms
            self.values["stime_msq"] = stime_ms % 1000
            self._fill_time("s", stime)
        elif (name.startswith("f") and \
              name[1:] in ReqresExpr_time_attrs):
            ftime = reqres.finished_at
            ftime_ms = int(ftime * 1000)
            self.values["ftime"] = ftime
            self.values["ftime_ms"] = ftime_ms
            self.values["ftime_msq"] = ftime_ms % 1000
            self._fill_time("f", ftime)
        elif name == "request_mime":
            _, cmime, _, _= reqres.request.discern_content_type(self.sniff)
            self.values[name] = cmime
        elif name == "response_mime":
            if reqres.response is None:
                cmime = None
            else:
                _, cmime, _, _= reqres.response.discern_content_type(self.sniff)
            self.values[name] = cmime
        elif name == "filepath_parts" or name == "filepath_ext":
            if reqres.response is not None:
                _, _, _, extensions = reqres.response.discern_content_type(self.sniff)
            else:
                extensions = []
            parts, ext = reqres.request.url.filepath_parts_ext("index", extensions)
            self.values["filepath_parts"] = parts
            self.values["filepath_ext"] = ext
        elif name in ReqresExpr_url_attrs:
            self.values[name] = getattr(reqres.request.url, name)
        elif name == "" or name in Reqres_fields:
            if name == "":
                field = []
            else:
                field = name.split(".")
            # set to None if it does not exist
            try:
                res = getattr_rec(self.reqres, field)
            except AttributeError:
                res = None
            self.values[name] = res
        else:
            raise CatastrophicFailure("don't know how to derive `%s`", name)

        try:
            return self.values[name]
        except KeyError:
            assert False

def rrexpr_wrr_load(fobj : _io.BufferedReader, source : DeferredSourceType) -> ReqresExpr[DeferredSourceType]:
    return ReqresExpr(source, wrr_load(fobj))

def rrexprs_wrr_bundle_load(fobj : _io.BufferedReader, source : DeferredSourceType) -> _t.Iterator[ReqresExpr[StreamElementSource[DeferredSourceType]]]:
    n = 0
    for reqres in wrr_bundle_load(fobj):
        yield ReqresExpr(StreamElementSource(source, n), reqres)
        n += 1

def rrexprs_wrr_some_load(fobj : _io.BufferedReader, source : DeferredSourceType) -> _t.Iterator[ReqresExpr[DeferredSourceType | StreamElementSource[DeferredSourceType]]]:
    fobj = ungzip_fileobj_maybe(fobj)
    if fobj.peek(1) == b"":
        raise WRRParsingError(gettext("expected CBOR data, got EOF"))

    reqres = wrr_load_cbor_fileobj(fobj)
    if fobj.peek(1) == b"":
        yield ReqresExpr(source, reqres)
        return

    yield ReqresExpr(StreamElementSource(source, 0), reqres)

    n = 1
    while True:
        reqres = wrr_load_cbor_fileobj(fobj)
        yield ReqresExpr(StreamElementSource(source, n), reqres)
        n += 1
        if fobj.peek(1) == b"": break

def rrexpr_wrr_loadf(path : str | bytes, in_stat : _os.stat_result | None = None) -> ReqresExpr[FileSource]:
    with open(path, "rb") as f:
        in_stat = _os.fstat(f.fileno())
        return rrexpr_wrr_load(f, make_FileSource(path, in_stat))

def rrexprs_wrr_bundle_loadf(path : str | bytes, in_stat : _os.stat_result | None = None) -> _t.Iterator[ReqresExpr[StreamElementSource[FileSource]]]:
    with open(path, "rb") as f:
        in_stat = _os.fstat(f.fileno())
        yield from rrexprs_wrr_bundle_load(f, make_FileSource(path, in_stat))

def rrexprs_wrr_some_loadf(path : str | bytes, in_stat : _os.stat_result | None = None) -> _t.Iterator[ReqresExpr[FileSource | StreamElementSource[FileSource]]]:
    with open(path, "rb") as f:
        in_stat = _os.fstat(f.fileno())
        yield from rrexprs_wrr_some_load(f, make_FileSource(path, in_stat))

def trivial_Reqres(url : ParsedURL,
                   content_type : str = "text/html",
                   qtime : TimeStamp = TimeStamp(0),
                   stime : TimeStamp = TimeStamp(1000),
                   ftime : TimeStamp = TimeStamp(2000),
                   sniff : bool = False,
                   headers : Headers = [],
                   data : bytes = b"") -> Reqres:
    nsh = [] if sniff else [("X-Content-Type-Options", b"nosniff")]
    return Reqres(1, "hoardy-test/1", "HTTP/1.1",
                  Request(qtime, "GET", url, [], True, b""),
                  Response(stime, 200, "OK", [("Content-Type", content_type.encode("ascii"))] + nsh + headers, True, data),
                  ftime,
                  {}, None)

def fallback_Reqres(url : ParsedURL,
                    expected_mime : list[str],
                    qtime : TimeStamp = TimeStamp(0),
                    stime : TimeStamp = TimeStamp(1000),
                    ftime : TimeStamp = TimeStamp(2000),
                    headers : Headers = [],
                    data : bytes = b"") -> Reqres:
    """Similar to `trivial_Reqres`, but trying to guess the `Content-Type` from the given `expected_content_types` and the extension."""

    npath_parts = url.npath_parts
    if len(npath_parts) == 0 or url.raw_path.endswith("/"):
        cts = page_mime
    else:
        last = npath_parts[-1].lower()
        _, ext = _os.path.splitext(last)
        try:
            cts = possible_mimes_of_ext[ext]
        except KeyError:
            cts = any_mime

    # intersect, keeping the order in expected_mime
    cts = [ct for ct in expected_mime if ct in cts]

    if len(cts) > 0:
        return trivial_Reqres(url, cts[0], stime, stime, stime, headers=headers, data=data)

    # fallback this otherwise
    return trivial_Reqres(url, "application/octet-stream", stime, stime, stime, headers=headers, data=data)

def mk_trivial_ReqresExpr(url : str, ct : str = "text/html", sniff : bool = False, headers : Headers = [], data : bytes = b"") -> ReqresExpr[UnknownSource]:
    x = trivial_Reqres(parse_url(url), ct, sniff=sniff, headers=headers, data=data)
    return ReqresExpr(UnknownSource(), x)

def mk_fallback_ReqresExpr(url : str, cts : list[str] = ["text/html"], headers : Headers = [], data : bytes = b"") -> ReqresExpr[UnknownSource]:
    x = fallback_Reqres(parse_url(url), cts, headers=headers, data=data)
    return ReqresExpr(UnknownSource(), x)

def test_ReqresExpr_url_parts() -> None:
    def check(x : ReqresExpr[_t.Any], name : str, value : _t.Any) -> None:
        if x[name] != value:
            raise CatastrophicFailure("while evaluating %s of %s, expected %s, got %s", name, x.reqres.request.url, value, x[name])

    def check_fp(url : str, ext : str, *parts : str) -> None:
        x = mk_trivial_ReqresExpr(url)
        check(x, "filepath_ext", ext)
        check(x, "filepath_parts", list(parts))

    def check_fx(url : str, ct : str, sniff : bool, data : bytes, ext : str, *parts : str) -> None:
        x = mk_trivial_ReqresExpr(url, ct, sniff, [], data)
        check(x, "filepath_ext", ext)
        check(x, "filepath_parts", list(parts))

    def check_ff(url : str, cts : list[str], data : bytes, ext : str, *parts : str) -> None:
        x = mk_fallback_ReqresExpr(url, cts, [], data)
        check(x, "filepath_ext", ext)
        check(x, "filepath_parts", list(parts))

    check_fp("https://example.org/", ".htm", "index")
    check_fp("https://example.org/index.html", ".html", "index")
    check_fp("https://example.org/test", ".htm", "test", "index")
    check_fp("https://example.org/test/", ".htm", "test", "index")
    check_fp("https://example.org/test/index.html", ".html", "test", "index")
    check_fp("https://example.org/test.data", ".htm", "test.data")

    check_fx("https://example.org/test.data", "application/octet-stream", False, b"", ".data", "test")
    check_fx("https://example.org/test", "application/octet-stream", False, b"", ".data", "test", "index")

    check_fx("https://example.org/test.data", "application/octet-stream", True, b"", ".txt", "test.data")
    check_fx("https://example.org/test", "application/octet-stream", True, b"", ".txt", "test", "index")

    check_fx("https://example.org/test.data", "text/plain", True, b"\x00", ".data", "test")
    check_fx("https://example.org/test", "text/plain", True, b"\x00", ".data", "test", "index")

    check_ff("https://example.org/test.css", ["text/css", "text/plain"], b"", ".css", "test")
    check_ff("https://example.org/test.txt", ["text/css", "text/plain"], b"", ".txt", "test")
    check_ff("https://example.org/test", ["text/css", "text/plain"], b"", ".css", "test", "index")

    url = "https://example.org//first/./skipped/../second/?query=this"
    x = mk_trivial_ReqresExpr(url)
    path_components = ["first", "second"]
    check(x, "net_url", url)
    check(x, "npath_parts", path_components)
    check(x, "filepath_parts", path_components + ["index"])
    check(x, "filepath_ext", ".htm")
    check(x, "query_parts", [("query", "this")])

    x = mk_trivial_ReqresExpr("https://Königsgäßchen.example.org/испытание/../")
    check(x, "hostname", "königsgäßchen.example.org")
    check(x, "net_url", "https://xn--knigsgchen-b4a3dun.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/../")

    hostname = "ジャジェメント.ですの.example.org"
    ehostname = "xn--hck7aa9d8fj9i.xn--88j1aw.example.org"
    path_query="/how%2Fdo%3Fyou%26like/these/components%E3%81%A7%E3%81%99%E3%81%8B%3F?empty&not=abit%3D%2F%3F%26weird"
    path_components = ["how/do?you&like", "these", "componentsですか?"]
    query_components = [("empty", None), ("not", "abit=/?&weird")]
    x = mk_trivial_ReqresExpr(f"https://{hostname}{path_query}#hash")
    check(x, "hostname", hostname)
    check(x, "net_hostname", ehostname)
    check(x, "npath_parts", path_components)
    check(x, "filepath_parts", path_components + ["index"])
    check(x, "filepath_ext", ".htm")
    check(x, "query_parts", query_components)
    check(x, "fragment", "hash")
    check(x, "net_url", f"https://{ehostname}{path_query}")

def check_request_response(cmd : str, part : str) -> bool:
    if part not in ["request", "response"]:
        raise CatastrophicFailure("`%s`: unexpected argument, expected `request` or `response`, got `%s`", cmd, part)
    return part == "request"

def check_rrexpr(cmd : str, rrexpr : _t.Any) -> ReqresExpr[_t.Any]:
    if not isinstance(rrexpr, ReqresExpr):
        typ = type(rrexpr)
        raise CatastrophicFailure("`%s`: expecting `ReqresExpr` value as the command environment, got `%s`", cmd, typ.__name__)
    return rrexpr

def check_scrub(opts : str, url : str, ct : str, headers : Headers, data : str, eres : str) -> None:
    def sc(sniff : bool) -> None:
        t = trivial_Reqres(parse_url(url), ct, sniff=sniff, headers=headers, data=data.encode("utf-8"))
        x = ReqresExpr(UnknownSource(), t)

        res = x[f"response.body|eb|scrub response {opts}"].decode("utf-8")
        if res != eres:
            stdout.write_ln("input:")
            stdout.write_ln("==== START ====")
            stdout.write_ln(data)
            stdout.write_ln("===== END =====")
            stdout.write_ln("expected:")
            stdout.write_ln("==== START ====")
            stdout.write_ln(eres)
            stdout.write_ln("===== END =====")
            stdout.write_ln("got:")
            stdout.write_ln("==== START ====")
            stdout.write_ln(res)
            stdout.write_ln("===== END =====")
            stdout.flush()
            raise CatastrophicFailure("while evaluating %s of %s, expected %s, got %s", opts, x, repr(eres), repr(res))
    sc(False)
    sc(True)

test_css_in1 = """
body {
  background: url(./background.jpg);
  *zoom: 1;
}
"""

test_css_out1 = """
body {
  background: url(data:text/plain,%20);
  *zoom: 1;
}
"""

test_css_in2 = """
@import "main.css";
@import "main.css" layer(default);
@import url(main.css);
@import url(./main.css) layer(default);

@import url("media.css") print, screen;
@import url("spports.css") supports(display: grid) screen and (max-width: 400px);
@import url(./all.css) layer(default) supports(display: grid) screen;
"""

test_css_out2 = """
@import url(data:text/plain,%20);
@import url(data:text/plain,%20) layer(default);
@import url(data:text/plain,%20);
@import url(data:text/plain,%20) layer(default);

@import url(data:text/plain,%20) print, screen;
@import url(data:text/plain,%20) supports(display: grid) screen and (max-width: 400px);
@import url(data:text/plain,%20) layer(default) supports(display: grid) screen;
"""

def test_ReqresExpr_scrub_css() -> None:
    check_scrub("+verbose,+whitespace", "https://example.com/test.css", "text/css", [], test_css_in1, test_css_out1)
    check_scrub("+verbose,+whitespace", "https://example.com/test.css", "text/css", [], test_css_in2, test_css_out2)

test_html_in1 = f"""<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <base href="https://base.example.com">
    <base target="_blank">
    <base href="https://not-base.example.com">
    <base target="_top">
    <title>Test page</title>
    <link as=script rel=preload href="https://asset.example.com/asset.js">
    <link as=script rel=preload href="base.js">
    <link rel=stylesheet href="https://asset.example.com/asset.css">
    <link rel=stylesheet href="base.css">
    <style>
    {test_css_in1}
    </style>
    <noscript><link rel=stylesheet href="noscript.css"></noscript>
    <script>x = 1;</script>
    <script src="https://asset.example.com/inc1-asset.js"></script>
    <script src="inc1-base.js"></script>
  </head>
  <body>
    <h1>Test page</h1>
    <p>Test para.</p>
    <script>x = 2;</script>
    <script src="https://asset.example.com/inc2-asset.js"></script>
    <script src="inc2-base.js"></script>
  </body>
</html>
"""

def test_ReqresExpr_scrub_html() -> None:
    check_scrub("-all_dyns,-verbose,-whitespace,+indent", "https://example.com/", "text/html", [], test_html_in1, f"""<!DOCTYPE html>
<html>
  <head>
    <meta charset=utf-8>
    <base target=_blank>
    <title>Test page</title>
  </head>
  <body>
    <h1>Test page</h1>
    <p>Test para.</p>
  </body>
</html>""")

    check_scrub("+verbose,+whitespace", "https://example.com/", "text/html", [], test_html_in1, """<!DOCTYPE html><html><head>
    <meta charset=utf-8>
    <!-- hoardy-web censored out EmptyTag base from here -->
    <base target=_blank>
    <!-- hoardy-web censored out EmptyTag base from here -->
    <!-- hoardy-web censored out EmptyTag base from here -->
    <title>Test page</title>
    <!-- hoardy-web censored out EmptyTag link preload from here -->
    <!-- hoardy-web censored out EmptyTag link preload from here -->
    <!-- hoardy-web censored out EmptyTag link stylesheet from here -->
    <!-- hoardy-web censored out EmptyTag link stylesheet from here -->
    <style>
    
body {
  background: url(data:text/plain,%20);
  *zoom: 1;
}

    </style>
    <!-- hoardy-web censored out StartTag noscript from here --><!-- hoardy-web censored out EmptyTag link stylesheet from here --><!-- hoardy-web censored out EndTag noscript from here -->
    <!-- hoardy-web censored out AssembledTag script from here -->
    <!-- hoardy-web censored out AssembledTag script from here -->
    <!-- hoardy-web censored out AssembledTag script from here -->
  </head>
  <body>
    <h1>Test page</h1>
    <p>Test para.</p>
    <!-- hoardy-web censored out AssembledTag script from here -->
    <!-- hoardy-web censored out AssembledTag script from here -->
    <!-- hoardy-web censored out AssembledTag script from here -->
  

</body></html>""")

    check_scrub("+all_refs,+scripts,+prefetches,+navigations,+verbose,-whitespace,+indent", "https://example.com/", "text/html", [
        ("Link", b"</first.js>; as=script; rel=preload"),
        ("Link", b"<https://example.com/second.js>; as=script; rel=preload"),
        ("Link", b"<https://example.org/third.js>; as=script; rel=preload"),
        ("Link", b"</first.css>; rel=stylesheet"),
        # because browsers frequently squish headers together
        ("Link", b"""<https://example.com/second.css>; rel=stylesheet
<https://example.org/third.css>; rel=stylesheet"""),
        ("Content-Security-Policy", b"default-src 'self' https://example.com"),
        ("Content-Security-Policy", b"script-src https://example.com/"),
        ("X-UA-Compatible", b"IE=edge"),
        ("Refresh", b"10;url=/one.html"),
        ("Refresh", b"100;url=/two.html"),
        ("Refresh", b"200;url=https://example.org/three.html"),
    ], test_html_in1, """<!DOCTYPE html>
<html>
  <head>
    <meta charset=utf-8>
    <!-- hoardy-web censored out EmptyTag base from here -->
    <base target=_blank>
    <!-- hoardy-web censored out EmptyTag base from here -->
    <!-- hoardy-web censored out EmptyTag base from here -->
    <title>Test page</title>
    <link as=script rel=preload href="https://example.com/first.js">
    <link as=script rel=preload href="https://example.com/second.js">
    <link as=script rel=preload href="https://example.org/third.js">
    <link rel=stylesheet href="https://example.com/first.css">
    <link rel=stylesheet href="https://example.com/second.css">
    <link rel=stylesheet href="https://example.org/third.css">
    <!-- hoardy-web censored out EmptyTag meta from here -->
    <!-- hoardy-web censored out EmptyTag meta from here -->
    <meta http-equiv=X-UA-Compatible content="IE=edge">
    <meta http-equiv=Refresh content="10; url=https://example.com/one.html">
    <meta http-equiv=Refresh content="100; url=https://example.com/two.html">
    <meta http-equiv=Refresh content="200; url=https://example.org/three.html">
    <link as=script rel=preload href="https://asset.example.com/asset.js">
    <link as=script rel=preload href="https://base.example.com/base.js">
    <link rel=stylesheet href="https://asset.example.com/asset.css">
    <link rel=stylesheet href="https://base.example.com/base.css">
    <style>
      body {
 background: url(https://base.example.com/background.jpg); *zoom: 1; 
      }
    </style>
    <noscript><link rel=stylesheet href="https://base.example.com/noscript.css"></noscript>
    <script>
      x = 1;
    </script>
    <script src="https://asset.example.com/inc1-asset.js"></script>
    <script src="https://base.example.com/inc1-base.js"></script>
  </head>
  <body>
    <h1>Test page</h1>
    <p>Test para.</p>
    <script>
      x = 2;
    </script>
    <script src="https://asset.example.com/inc2-asset.js"></script>
    <script src="https://base.example.com/inc2-base.js"></script>
  </body>
</html>""")

def test_ReqresExpr_scrub_html_data_url_css() -> None:
    check_scrub("+verbose,+whitespace", "https://example.com/", "text/html", [], f"""<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Test page</title>
    <link rel=stylesheet href="{unparse_data_url("text/css", [], test_css_in1.encode("ascii"))}">
  </head>
  <body>
    <h1>Test page</h1>
    <p>Test para.</p>
  </body>
</html>
""", f"""<!DOCTYPE html><html><head>
    <meta charset=utf-8>
    <title>Test page</title>
    <link rel=stylesheet href='{unparse_data_url("text/css", [("charset", "utf-8")], test_css_out1.encode("ascii"))}'>
  </head>
  <body>
    <h1>Test page</h1>
    <p>Test para.</p>
  

</body></html>""")
