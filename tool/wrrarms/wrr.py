# Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
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
#
# This file is part of pwebarc project.

import cbor2 as _cbor2
import dataclasses as _dc
import gzip as _gzip
import io as _io
import logging as _logging
import os as _os
import sys as _sys
import typing as _t
import time as _time
import urllib.parse as _up
import hashlib as _hashlib

from kisstdlib.exceptions import *
from kisstdlib.path import *

from .type import *
from .linst import *

HeadersArray = list[tuple[str, bytes]]
class Headers(WrappedValue[HeadersArray]):
    @classmethod
    def __instancecheck__(cls, value : _t.Any) -> bool:
        return HeadersArray.__instancecheck__(value)

@_dc.dataclass
class Request(CheckedDataClass):
    started_at : EpochMsec
    method : str
    url : str
    headers : Headers
    complete : bool
    body : bytes

    def __post_init__(self) -> None:
        super().__post_init__()
        self.started_at = EpochMsec(_t.cast(int, self.started_at))
        self.headers = Headers(_t.cast(HeadersArray, self.headers))

@_dc.dataclass
class Response(CheckedDataClass):
    started_at : EpochMsec
    code : int
    reason : str
    headers : Headers
    complete : bool
    body : bytes | str

    def __post_init__(self) -> None:
        super().__post_init__()
        self.started_at = EpochMsec(_t.cast(int, self.started_at))
        self.headers = Headers(_t.cast(HeadersArray, self.headers))

@_dc.dataclass
class Reqres(CheckedDataClass):
    version : int
    source : str
    protocol : str
    request : Request
    response : _t.Optional[Response]
    finished_at : EpochMsec
    extra : dict[str, _t.Any]

    def __post_init__(self) -> None:
        super().__post_init__()
        self.finished_at = EpochMsec(self.finished_at) # type: ignore

Reqres_fields = {
    "version": "WEBREQRES format version; int",
    "source": "`+`-separated list of applications that produced this reqres; str",
    "protocol": 'protocol (e.g. `"HTTP/1.0"`, `"HTTP/2.0"`); str',
    "request.started_at": "request start time in milliseconds since 1970-01-01 00:00; EpochMsec",
    "request.method": 'request HTTP method (`"GET"`, `"POST"`, etc); str',
    "request.url": "request URL, including the fragment/hash part; str",
    "request.headers": "request headers; list[tuple[str, bytes]]",
    "request.complete": "is request body complete?; bool",
    "request.body": "request body; bytes",
    "response.started_at": "response start time in milliseconds since 1970-01-01 00:00; EpochMsec",
    "response.code": "HTTP response code (like `200`, `404`, etc); int",
    "response.reason": 'HTTP response reason (like `"OK"`, `"Not Found"`, etc); usually empty for Chromium and filled for Firefox; str',
    "response.headers": "response headers; list[tuple[str, bytes]]",
    "response.complete": "is response body complete?; bool",
    "response.body": "response body; Firefox gives raw bytes, Chromium gives UTF-8 encoded strings; bytes | str",
    "finished_at": "request completion time in milliseconds since 1970-01-01 00:00; EpochMsec"
}

Reqres_derived_attrs = {
    "fs_path": "file system path for the WRR file containing this reqres; str",

    "qtime_ms": 'aliast for `request.started_at`; mnemonic: "reQuest TIME"; int',
    "qtime": "`qtime_ms` rounded down to seconds (UNIX epoch); int",
    "qtime_msq": "three least significant digits of `qtime_ms`; int",
    "qyear": "year number of `gmtime(qtime)` (UTC year number of `qtime`); int",
    "qmonth": "month number of `gmtime(qtime)`; int",
    "qday": "day of the month of `gmtime(qtime)`; int",
    "qhour": "hour of `gmtime(qtime)` in 24h format; int",
    "qminute": "minute of `gmtime(qtime)`; int",
    "qsecond": "second of `gmtime(qtime)`; int",

    "stime_ms": '`response.started_at` if there was a response, `finished_at` otherwise; mnemonic: "reSponse TIME"; int',
    "stime": "`stime_ms` rounded down to seconds (UNIX epoch); int",
    "stime_msq": "three least significant digits of `stime_msq`; int",
    "syear": "similar to `syear`, but for `stime`; int",
    "smonth": "similar to `smonth`, but for `stime`; int",
    "sday": "similar to `sday`, but for `stime`; int",
    "shour": "similar to `shour`, but for `stime`; int",
    "sminute": "similar to `sminute`, but for `stime`; int",
    "ssecond": "similar to `ssecond`, but for `stime`; int",

    "ftime_ms": "aliast for `finished_at`; int",
    "ftime": "`ftime_ms` rounded down to seconds (UNIX epoch); int",
    "ftime_msq": "three least significant digits of `ftime_msq`; int",
    "fyear": "similar to `syear`, but for `ftime`; int",
    "fmonth": "similar to `smonth`, but for `ftime`; int",
    "fday": "similar to `sday`, but for `ftime`; int",
    "fhour": "similar to `shour`, but for `ftime`; int",
    "fminute": "similar to `sminute`, but for `ftime`; int",
    "fsecond": "similar to `ssecond`, but for `ftime`; int",

    "status": '`"NR"` if there was no response, `str(response.code) + "C"` if response was complete, `str(response.code) + "N"` otherwise; str',

    "method": "aliast for `request.method`; str",
    "full_url": "aliast for `request.url`; str",
    "net_url": "`request.url` without the fragment/hash part, if any, this is the URL that actually gets sent to the server; str",
    "scheme": "scheme part of `request.url` (`http`, `https`); str",
    "netloc": "netloc part of `request.url` (i.e., in the most general case, `<username>:<password>@<hostname>:<port>`)",
    "hostname": "hostname part of `request.url`",
    "rhostname": 'hostname part of `request.url` with the order of parts reversed, e.g. `"https://www.example.com"` -> `"com.example.www"`',
    "raw_path": 'raw path part of `request.url`, e.g. `"https://www.example.com"` -> `""`, `"https://www.example.com/"` -> `"/"`, `"https://www.example.com/index.html"` -> `"/index.html"`',
    "path": '`raw_path` without the leading slash, if any, e.g. `"https://www.example.com"` -> `""`, `"https://www.example.com/"` -> `""`, `"https://www.example.com/index.html"` -> `"index.html"`',
    "ipath": '`path + "index.html"` if `path` is empty or ends with a slash, `path` otherwise',
    "query": "query part of `request.url` (everything after the `?` character and before the `#` character)",
    "nquery": "normalized `query` (with empty query parameters removed)",
    "nquery_url": "`full_url` with normalized `query`; str",
    "oqm": "optional query mark: `?` character if `query` is non-empty, an empty string otherwise; str",
    "fragment": "fragment (hash) part of the url; str",
    "ofm": "optional fragment mark: `#` character if `fragment` is non-empty, an empty string otherwise; str",
}

_time_attrs = set(["time", "time_ms", "time_msq", "year", "month", "day", "hour", "minute", "second"])

class ReqresExpr:
    reqres : Reqres
    items : dict[str, _t.Any]

    def __init__(self, reqres : Reqres, path : str) -> None:
        self.reqres = reqres
        self.items = {
            "fs_path": path
        }

    def _fill_time(self, prefix : str, ts : int) -> None:
        dt = _time.gmtime(ts)
        self.items[prefix + "year"] = dt.tm_year
        self.items[prefix + "month"] = dt.tm_mon
        self.items[prefix + "day"] = dt.tm_mday
        self.items[prefix + "hour"] = dt.tm_hour
        self.items[prefix + "minute"] = dt.tm_min
        self.items[prefix + "second"] = dt.tm_sec

    def _get_value(self, name : str) -> _t.Any:
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
            qtime_ms = int(reqres.request.started_at)
            qtime = qtime_ms // 1000
            self.items["qtime_ms"] = qtime_ms
            self.items["qtime"] = qtime
            self.items["qtime_msq"] = qtime_ms % 1000
            self._fill_time("q", qtime)
        elif (name.startswith("s") and \
              name[1:] in _time_attrs) or \
              name == "status":
            if reqres.response is not None:
                stime_ms = int(reqres.response.started_at)
                status = str(reqres.response.code)
                if reqres.response.complete:
                    status += "C"
                else:
                    status += "N"
            else:
                stime_ms = int(reqres.finished_at)
                status = "NR"
            self.items["status"] = status
            stime = stime_ms // 1000
            self.items["stime_ms"] = stime_ms
            self.items["stime"] = stime
            self.items["stime_msq"] = stime_ms % 1000
            self._fill_time("s", stime)
        elif (name.startswith("f") and \
              name[1:] in _time_attrs):
            ftime_ms = int(reqres.finished_at)
            ftime = ftime_ms // 1000
            self.items["ftime_ms"] = ftime_ms
            self.items["ftime"] = ftime
            self.items["ftime_msq"] = ftime_ms % 1000
            self._fill_time("f", ftime)
        elif name in ["full_url", "net_url",
                      "scheme", "netloc", "hostname", "rhostname",
                      "raw_path", "path",
                      "oqm",
                      "query", "nquery", "nquery_url",
                      "ofm", "fragment"]:
            url = reqres.request.url
            self.items["full_url"] = url
            purl = _up.urlsplit(url)
            netloc = purl.netloc
            query = purl.query
            oqm = "?" if query != "" else ""
            fragment = purl.fragment
            ofm = "#" if fragment != "" else ""

            net_url = f"{purl.scheme}://{netloc}{purl.path}{oqm}{query}"
            self.items["net_url"] = net_url

            self.items["scheme"] = purl.scheme
            self.items["netloc"] = netloc

            hostname = purl.hostname
            if hostname is None: assert False
            self.items["hostname"] = hostname

            hparts = hostname.split(".")
            hparts.reverse()
            hostname_rev = ".".join(hparts)
            self.items["rhostname"] = hostname_rev

            self.items["raw_path"] = purl.path
            path = purl.path
            if path.startswith("/"):
                path = path[1:]
            self.items["path"] = path
            if path == "" or path.endswith("/"):
                self.items["ipath"] = path + "index.html"
            else:
                self.items["ipath"] = path
            self.items["oqm"] = oqm
            self.items["query"] = query
            nquery = _up.urlencode(_up.parse_qsl(query))
            self.items["nquery"] = nquery

            nquery_url = f"{purl.scheme}://{netloc}{purl.path}{oqm}{nquery}{ofm}{fragment}"
            self.items["nquery_url"] = nquery_url

            self.items["ofm"] = ofm
            self.items["fragment"] = fragment
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
        return self._get_value(name)

    def _get_atom(self, name : str) -> LinstAtom:
        try:
            return linst_atoms[name][1]
        except KeyError:
            return linst_getenv(name)

    def eval(self, expr : str) -> _t.Any:
        ce = linst_compile(expr, self._get_atom)
        return ce(self._get_value, None)

    def __getitem__(self, expr : str) -> _t.Any:
        # this is used in `format_string % self` expressions
        res = self.eval(expr)
        if res is None:
            raise Failure("expression `%s` evaluated to `None`", expr)
        return res

class ParsingError(Failure): pass

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
        request = Request(*request_)
        if response_ is None:
            response = None
        else:
            response = Response(*response_)

        return Reqres(1, source, protocol, request, response, finished_at, extra)
    else:
        raise ParsingError("can't parse CBOR data: unknown format %s", data[0])

def wrr_loadf(path : str | bytes) -> Reqres:
    with open(path, "rb") as f:
        return wrr_load(f)

def wrr_dump(fobj : _io.BufferedWriter, reqres : Reqres, compress : bool = True) -> None:
    req = reqres.request
    request = req.started_at, req.method, req.url, req.headers.value, req.complete, req.body
    del req

    if reqres.response is None:
        response = None
    else:
        res = reqres.response
        response = res.started_at, res.code, res.reason, res.headers.value, res.complete, res.body
        del res

    structure = ["WEBREQRES/1", reqres.source, reqres.protocol, request, response, reqres.finished_at, reqres.extra]

    if not compress:
        _cbor2.dump(fobj, structure)
        return

    data = _cbor2.dumps(structure)

    # gzip it, if it gzips
    buf = _io.BytesIO()
    with _gzip.GzipFile(fileobj=buf, filename="", mtime=0, mode="wb", compresslevel=9) as gz:
        gz.write(data)
    compressed_data = buf.getvalue()
    del buf

    if len(compressed_data) < len(data):
        data = compressed_data
    del compressed_data

    fobj.write(data)

MapElem = _t.TypeVar("MapElem")
def wrr_map_paths(func : _t.Callable[[Reqres, _t.AnyStr, _t.AnyStr], MapElem],
                  paths : list[_t.AnyStr],
                  errors : str = "fail",
                  follow_symlinks : bool = True) -> _t.Iterable[tuple[_t.AnyStr, MapElem]]:
    for dir_or_file_path in paths:
        dir_or_file_path = _os.path.expanduser(dir_or_file_path)
        for path in walk_orderly(dir_or_file_path,
                                 include_directories = False,
                                 follow_symlinks = follow_symlinks,
                                 handle_error = None if errors == "fail" else _logging.error):
            if (isinstance(path, str) and path.endswith(".part")) or \
               (isinstance(path, bytes) and path.endswith(b".part")):
                continue
            try:
                try:
                    abs_path = _os.path.abspath(path)
                    if not follow_symlinks and _os.path.islink(abs_path):
                        raise Failure("not following a symlink")
                    reqres = wrr_loadf(abs_path)
                except OSError as exc:
                    raise Failure("failed to open")

                res = func(reqres, abs_path, path)
                yield abs_path, res
            except Failure as exc:
                if errors == "ignore":
                    continue
                exc.elaborate("while processing %s", path)
                if errors != "fail":
                    _logging.error("%s", str(exc))
                    continue
                raise exc
