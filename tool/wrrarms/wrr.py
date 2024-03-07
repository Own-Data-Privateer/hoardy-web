# Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
#
# This file is a part of pwebarc project.
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

import cbor2 as _cbor2
import dataclasses as _dc
import decimal as _dec
import gzip as _gzip
import hashlib as _hashlib
import idna as _idna
import io as _io
import logging as _logging
import os as _os
import sys as _sys
import time as _time
import typing as _t
import urllib.parse as _up

from kisstdlib.exceptions import *
from kisstdlib.path import *

from .type import *
from .linst import *

Headers = list[tuple[str, bytes]]

@_dc.dataclass
class Request:
    started_at : Epoch
    method : str
    url : str
    headers : Headers
    complete : bool
    body : bytes | str

@_dc.dataclass
class Response:
    started_at : Epoch
    code : int
    reason : str
    headers : Headers
    complete : bool
    body : bytes | str

@_dc.dataclass
class WebSocketFrame:
    sent_at : Epoch
    from_client : bool
    opcode : int
    content : bytes

@_dc.dataclass
class Reqres:
    version : int
    source : str
    protocol : str
    request : Request
    response : _t.Optional[Response]
    finished_at : Epoch
    extra : dict[str, _t.Any]
    websocket : _t.Optional[list[WebSocketFrame]]

Reqres_fields = {
    "version": "WEBREQRES format version; int",
    "source": "`+`-separated list of applications that produced this reqres; str",
    "protocol": 'protocol; e.g. `"HTTP/1.1"`, `"HTTP/2.0"`; str',
    "request.started_at": "request start time in seconds since 1970-01-01 00:00; Epoch",
    "request.method": 'request HTTP method; e.g. `"GET"`, `"POST"`, etc; str',
    "request.url": "request URL, including the fragment/hash part; str",
    "request.headers": "request headers; list[tuple[str, bytes]]",
    "request.complete": "is request body complete?; bool",
    "request.body": "request body; bytes",
    "response.started_at": "response start time in seconds since 1970-01-01 00:00; Epoch",
    "response.code": "HTTP response code; e.g. `200`, `404`, etc; int",
    "response.reason": 'HTTP response reason; e.g. `"OK"`, `"Not Found"`, etc; usually empty for Chromium and filled for Firefox; str',
    "response.headers": "response headers; list[tuple[str, bytes]]",
    "response.complete": "is response body complete?; bool",
    "response.body": "response body; Firefox gives raw bytes, Chromium gives UTF-8 encoded strings; bytes | str",
    "finished_at": "request completion time in seconds since 1970-01-01 00:00; Epoch",
    "websocket": "a list of WebSocket frames",
}

Reqres_derived_attrs = {
    "fs_path": "file system path for the WRR file containing this reqres; str or None",

    "qtime": 'aliast for `request.started_at`; mnemonic: "reQuest TIME"; seconds since UNIX epoch; decimal float',
    "qtime_ms": "`qtime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch; int",
    "qtime_msq": "three least significant digits of `qtime_ms`; int",
    "qyear": "year number of `gmtime(qtime)` (UTC year number of `qtime`); int",
    "qmonth": "month number of `gmtime(qtime)`; int",
    "qday": "day of the month of `gmtime(qtime)`; int",
    "qhour": "hour of `gmtime(qtime)` in 24h format; int",
    "qminute": "minute of `gmtime(qtime)`; int",
    "qsecond": "second of `gmtime(qtime)`; int",

    "stime": '`response.started_at` if there was a response, `finished_at` otherwise; mnemonic: "reSponse TIME"; seconds since UNIX epoch; decimal float',
    "stime_ms": "`stime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch, int",
    "stime_msq": "three least significant digits of `stime_msq`; int",
    "syear": "similar to `syear`, but for `stime`; int",
    "smonth": "similar to `smonth`, but for `stime`; int",
    "sday": "similar to `sday`, but for `stime`; int",
    "shour": "similar to `shour`, but for `stime`; int",
    "sminute": "similar to `sminute`, but for `stime`; int",
    "ssecond": "similar to `ssecond`, but for `stime`; int",

    "ftime": "aliast for `finished_at`; seconds since UNIX epoch; decimal float",
    "ftime_ms": "`ftime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch; int",
    "ftime_msq": "three least significant digits of `ftime_msq`; int",
    "fyear": "similar to `syear`, but for `ftime`; int",
    "fmonth": "similar to `smonth`, but for `ftime`; int",
    "fday": "similar to `sday`, but for `ftime`; int",
    "fhour": "similar to `shour`, but for `ftime`; int",
    "fminute": "similar to `sminute`, but for `ftime`; int",
    "fsecond": "similar to `ssecond`, but for `ftime`; int",

    "status": '`"NR"` if there was no response, `str(response.code) + "C"` if response was complete, `str(response.code) + "N"` otherwise; str',

    "method": "aliast for `request.method`; str",
    "raw_url": "aliast for `request.url`; str",
    "net_url": "`raw_url` with Punycode UTS46 IDNA encoded hostname, unsafe characters quoted, and without the fragment/hash part; this is the URL that actually gets sent to the server; str",
    "scheme": "scheme part of `raw_url`; e.g. `http`, `https`, etc; str",
    "raw_hostname": "hostname part of `raw_url` as it is recorded in the reqres; str",
    "net_hostname": "hostname part of `raw_url`, encoded as Punycode UTS46 IDNA; this is what actually gets sent to the server; ASCII str",
    "hostname": "`net_hostname` decoded back into UNICODE; this is the canonical hostname representation for which IDNA-encoding and decoding are bijective; str",
    "rhostname": '`hostname` with the order of its parts reversed; e.g. `"www.example.org"` -> `"com.example.www"`; str',
    "port": 'port part of `raw_url`; int or None',
    "netloc": "netloc part of `raw_url`; i.e., in the most general case, `<username>:<password>@<hostname>:<port>`; str",
    "raw_path": 'raw path part of `raw_url` as it is recorded is the reqres; e.g. `"https://www.example.org"` -> `""`, `"https://www.example.org/"` -> `"/"`, `"https://www.example.org/index.html"` -> `"/index.html"`; str',
    "path_parts": 'component-wise unquoted "/"-split `raw_path` with empty components removed and dots and double dots interpreted away; e.g. `"https://www.example.org"` -> `[]`, `"https://www.example.org/"` -> `[]`, `"https://www.example.org/index.html"` -> `["index.html"]` , `"https://www.example.org/skipped/.//../used/"` -> `["used"]; list[str]',
    "wget_parts": '`path + ["index.html"]` if `raw_path` ends in a slash, `path` otherwise; this is what `wget` does in `wget -mpk`; list[str]',
    "raw_query": "query part of `raw_url` (i.e. everything after the `?` character and before the `#` character) as it is recorded in the reqres; str",
    "query_parts": "parsed (and component-wise unquoted) `raw_query`; list[tuple[str, str]]",
    "query_ne_parts": "`query_parts` with empty query parameters removed; list[tuple[str, str]]",
    "oqm": "optional query mark: `?` character if `query` is non-empty, an empty string otherwise; str",
    "fragment": "fragment (hash) part of the url; str",
    "ofm": "optional fragment mark: `#` character if `fragment` is non-empty, an empty string otherwise; str",
}

_time_attrs = set(["time", "time_ms", "time_msq", "year", "month", "day", "hour", "minute", "second"])

_miniquoters : dict[str, dict[str, str]] = {}

def miniquote(x : str, blacklist : str) -> str:
    """Like `urllib.parse.quote`, with a blacklist instead of whitelist."""
    miniquoter : dict[str, str]
    try:
        miniquoter = _miniquoters[blacklist]
    except KeyError:
        # build a dictionary from characters to their quotes
        miniquoter = {}
        for b in range(0, 32):
            miniquoter[chr(b)] = "%{:02X}".format(b)
        for c in "%" + blacklist:
            miniquoter[c] = "%{:02X}".format(ord(c))
        _miniquoters[blacklist] = miniquoter

    return "".join([miniquoter.get(c, c) for c in x])

def pp_to_path(parts : list[str]) -> str:
    """Turn URL path components list into a minimally-quoted path."""
    return "/".join([miniquote(e, "/?") for e in parts])

def qsl_to_path(query : list[tuple[str, str]]) -> str:
    """Turn URL query components list into a minimally-quoted path."""
    l = []
    for k, v in query:
        k = miniquote(k, "/&=")
        v = miniquote(v, "/&")
        if v == "":
            l.append(k)
        else:
            l.append(k + "=" + v)
    return "&".join(l)

Reqres_atoms = linst_atoms.copy()
Reqres_atoms.update({
    "pp_to_path": ("encode `path_parts` `list` into a POSIX path, quoting as little as needed",
        linst_apply0(lambda v: pp_to_path(v))),
    "qsl_urlencode": ("encode parsed `query` `list` into a URL's query component `str`",
        linst_apply0(lambda v: _up.urlencode(v))),
    "qsl_to_path": ("encode `query` `list` into a POSIX path, quoting as little as needed",
        linst_apply0(lambda v: qsl_to_path(v))),
})

Reqres_lookup = linst_custom_or_env(Reqres_atoms)

class ReqresExpr:
    reqres : Reqres
    items : dict[str, _t.Any]

    def __init__(self, reqres : Reqres, path : str | bytes | None = None) -> None:
        self.reqres = reqres
        self.items = {}
        if path is not None:
            self.items["fs_path"] = path

    def _fill_time(self, prefix : str, ts : Epoch) -> None:
        dt = _time.gmtime(int(ts))
        self.items[prefix + "year"] = dt.tm_year
        self.items[prefix + "month"] = dt.tm_mon
        self.items[prefix + "day"] = dt.tm_mday
        self.items[prefix + "hour"] = dt.tm_hour
        self.items[prefix + "minute"] = dt.tm_min
        self.items[prefix + "second"] = dt.tm_sec

    def get_value(self, name : str) -> _t.Any:
        if name.startswith("."):
            name = name[1:]

        try:
            return self.items[name]
        except KeyError:
            pass

        reqres = self.reqres
        if name == "method":
            self.items[name] = reqres.request.method
        elif (name.startswith("q") and \
              name[1:] in _time_attrs):
            qtime = reqres.request.started_at
            qtime_ms = int(qtime * 1000)
            self.items["qtime"] = qtime
            self.items["qtime_ms"] = qtime_ms
            self.items["qtime_msq"] = qtime_ms % 1000
            self._fill_time("q", qtime)
        elif (name.startswith("s") and \
              name[1:] in _time_attrs) or \
              name == "status":
            if reqres.response is not None:
                stime = reqres.response.started_at
                status = str(reqres.response.code)
                if reqres.response.complete:
                    status += "C"
                else:
                    status += "I"
            else:
                stime = reqres.finished_at
                status = "N"
            stime_ms = int(stime * 1000)
            self.items["status"] = status
            self.items["stime"] = stime
            self.items["stime_ms"] = stime_ms
            self.items["stime_msq"] = stime_ms % 1000
            self._fill_time("s", stime)
        elif (name.startswith("f") and \
              name[1:] in _time_attrs):
            ftime = reqres.finished_at
            ftime_ms = int(ftime * 1000)
            self.items["ftime"] = ftime
            self.items["ftime_ms"] = ftime_ms
            self.items["ftime_msq"] = ftime_ms % 1000
            self._fill_time("f", ftime)
        elif name in ["raw_url", "net_url",
                      "scheme",
                      "raw_hostname", "net_hostname", "hostname", "rhostname",
                      "port",
                      "netloc",
                      "raw_path", "path_parts", "wget_parts",
                      "oqm", "raw_query", "query_parts", "query_neparts",
                      "ofm", "fragment"]:
            raw_url = reqres.request.url
            self.items["raw_url"] = raw_url
            purl = _up.urlsplit(raw_url)

            scheme = purl.scheme
            self.items["scheme"] = scheme
            raw_hostname = purl.hostname
            assert raw_hostname is not None
            self.items["raw_hostname"] = raw_hostname
            port = purl.port
            self.items["port"] = port
            raw_path = purl.path
            self.items["raw_path"] = raw_path

            raw_query = purl.query
            oqm = "?" if raw_query != "" else ""
            self.items["oqm"] = oqm
            self.items["raw_query"] = raw_query

            fragment = purl.fragment
            ofm = "#" if fragment != "" else ""
            self.items["ofm"] = ofm
            self.items["fragment"] = fragment

            # Yes, this is a bit weird. `_idna.encode` and `_idna.decode` are not bijective.
            # So we turn raw_hostname into unicode str first, then encode it with uts46 enabled...
            net_hostname = _idna.encode(_idna.decode(raw_hostname), uts46=True).decode("ascii")
            self.items["net_hostname"] = net_hostname
            # ..., and then decode it again to get the canonical unicode hostname for which
            # encoding and decoding will be bijective
            hostname = _idna.decode(net_hostname)
            self.items["hostname"] = hostname

            hparts = hostname.split(".")
            hparts.reverse()
            hostname_rev = ".".join(hparts)
            self.items["rhostname"] = hostname_rev

            netport = ""
            if port is not None:
                netport = f":{str(port)}"

            user = _up.quote(_up.unquote(purl.username or ""), safe="")
            if user != "":
                passwd = _up.quote(_up.unquote(purl.password or ""), safe="")
                if passwd != "":
                    netauth = f"{user}:{passwd}@"
                else:
                    netauth = f"{user}@"
            else:
                netauth = ""
            netloc = "".join([netauth, hostname, netport])
            self.items["netloc"] = netloc

            net_netloc = "".join([netauth, net_hostname, netport])
            net_url = _up.quote(f"{scheme}://{net_netloc}{raw_path}{oqm}{raw_query}", safe="%/:=&?~#+!$,;'@()*[]|")
            if raw_query == "" and raw_url.endswith("?"):
                net_url += "?"
            self.items["net_url"] = net_url

            path_parts_insecure = [_up.unquote(e) for e in raw_path.split("/") if e != ""]

            # remove dots and securely interpret double dots
            path_parts : list[str] = []
            for e in path_parts_insecure:
                if e == ".":
                    continue
                elif e == "..":
                    if len(path_parts) > 0:
                        path_parts.pop()
                    continue
                path_parts.append(e)

            self.items["path_parts"] = path_parts
            self.items["wget_parts"] = path_parts + ["index.html"] if raw_path.endswith("/") else path_parts

            qsl = _up.parse_qsl(raw_query, keep_blank_values=True)
            self.items["query_parts"] = qsl
            self.items["query_ne_parts"] = [e for e in qsl if e[1] != ""]
        elif name == "" or name in Reqres_fields:
            if name == "":
                field = []
            else:
                field = name.split(".")
            # set to None if it does not exist
            try:
                res = rec_get(self.reqres, field)
            except Failure:
                res = None
            self.items[name] = res
        else:
            raise CatastrophicFailure("don't know how to derive `%s`", name)
        return self.items[name]

    def __getattr__(self, name : str) -> _t.Any:
        return self.get_value(name)

    def eval(self, expr : str) -> _t.Any:
        ce = linst_compile(expr, Reqres_lookup)
        return ce(self.get_value, None)

    def __getitem__(self, expr : str) -> _t.Any:
        # this is used in `format_string % self` expressions
        res = self.eval(expr)
        if res is None:
            raise Failure("expression `%s` evaluated to `None`", expr)
        return res

def trivial_Reqres(url : str) -> Reqres:
    return Reqres(1, "wrrarms-test/1", "HTTP/1.1",
                  Request(Epoch(0), "GET", url, [], True, b""),
                  Response(Epoch(1000), 200, "OK", [], True, b""),
                  Epoch(2000),
                  {}, None)

def test_ReqresExpr() -> None:
    def mk(url : str) -> ReqresExpr:
        return ReqresExpr(trivial_Reqres(url), None)

    def check(x : ReqresExpr, name : str, value : _t.Any) -> None:
        if x[name] != value:
            print(value)
            print(x[name])
            raise CatastrophicFailure("while evaluating %s of %s, got %s, expected %s", name, x.reqres.request.url, value, x[name])

    unmodified = [
        "http://example.org",
        "http://example.org/",
        "http://example.org/test",
        "http://example.org/test/",
        "http://example.org/unfinished/query?",
        "http://example.org/unfinished/query?param",
    ]
    for url in unmodified:
        x = mk(url)
        check(x, "net_url", url)

    url = "https://example.org//first/./skipped/../second/?query=this"
    x = mk(url)
    check(x, "net_url", url)
    check(x, "path_parts", ["first", "second"])
    check(x, "wget_parts", ["first", "second", "index.html"])
    check(x, "query_parts", [("query", "this")])

    x = mk("https://Königsgäßchen.example.org/испытание/../")
    check(x, "hostname", "königsgäßchen.example.org")
    check(x, "net_url", "https://xn--knigsgchen-b4a3dun.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/../")

    hostname = "ジャジェメント.ですの.example.org"
    path_query="/how%2Fdo%3Fyou%26like/these/components%E3%81%A7%E3%81%99%E3%81%8B%3F?empty&not=abit=%2F%3F%26weird"
    x = mk(f"https://{hostname}{path_query}#hash")
    check(x, "hostname", hostname)
    ehostname = "xn--hck7aa9d8fj9i.xn--88j1aw.example.org"
    check(x, "net_hostname", ehostname)
    query_components = ["how/do?you&like", "these", "componentsですか?"]
    check(x, "path_parts", query_components)
    check(x, "wget_parts", query_components)
    check(x, "query_parts", [("empty", ""), ("not", "abit=/?&weird")])
    check(x, "fragment", "hash")
    check(x, "net_url", f"https://{ehostname}{path_query}")

class ParsingError(Failure): pass

def _t_bool(x : _t.Any) -> bool:
    if isinstance(x, bool): return x
    raise TypeError("wrong type: want %s, got %s", bool, type(x))

def _t_bytes(x : _t.Any) -> bytes:
    if isinstance(x, bytes): return x
    raise TypeError("wrong type: want %s, got %s", bytes, type(x))

def _t_str(x : _t.Any) -> str:
    if isinstance(x, str): return x
    raise TypeError("wrong type: want %s, got %s", str, type(x))

def _t_bytes_or_str(x : _t.Any) -> bytes | str:
    if isinstance(x, bytes): return x
    if isinstance(x, str): return x
    raise TypeError("wrong type: want %s or %s, got %s", bytes, str, type(x))

def _t_int(x : _t.Any) -> int:
    if isinstance(x, int): return x
    raise TypeError("wrong type: want %s, got %s", int, type(x))

def _t_epoch(x : _t.Any) -> Epoch:
    return Epoch(_dec.Decimal(_t_int(x)) / 1000)

def _f_epoch(x : Epoch) -> int:
    return int(x * 1000)

def _t_headers(x : _t.Any) -> Headers:
    if Headers.__instancecheck__(x):
        return _t.cast(Headers, x)
    raise TypeError("wrong type: want %s, got %s", Headers, type(x))

def wrr_load(fobj : _io.BufferedReader) -> Reqres:
    head = fobj.peek(2)[:2]
    if head == b"\037\213":
        fobj = _t.cast(_io.BufferedReader, _gzip.GzipFile(fileobj=fobj, mode="rb"))

    try:
        data = _cbor2.load(fobj)
    except _cbor2.CBORDecodeValueError:
        raise ParsingError("can't decode CBOR data, not a CBOR file?")

    if type(data) != list or len(data) == 0:
        raise ParsingError("can't parse CBOR data: wrong structure")

    if data[0] == "WEBREQRES/1":
        _, source, protocol, request_, response_, finished_at, extra = data
        rq_started_at, rq_method, rq_url, rq_headers, rq_complete, rq_body = request_
        request = Request(_t_epoch(rq_started_at), _t_str(rq_method), _t_str(rq_url), _t_headers(rq_headers), _t_bool(rq_complete), _t_bytes_or_str(rq_body))
        if response_ is None:
            response = None
        else:
            rs_started_at, rs_code, rs_reason, rs_headers, rs_complete, rs_body = response_
            response = Response(_t_epoch(rs_started_at), _t_int(rs_code), _t_str(rs_reason), _t_headers(rs_headers), _t_bool(rs_complete), _t_bytes_or_str(rs_body))

        try:
            wsframes = extra["websocket"]
        except KeyError:
            websocket = None
        else:
            del extra["websocket"]
            websocket = []
            for frame in wsframes:
                sent_at, from_client, opcode, content = frame
                websocket.append(WebSocketFrame(_t_epoch(sent_at), _t_bool(from_client), _t_int(opcode), _t_bytes(content)))

        return Reqres(1, source, protocol, request, response, _t_epoch(finished_at), extra, websocket)
    else:
        raise ParsingError("can't parse CBOR data: unknown format %s", data[0])

def wrr_load_expr(fobj : _io.BufferedReader, path : str | bytes) -> ReqresExpr:
    reqres = wrr_load(fobj)
    return ReqresExpr(reqres, path)

def wrr_loadf(path : str | bytes) -> Reqres:
    with open(path, "rb") as f:
        return wrr_load(f)

def wrr_loadf_expr(path : str | bytes) -> ReqresExpr:
    reqres = wrr_loadf(path)
    return ReqresExpr(reqres, path)

def wrr_dumps(reqres : Reqres, compress : bool = True) -> bytes:
    req = reqres.request
    request = _f_epoch(req.started_at), req.method, req.url, req.headers, req.complete, req.body
    del req

    if reqres.response is None:
        response = None
    else:
        res = reqres.response
        response = _f_epoch(res.started_at), res.code, res.reason, res.headers, res.complete, res.body
        del res

    extra = reqres.extra
    if reqres.websocket is not None:
        extra = extra.copy()
        wsframes = []
        for frame in reqres.websocket:
            wsframes.append([_f_epoch(frame.sent_at), frame.from_client, frame.opcode, frame.content])
        extra["websocket"] = wsframes

    structure = ["WEBREQRES/1", reqres.source, reqres.protocol, request, response, _f_epoch(reqres.finished_at), extra]

    data : bytes = _cbor2.dumps(structure)

    if not compress:
        return data

    # gzip it, if it gzips
    buf = _io.BytesIO()
    with _gzip.GzipFile(fileobj=buf, filename="", mtime=0, mode="wb", compresslevel=9) as gz:
        gz.write(data)
    compressed_data = buf.getvalue()

    if len(compressed_data) < len(data):
        data = compressed_data

    del buf
    del compressed_data

    return data

def wrr_dump(fobj : _io.BufferedWriter, reqres : Reqres, compress : bool = True) -> None:
    data = wrr_dumps(reqres, compress)
    fobj.write(data)
