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

import cbor2 as _cbor2
import dataclasses as _dc
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

from decimal import Decimal
from gettext import gettext

from kisstdlib.exceptions import *
from kisstdlib.path import *

from .util import *
from .type import *
from .linst import *
from .mime import *
from .html import *

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

@_dc.dataclass
class ParsedURL:
    raw_url : str
    scheme : str
    user : str
    password : str
    brackets : bool
    raw_hostname : str
    net_hostname : str
    hostname : str
    opm : str
    port : str
    raw_path : str
    oqm : str
    raw_query : str
    ofm : str
    fragment : str

    @property
    def net_auth(self) -> str:
        if self.user != "":
            if self.password != "":
                return f"{self.user}:{self.password}@"
            else:
                return f"{self.user}@"
        else:
            return ""

    @property
    def rhostname(self) -> str:
        hparts = self.hostname.split(".")
        hparts.reverse()
        return ".".join(hparts)

    @property
    def netloc(self) -> str:
        hn = self.hostname
        if self.brackets: hn = "[" + hn + "]"
        return "".join([self.net_auth, hn, self.opm, self.port])

    @property
    def net_netloc(self) -> str:
        hn = self.net_hostname
        if self.brackets: hn = "[" + hn + "]"
        return "".join([self.net_auth, hn, self.opm, self.port])

    @property
    def net_url(self) -> str:
        raw_path = self.raw_path
        if self.raw_hostname:
            nl = self.net_netloc
            if nl != "": nl = "//" + nl
            slash = "/" if raw_path == "" else ""
            return _up.quote(f"{self.scheme}:{nl}{raw_path}{slash}{self.oqm}{self.raw_query}", safe="%/:=&?~#+!$,;'@()*[]|")
        else:
            return _up.quote(f"{self.scheme}:{raw_path}{self.oqm}{self.raw_query}", safe="%/:=&?~#+!$,;'@()*[]|")

    @property
    def full_url(self) -> str:
        return f"{self.net_url}{self.ofm}{self.fragment}"

    @property
    def raw_path_parts(self) -> list[str]:
        return [_up.unquote(e) for e in self.raw_path.split("/")]

    @property
    def npath_parts(self) -> list[str]:
        parts_insecure = [e for e in self.raw_path_parts if e != ""]

        # remove dots and securely interpret double dots
        parts : list[str] = []
        for e in parts_insecure:
            if e == ".":
                continue
            elif e == "..":
                if len(parts) > 0:
                    parts.pop()
                continue
            parts.append(e)
        return parts

    def filepath_parts_ext(self, default : str, extensions : list[str]) -> tuple[list[str], str]:
        parts = self.npath_parts
        if len(parts) == 0 or self.raw_path.endswith("/"):
            return parts + [default], extensions[0] if len(extensions) > 0 else ".data"

        last = parts[-1].lower()
        last_name, last_ext = _os.path.splitext(last)
        if last_ext == "":
            return parts + [default], extensions[0] if len(extensions) > 0 else ".data"
        elif last_ext in extensions:
            return parts[:-1] + [last_name], last_ext
        elif len(extensions) > 0:
            return parts[:-1] + [last], extensions[0]
        elif last_ext == ".data":
            return parts[:-1] + [last_name], ".data"
        else:
            return parts[:-1] + [last], ".data"

    @property
    def query_parts(self) -> list[tuple[str, str]]:
        return _up.parse_qsl(self.raw_query, keep_blank_values=True)

    @property
    def query_ne_parts(self) -> list[tuple[str, str]]:
        return [e for e in self.query_parts if e[1] != ""]

    @property
    def mq_raw_path(self) -> str:
        return pp_to_path(self.raw_path_parts)

    @property
    def mq_npath(self) -> str:
        return pp_to_path(self.npath_parts)

    @property
    def mq_query(self) -> str:
        return qsl_to_path(self.query_parts)

    @property
    def mq_nquery(self) -> str:
        return qsl_to_path(self.query_ne_parts)

    @property
    def pretty_net_url(self) -> str:
        if self.raw_hostname:
            nl = self.netloc
            if nl != "": nl = "//" + nl
            slash = "/" if self.raw_path == "" else ""
            return f"{self.scheme}:{nl}{self.mq_raw_path}{slash}{self.oqm}{self.mq_query}"
        else:
            return f"{self.scheme}:{self.mq_raw_path}{self.oqm}{self.mq_query}"

    @property
    def pretty_url(self) -> str:
        return f"{self.pretty_net_url}{self.ofm}{self.fragment}"

    @property
    def pretty_net_nurl(self) -> str:
        mq_npath = self.mq_npath
        if self.raw_hostname:
            nl = self.netloc
            if nl != "": nl = "//" + nl
            slash = "/" if self.raw_path.endswith("/") and len(mq_npath) > 0 else ""
            return f"{self.scheme}:{nl}/{mq_npath}{slash}{self.oqm}{self.mq_nquery}"
        else:
            slash = "/" if self.raw_path.endswith("/") else ""
            return f"{self.scheme}:{mq_npath}{slash}{self.oqm}{self.mq_nquery}"

    @property
    def pretty_nurl(self) -> str:
        return f"{self.pretty_net_nurl}{self.ofm}{self.fragment}"

class URLParsingError(ValueError): pass

def parse_url(url : str) -> ParsedURL:
    try:
        scheme, netloc, path, query, fragment = _up.urlsplit(url)
    except Exception:
        raise URLParsingError(url)

    userinfo, has_user, hostinfo = netloc.rpartition("@")
    if has_user:
        user , _, password = userinfo.partition(":")
        user = _up.quote(_up.unquote(user), safe="")
        password = _up.quote(_up.unquote(password), safe="")
    else:
        user = ""
        password = ""
    if hostinfo.startswith("["):
        brackets = True
        raw_hostname, has_endbracket, port = hostinfo[1:].partition("]")
        if not has_endbracket or port != "" and not port.startswith(":"):
            raise URLParsingError(url)
        opm = ":"
        port = port[1:]
    else:
        brackets = False
        raw_hostname, opm, port = hostinfo.partition(":")

    if raw_hostname == "":
        net_hostname = hostname = ""
    else:
        # Fix common issues by rewriting hostnames like browsers do
        ehostname = _up.unquote(raw_hostname).replace("_", "-")
        try:
            # Yes, this is a bit weird. `_idna.encode` and `_idna.decode` are not bijective.
            # So we turn raw_hostname into unicode str first, then encode it with uts46 enabled...
            net_hostname = _idna.encode(_idna.decode(ehostname, uts46=True), uts46=True).decode("ascii")
            # ..., and then decode it again to get the canonical unicode hostname for which
            # encoding and decoding will be bijective
            hostname = _idna.decode(net_hostname)
        except _idna.IDNAError:
            raise URLParsingError(url)

    oqm = "?" if query != "" or (query == "" and url.endswith("?")) else ""
    ofm = "#" if fragment != "" or (fragment == "" and url.endswith("#")) else ""
    return ParsedURL(url, scheme, user, password,
                     brackets, raw_hostname, net_hostname, hostname,
                     opm, port,
                     path, oqm, query, ofm, fragment)

def test_parse_url() -> None:
    def check(x : ParsedURL, name : str, value : _t.Any) -> None:
        if getattr(x, name) != value:
            raise CatastrophicFailure("while evaluating %s of %s, got %s, expected %s", name, x.raw_url, getattr(x, name), value)

    tests1 : list[list[str| None]]
    tests1 = [
        ["http://example.org", "http://example.org/", "http://example.org/"],
        ["http://example.org/", None, None],
        ["http://example.org/test", None, None],
        ["http://example.org/test/", None, None],
        ["http://example.org/unfinished/query?", None, None],
        ["http://example.org/unfinished/query?param", None, "http://example.org/unfinished/query?"],
        ["http://example.org/unfinished/query?param=0", None, None],
        ["http://example.org/unfinished/query?param=0&param=1", None, None],
        ["http://example.org/web/2/https://archived.example.org", None, "http://example.org/web/2/https:/archived.example.org"],
        ["http://example.org/web/2/https://archived.example.org/", None, "http://example.org/web/2/https:/archived.example.org/"],
        ["http://example.org/web/2/https://archived.example.org/test", None, "http://example.org/web/2/https:/archived.example.org/test"],
        ["http://example.org/web/2/https://archived.example.org/test/", None, "http://example.org/web/2/https:/archived.example.org/test/"],
        ["http://example.org/web/2/https://archived.example.org/unfinished/query?", None, "http://example.org/web/2/https:/archived.example.org/unfinished/query?"],
        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param", None, "http://example.org/web/2/https:/archived.example.org/unfinished/query?"],
        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param=0", None, "http://example.org/web/2/https:/archived.example.org/unfinished/query?param=0"],
        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param=0&param=1", None, "http://example.org/web/2/https:/archived.example.org/unfinished/query?param=0&param=1"],
    ]

    url : str | None
    rest : list[str | None]
    for url, *rest in tests1:
        assert url is not None
        x = parse_url(url)
        check(x, "raw_url", url)

        curl = rest[0] if rest[0] is not None else url
        check(x, "net_url", curl)
        check(x, "pretty_net_url", curl)
        check(x, "pretty_url", curl)

        nurl = rest[1] if rest[1] is not None else url
        check(x, "pretty_net_nurl", nurl)
        check(x, "pretty_nurl", nurl)

    tests2 : list[list[str| None]]
    tests2 = [
        ["http://example.org#hash", "http://example.org/#hash", "http://example.org/"],
        ["http://example.org/#hash", "http://example.org/#hash", "http://example.org/"],
    ]

    for url, *rest in tests2:
        assert url is not None
        x = parse_url(url)
        check(x, "raw_url", url)

        curl = rest[0] if rest[0] is not None else url
        check(x, "pretty_url", curl)
        check(x, "pretty_nurl", curl)

        nurl = rest[1] if rest[1] is not None else url
        check(x, "net_url", nurl)
        check(x, "pretty_net_url", nurl)
        check(x, "pretty_net_nurl", nurl)

Headers = list[tuple[str, bytes]]

def get_raw_headers(headers : Headers, name : str) -> list[bytes]:
    return [v for k, v in headers if k.lower() == name]

def get_raw_header(headers : Headers, name : str, default : bytes | None = None) -> bytes | None:
    res = get_raw_headers(headers, name)
    if len(res) == 0:
        return default
    else:
        return res[-1]

def get_header(headers : Headers, name : str, default : str | None = None) -> str | None:
    res = get_raw_header(headers, name)
    if res is None:
        return default
    else:
        return res.decode("ascii")

class RRCommon:
    _dtc : dict[SniffContentType, DiscernContentType]

    def get_header(self, name : str, default : str | None = None) -> str | None:
        return get_header(self.headers, name, default) # type: ignore

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
    started_at : Epoch
    method : str
    url : ParsedURL
    headers : Headers
    complete : bool
    body : bytes | str

    def get_content_type(self) -> tuple[str, bool]:
        ct = self.get_header("content-type", "application/x-www-form-urlencoded")
        assert ct is not None
        return ct, False

@_dc.dataclass
class Response(RRCommon):
    started_at : Epoch
    code : int
    reason : str
    headers : Headers
    complete : bool
    body : bytes | str

    def get_content_type(self) -> tuple[str, bool]:
        ct = self.get_header("content-type", "application/octet-stream")
        assert ct is not None
        ct_opts = self.get_header("x-content-type-options", "")
        if ct_opts == "nosniff" or ct_opts == "no-sniff":
            sniff = False
        else:
            sniff = True
        return ct, sniff

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

Reqres_url_schemes = frozenset(["http", "https", "ws", "wss"])

Reqres_fields = {
    "version": "WEBREQRES format version; int",
    "source": "`+`-separated list of applications that produced this reqres; str",
    "protocol": 'protocol; e.g. `"HTTP/1.1"`, `"HTTP/2.0"`; str',
    "request.started_at": "request start time in seconds since 1970-01-01 00:00; Epoch",
    "request.method": 'request `HTTP` method; e.g. `"GET"`, `"POST"`, etc; str',
    "request.url": "request URL, including the `fragment`/hash part; str",
    "request.headers": "request headers; list[tuple[str, bytes]]",
    "request.complete": "is request body complete?; bool",
    "request.body": "request body; bytes",
    "response.started_at": "response start time in seconds since 1970-01-01 00:00; Epoch",
    "response.code": "`HTTP` response code; e.g. `200`, `404`, etc; int",
    "response.reason": '`HTTP` response reason; e.g. `"OK"`, `"Not Found"`, etc; usually empty for Chromium and filled for Firefox; str',
    "response.headers": "response headers; list[tuple[str, bytes]]",
    "response.complete": "is response body complete?; bool",
    "response.body": "response body; Firefox gives raw bytes, Chromium gives UTF-8 encoded strings; bytes | str",
    "finished_at": "request completion time in seconds since 1970-01-01 00:00; Epoch",
    "websocket": "a list of WebSocket frames",
}

Reqres_derived_attrs = {
    "fs_path": "file system path for the WRR file containing this reqres; str | bytes | None",

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
    "stime_msq": "three least significant digits of `stime_ms`; int",
    "syear": "similar to `qyear`, but for `stime`; int",
    "smonth": "similar to `qmonth`, but for `stime`; int",
    "sday": "similar to `qday`, but for `stime`; int",
    "shour": "similar to `qhour`, but for `stime`; int",
    "sminute": "similar to `qminute`, but for `stime`; int",
    "ssecond": "similar to `qsecond`, but for `stime`; int",

    "ftime": "aliast for `finished_at`; seconds since UNIX epoch; decimal float",
    "ftime_ms": "`ftime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch; int",
    "ftime_msq": "three least significant digits of `ftime_ms`; int",
    "fyear": "similar to `qyear`, but for `ftime`; int",
    "fmonth": "similar to `qmonth`, but for `ftime`; int",
    "fday": "similar to `qday`, but for `ftime`; int",
    "fhour": "similar to `qhour`, but for `ftime`; int",
    "fminute": "similar to `qminute`, but for `ftime`; int",
    "fsecond": "similar to `qsecond`, but for `ftime`; int",

    "status": '`"I"` or  `"C"` depending on the value of `request.complete` (`false` or `true`, respectively) followed by either `"N"`, whene `response == None`, or `str(response.code)` followed by `"I"` or  `"C"` depending on the value of `response.complete`; str',

    "method": "aliast for `request.method`; str",
    "raw_url": "aliast for `request.url`; str",
}

Reqres_url_attrs = {
    "net_url": "a variant of `raw_url` that uses Punycode UTS46 IDNA encoded `net_hostname`, has all unsafe characters of `raw_path` and `raw_query` quoted, and comes without the `fragment`/hash part; this is the URL that actually gets sent to an `HTTP` server when you request `raw_url`; str",
    "pretty_net_url": "a variant of `raw_url` that uses UNICODE IDNA `hostname` without Punycode, minimally quoted `mq_raw_path` and `mq_query`, and comes without the `fragment`/hash part; this is a human-readable version of `net_url`; str",
    "pretty_url": "`pretty_net_url` with `fragment`/hash part appended; str",
    "pretty_net_nurl": "a variant of `pretty_net_url` that uses `mq_npath` instead of `mq_raw_path` and `mq_nquery` instead of `mq_query`; i.e. this is `pretty_net_url` with normalized path and query; str",
    "pretty_nurl": "`pretty_net_nurl` with `fragment`/hash part appended; str",
    "scheme": "scheme part of `raw_url`; e.g. `http`, `https`, etc; str",
    "raw_hostname": "hostname part of `raw_url` as it is recorded in the reqres; str",
    "net_hostname": "hostname part of `raw_url`, encoded as Punycode UTS46 IDNA; this is what actually gets sent to the server; ASCII str",
    "hostname": "`net_hostname` decoded back into UNICODE; this is the canonical hostname representation for which IDNA-encoding and decoding are bijective; UNICODE str",
    "rhostname": '`hostname` with the order of its parts reversed; e.g. `"www.example.org"` -> `"com.example.www"`; str',
    "port": 'port part of `raw_url`; str',
    "netloc": "netloc part of `raw_url`; i.e., in the most general case, `<username>:<password>@<hostname>:<port>`; str",
    "raw_path": 'raw path part of `raw_url` as it is recorded is the reqres; e.g. `"https://www.example.org"` -> `""`, `"https://www.example.org/"` -> `"/"`, `"https://www.example.org/index.html"` -> `"/index.html"`; str',
    "raw_path_parts": 'component-wise unquoted "/"-split `raw_path`; list[str]',
    "npath_parts": '`raw_path_parts` with empty components removed and dots and double dots interpreted away; e.g. `"https://www.example.org"` -> `[]`, `"https://www.example.org/"` -> `[]`, `"https://www.example.org/index.html"` -> `["index.html"]` , `"https://www.example.org/skipped/.//../used/"` -> `["used"]`; list[str]',
    "mq_raw_path": "`raw_path_parts` turned back into a minimally-quoted string; str",
    "mq_npath": "`npath_parts` turned back into a minimally-quoted string; str",
    "filepath_parts": '`npath_parts` transformed into components usable as an exportable file name; i.e. `npath_parts` with an optional additional `"index"` appended, depending on `raw_url` and `response` `MIME` type; extension will be stored separately in `filepath_ext`; e.g. for `HTML` documents `"https://www.example.org/"` -> `["index"]`, `"https://www.example.org/test.html"` -> `["test"]`, `"https://www.example.org/test"` -> `["test", "index"]`, `"https://www.example.org/test.json"` -> `["test.json", "index"]`, but if it has a `JSON` `MIME` type then `"https://www.example.org/test.json"` -> `["test"]` (and `filepath_ext` will be set to `".json"`); this is similar to what `wget -mpk` does, but a bit smarter; list[str]',
    "filepath_ext": 'extension of the last component of `filepath_parts` for recognized `MIME` types, `".data"` otherwise; str',
    "raw_query": "query part of `raw_url` (i.e. everything after the `?` character and before the `#` character) as it is recorded in the reqres; str",
    "query_parts": "parsed (and component-wise unquoted) `raw_query`; list[tuple[str, str]]",
    "query_ne_parts": "`query_parts` with empty query parameters removed; list[tuple[str, str]]",
    "mq_query": "`query_parts` turned back into a minimally-quoted string; str",
    "mq_nquery": "`query_ne_parts` turned back into a minimally-quoted string; str",
    "oqm": "optional query mark: `?` character if `query` is non-empty, an empty string otherwise; str",
    "fragment": "fragment (hash) part of the url; str",
    "ofm": "optional fragment mark: `#` character if `fragment` is non-empty, an empty string otherwise; str",
}
Reqres_derived_attrs.update(Reqres_url_attrs)

_time_attrs = frozenset(["time", "time_ms", "time_msq", "year", "month", "day", "hour", "minute", "second"])

@_dc.dataclass
class ReqresExpr:
    reqres : Reqres
    fs_path : str | bytes | None
    obj_path : list[int | str | bytes]
    sniff : SniffContentType = _dc.field(default=SniffContentType.NONE)
    remap_url : URLRemapper | None = _dc.field(default = None)
    items : dict[str, _t.Any] = _dc.field(default_factory = dict)

    def format_source(self) -> bytes:
        res = _io.BytesIO()
        fs_path = self.fs_path
        if fs_path is None:
            res.write(_os.fsencode(f"<{id(self)}>"))
        elif isinstance(fs_path, str):
            res.write(_os.fsencode(fs_path))
        else:
            res.write(fs_path)

        for o in self.obj_path:
            res.write(b"/")
            if isinstance(o, int):
                res.write(_os.fsencode(str(o)))
            elif isinstance(o, str):
                res.write(_os.fsencode(o))
            else:
                res.write(o)
        return res.getvalue()

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

        if name == "fs_path":
            return self.fs_path

        reqres = self.reqres
        if name == "method":
            self.items[name] = reqres.request.method
        elif name == "raw_url" or name == "request.url":
            self.items[name] = reqres.request.url.raw_url
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
        elif name == "filepath_parts" or name == "filepath_ext":
            if reqres.response is not None:
                _, _, _, extensions = reqres.response.discern_content_type(self.sniff)
            else:
                extensions = []
            parts, ext = reqres.request.url.filepath_parts_ext("index", extensions)
            self.items["filepath_parts"] = parts
            self.items["filepath_ext"] = ext
        elif name in Reqres_url_attrs:
            self.items[name] = getattr(reqres.request.url, name)
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

        try:
            return self.items[name]
        except KeyError:
            assert False

    def __getattr__(self, name : str) -> _t.Any:
        return self.get_value(name)

    def __getitem__(self, expr : str) -> _t.Any:
        # this is used in `format_string % self` expressions
        try:
            return self.items[expr]
        except KeyError:
            pass

        func = linst_compile(expr, ReqresExpr_lookup)
        res = func(self, None)
        if res is None:
            raise Failure("expression `%s` evaluated to `None`", expr)
        return res

def trivial_Reqres(url : ParsedURL,
                   content_type : str = "text/html",
                   qtime : Epoch = Epoch(0),
                   stime : Epoch = Epoch(1000),
                   ftime : Epoch = Epoch(2000),
                   sniff : bool = False,
                   data : bytes = b"") -> Reqres:
    nsh = [] if sniff else [("X-Content-Type-Options", b"nosniff")]
    return Reqres(1, "hoardy-test/1", "HTTP/1.1",
                  Request(qtime, "GET", url, [], True, b""),
                  Response(stime, 200, "OK", [("Content-Type", content_type.encode("ascii"))] + nsh, True, data),
                  ftime,
                  {}, None)

def fallback_Reqres(url : ParsedURL,
                    expected_mime : list[str],
                    qtime : Epoch = Epoch(0),
                    stime : Epoch = Epoch(1000),
                    ftime : Epoch = Epoch(2000),
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
        return trivial_Reqres(url, cts[0], stime, stime, stime, data=data)

    # fallback this otherwise
    return trivial_Reqres(url, "application/octet-stream", stime, stime, stime, data=data)

def test_ReqresExpr() -> None:
    def mk(url : str, ct : str = "text/html", sniff : bool = False, data : bytes = b"") -> ReqresExpr:
        x = trivial_Reqres(parse_url(url), ct, sniff=sniff, data=data)
        return ReqresExpr(x, None, [])

    def mkf(url : str, cts : list[str] = ["text/html"], data : bytes = b"") -> ReqresExpr:
        x = fallback_Reqres(parse_url(url), cts)
        return ReqresExpr(x, None, [])

    def check(x : ReqresExpr, name : str, value : _t.Any) -> None:
        if x[name] != value:
            raise CatastrophicFailure("while evaluating %s of %s, got %s, expected %s", name, x.reqres.request.url, x[name], value)

    def check_fp(url : str, ext : str, *parts : str) -> None:
        x = mk(url)
        check(x, "filepath_ext", ext)
        check(x, "filepath_parts", list(parts))

    def check_fx(url : str, ct : str, sniff : bool, data : bytes, ext : str, *parts : str) -> None:
        x = mk(url, ct, sniff, data)
        check(x, "filepath_ext", ext)
        check(x, "filepath_parts", list(parts))

    def check_ff(url : str, cts : list[str], data : bytes, ext : str, *parts : str) -> None:
        x = mkf(url, cts, data)
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
    x = mk(url)
    path_components = ["first", "second"]
    check(x, "net_url", url)
    check(x, "npath_parts", path_components)
    check(x, "filepath_parts", path_components + ["index"])
    check(x, "filepath_ext", ".htm")
    check(x, "query_parts", [("query", "this")])

    x = mk("https://Königsgäßchen.example.org/испытание/../")
    check(x, "hostname", "königsgäßchen.example.org")
    check(x, "net_url", "https://xn--knigsgchen-b4a3dun.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/../")

    hostname = "ジャジェメント.ですの.example.org"
    ehostname = "xn--hck7aa9d8fj9i.xn--88j1aw.example.org"
    path_query="/how%2Fdo%3Fyou%26like/these/components%E3%81%A7%E3%81%99%E3%81%8B%3F?empty&not=abit=%2F%3F%26weird"
    path_components = ["how/do?you&like", "these", "componentsですか?"]
    query_components = [("empty", ""), ("not", "abit=/?&weird")]
    x = mk(f"https://{hostname}{path_query}#hash")
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

def check_rrexpr(cmd : str, rrexpr : _t.Any) -> ReqresExpr:
    if not isinstance(rrexpr, ReqresExpr):
        typ = type(rrexpr)
        raise CatastrophicFailure("`%s`: expecting `ReqresExpr` value as the command environment, got `%s`", cmd, typ.__name__)
    return rrexpr

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
                    scrub_opts.verbose = True
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

            mime, kinds, charset, _ = rere_obj.discern_content_type(rrexpr.sniff)

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
                return scrub_html(scrubbers, rrexpr.net_url, rrexpr.remap_url, rere_obj.body, charset)
            elif "css" in kinds:
                return scrub_css(scrubbers, rrexpr.net_url, rrexpr.remap_url, rere_obj.body, charset)
            else:
                # no scrubbing needed
                return rere_obj.body

        return envfunc
    return [str, str], func

ReqresExpr_atoms = linst_atoms.copy()
ReqresExpr_atoms.update({
    "pp_to_path": ("encode `*path_parts` `list` into a POSIX path, quoting as little as needed",
        linst_apply0(lambda v: pp_to_path(v))),
    "qsl_urlencode": ("encode parsed `query` `list` into a URL's query component `str`",
        linst_apply0(lambda v: _up.urlencode(v))),
    "qsl_to_path": ("encode `query` `list` into a POSIX path, quoting as little as needed",
        linst_apply0(lambda v: qsl_to_path(v))),
    "scrub": ("""scrub the value by optionally rewriting links and/or removing dynamic content from it; what gets done depends on `--remap-*` command line options, the `MIME` type of the value itself, and the scrubbing options described below; this fuction takes two arguments:
  - the first must be either of `request|response`, it controls which `HTTP` headers `scrub` should inspect to help it detect the `MIME` type;
  - the second is either `defaults` or ","-separated string of tokens which control the scrubbing behaviour:
    - `(+|-|*|/|&)(jumps|actions|reqs)` control how jump-links (`HTML` `a href`, `area href`, and similar), action-links (`HTML` `a ping`, `form action`, and similar), and references to page requisites (`HTML` `img src`, `iframe src`, `link src` that are `stylesheet`s or `icon`s, `CSS` `url` references, and similar) should be remapped or censored out:
      - `+` leave links of this kind pointing to their original URLs;
      - `-` void links of this kind, i.e., rewrite these links to `javascript:void(0)` and empty `data:` URLs;
      - `*` rewrite links of this kind in an "open"-ended way, i.e. point them to locally mirrored versions of their URLs when available, leave them pointing to their original URL otherwise; this is only supported when `scrub` is used with `export mirror` sub-command; under other sub-commands this is equivalent to `+`;
      - `/` rewrite links of this kind in a "close"-ended way, i.e. point them to locally mirrored versions URLs when available, and void them otherwise; this is only supported when `scrub` is used with `export mirror` sub-command; under other sub-commands this is equivalent to `-`;
      - `&` rewrite links of this kind in a "close"-ended way like `/` does, except use fallbacks to remap unavailable URLs whenever possible; this is only supported when `scrub` is used with `export mirror` sub-command, see the documentation of the `--remap-all` option for more info; under other sub-commands this is equivalent to `/`;

      when `scrub` is called manually, the default is `*jumps,&actions,&reqs` which produces a self-contained result that can be fed into another tool --- be it a web browser or `pandoc` --- without that tool trying to access the Internet;

      but, usually, the default is derived from `--remap-*` options, which see;
    - `(+|*|/|-)all_refs` is equivalent to setting all of the options listed in the previous item simultaneously;
    - `(+|-)unknown` controls if the data with unknown content types should passed to the output unchanged or censored out (respectively); the default is `+unknown`, which keeps data of unknown content types as-is;
    - `(+|-)(styles|scripts|iepragmas|iframes|prefetches|tracking)` control which things should be kept or censored out w.r.t. to `HTML`, `CSS`, and `JavaScript`, i.e. they control whether `CSS` stylesheets (both separate files and `HTML` tags and attributes), `JavaScript` (both separate files and `HTML` tags and attributes), `HTML` Internet Explorer pragmas, `<iframe>` `HTML` tags, `HTML` content prefetch `link` tags, and other tracking `HTML` tags and attributes (like `a ping` attributes), should be respectively kept in or censored out from the input; the default is `+styles,-scripts,-iepragmas,+iframes,-prefetches,-tracking` which ensures the result does not contain `JavaScript` and will not produce any prefetch and tracking requests when loaded in a web browser; `-iepragmas` is the default because censoring for contents of such pragmas is not supported yet;
    - `(+|-)all_dyns` is equivalent to enabling or disabling all of the options listed in the previous item simultaneously;
    - `(+|-)verbose` controls whether tag censoring controlled by the above options is to be reported in the output (as comments) or stuff should be wiped from existence without evidence instead; the default is `-verbose`;
    - `(+|-)whitespace` controls whether `HTML` and `CSS` renderers should keep the original whitespace as-is or collapse it away (respectively); the default is `-whitespace`, which produces somewhat minimized outputs (because it saves a lot of space);
    - `(+|-)optional_tags` controls whether `HTML` renderer should put optional `HTML` tags into the output or skip them (respectively); the default is `+optional_tags` (because many tools fail to parse minimized `HTML` properly);
    - `(+|-)indent` controls whether `HTML` and `CSS` renderers should indent their outputs (where whitespace placement in the original markup allows for it) or not (respectively); the default is `-indent` (to save space);
    - `+pretty` is an alias for `+verbose,-whitespace,+indent` which produces the prettiest possible human-readable output that keeps the original whitespace semantics; `-pretty` is an alias for `+verbose,+whitespace,-indent` which produces the approximation of the original markup with censoring applied; neither is the default;
    - `+debug` is a variant of `+pretty` that also uses a much more aggressive version of `indent` that ignores the semantics of original whitespace placement, i.e. it indents `<p>not<em>sep</em>arated</p>` as if there was whitespace before and after `p`, `em`, `/em`, and `/p` tags; this is useful for debugging; `-debug` is noop, which is the default;""",
        linst_scrub()),
})

ReqresExpr_lookup = linst_custom_or_env(ReqresExpr_atoms)

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

def _t_epoch(n : str, x : _t.Any) -> Epoch:
    return Epoch(Decimal(_t_int(n, x)) / 1000)

def _f_epoch(x : Epoch) -> int:
    return int(x * 1000)

def _t_headers(n : str, x : _t.Any) -> Headers:
    if Headers.__instancecheck__(x):
        return _t.cast(Headers, x)
    raise WRRTypeError(gettext("Reqres field `%s`: wrong type: want %s, got %s"), "Headers", type(x).__name__)

def wrr_load_raw(fobj : _io.BufferedReader) -> Reqres:
    try:
        data = _cbor2.load(fobj)
    except _cbor2.CBORDecodeValueError:
        raise WRRParsingError(gettext("CBOR parsing failure"))

    if type(data) != list or len(data) == 0:
        raise WRRParsingError(gettext("Reqres parsing failure: wrong spine"))

    if data[0] == "WEBREQRES/1":
        _, source, protocol, request_, response_, finished_at, extra = data
        rq_started_at, rq_method, rq_url, rq_headers, rq_complete, rq_body = request_
        purl = parse_url(_t_str("request.url", rq_url))
        if purl.scheme not in Reqres_url_schemes:
            raise WRRParsingError(gettext("Reqres field `request.url`: unsupported URL scheme `%s`"), purl.scheme)
        request = Request(_t_epoch("request.started_at", rq_started_at),
                          _t_str("request.method", rq_method),
                          purl,
                          _t_headers("request.headers", rq_headers),
                          _t_bool("request.complete", rq_complete),
                          _t_bytes_or_str("request.body", rq_body))
        if response_ is None:
            response = None
        else:
            rs_started_at, rs_code, rs_reason, rs_headers, rs_complete, rs_body = response_
            response = Response(_t_epoch("response.started_at", rs_started_at),
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
                websocket.append(WebSocketFrame(_t_epoch("ws.sent_at", sent_at),
                                                _t_bool("ws.from_client", from_client),
                                                _t_int("ws.opcode", opcode),
                                                _t_bytes("ws.content", content)))

        return Reqres(1, source, protocol, request, response, _t_epoch("finished_at", finished_at), extra, websocket)
    else:
        raise WRRParsingError(gettext("Reqres parsing failure: unknown format `%s`"), data[0])

def wrr_load(fobj : _io.BufferedReader) -> Reqres:
    fobj = ungzip_fobj_maybe(fobj)
    res = wrr_load_raw(fobj)
    p = fobj.peek(16)
    if p != b"":
        # there's some junk after the end of the Reqres structure
        raise WRRParsingError(gettext("expected EOF, got `%s`"), p)
    return res

def wrr_load_bundle(fobj : _io.BufferedReader, path : _t.AnyStr) -> _t.Iterator[Reqres]:
    fobj = ungzip_fobj_maybe(fobj)
    while True:
        p = fobj.peek(16)
        if p == b"": break
        res = wrr_load_raw(fobj)
        yield res

def wrr_load_expr(fobj : _io.BufferedReader,
                  path : str | bytes,
                  sniff : SniffContentType,
                  remap_url : URLRemapper | None = None) -> ReqresExpr:
    reqres = wrr_load(fobj)
    res = ReqresExpr(reqres, path, [], sniff, remap_url)
    return res

def wrr_loadf(path : str | bytes) -> Reqres:
    with open(path, "rb") as f:
        return wrr_load(f)

def wrr_loadf_expr(path : str | bytes,
                   sniff : SniffContentType,
                   remap_url : URLRemapper | None = None) -> ReqresExpr:
    with open(path, "rb") as f:
        return wrr_load_expr(f, path, sniff, remap_url)

def wrr_dumps(reqres : Reqres, compress : bool = True) -> bytes:
    req = reqres.request
    request = _f_epoch(req.started_at), req.method, req.url.raw_url, req.headers, req.complete, req.body
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

    if compress:
        return gzip_maybe(data)
    else:
        return data

def wrr_dump(fobj : _io.BufferedWriter, reqres : Reqres, compress : bool = True) -> None:
    data = wrr_dumps(reqres, compress)
    fobj.write(data)
