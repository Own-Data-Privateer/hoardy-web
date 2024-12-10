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
import io as _io
import json as _json
import typing as _t

from kisstdlib.exceptions import *
from kisstdlib.io import *
from kisstdlib.io.stdio import *

from .wrr import *

def plainify(obj : _t.Any) -> _t.Any:
    if isinstance(obj, TimeStamp):
        return float(obj)
    elif hasattr(obj, "__dataclass_fields__"):
        res = dict()
        for k in obj.__dataclass_fields__:
            res[k] = getattr(obj, k)
        return res
    else:
        raise Failure("can't plainify a value of type `%s`", type(obj).__name__)

def abridge_anystr(value : _t.AnyStr, length : int, ln : bool) -> tuple[bool, _t.AnyStr]:
    hlength = length // 2
    if len(value) > length:
        if isinstance(value, bytes):
            return True, value[:hlength] + (b"\n...\n" if ln else b" ... ") + value[-hlength:]
        else:
            return True, value[:hlength] + ("\n...\n" if ln else " ... ") + value[-hlength:]
    else:
        return False, value

def wrr_pprint(fobj : TIOWrappedWriter, reqres : Reqres, path : str | bytes, abridge : bool, sniff : SniffContentType) -> None:
    req = reqres.request
    res = reqres.response

    code = "?"
    reason = ""
    if res is not None:
        code = str(res.code)
        reason = res.reason

    if path is not None:
        fobj.write_str("file ")
        if isinstance(path, str):
            fobj.write_str_ln(path)
        elif isinstance(path, bytes):
            fobj.write_bytes_ln(path)
        else:
            assert False
    fobj.write_str_ln(f"WEBREQRES/{str(reqres.version)} {reqres.protocol} {req.method} {req.url.raw_url} {code} {reason}")
    fobj.write_str_ln(f"agent {reqres.agent}")

    req_complete = "incomplete"
    if req.complete:
        req_complete = "complete"
    fobj.write_str_ln(f"request {req_complete} {str(len(req.headers))} headers {str(len(req.body))} bytes")

    if res is not None:
        res_complete = "incomplete"
        if res.complete:
            res_complete = "complete"
        fobj.write_str_ln(f"response {res_complete} {str(len(res.headers))} headers {str(len(res.body))} bytes")
    else:
        fobj.write_str_ln("response none")

    fobj.write_str_ln(f"clock {TimeRange(req.started_at, reqres.finished_at).format_org(precision=3)}")

    if len(reqres.extra) > 0:
        for k, v in reqres.extra.items():
            fobj.write_str(k + " ")
            fobj.write_bytes(pyrepr_dumps(v, starting_indent = 2, width = 80, default = PyStreamEncoder.encode_py).lstrip())
            fobj.write_str_ln("")

    def dump_data(rr : Request | Response, complete : str) -> None:
        data = rr.body
        kinds, mime, charset, _ = rr.discern_content_type(sniff)

        unfinished = True
        if "json" in kinds or "unknown" in kinds:
            try:
                if isinstance(data, bytes):
                    data = data.decode(charset or fobj.encoding)
                js = _json.loads(data)
            except UnicodeDecodeError:
                pass
            except _json.decoder.JSONDecodeError:
                pass
            else:
                kinds = set(["json", "text"])
                mime = "application/json"
                charset = charset or fobj.encoding
                data = _json.dumps(js, ensure_ascii = False, indent = 2).encode(fobj.encoding)
                unfinished = False

        if unfinished and ("cbor" in kinds or "unknown" in kinds) and isinstance(data, bytes):
            try:
                with _io.BytesIO(data) as fp:
                    cb = _cbor2.CBORDecoder(fp).decode()
                    if len(fp.read()) != 0:
                        # not all of the data was decoded
                        raise Exception("failed to parse")
                cbordump = pyrepr_dumps(cb, width = 80)
            except Exception:
                pass
            else:
                kinds = set(["cbor"])
                mime = "application/cbor"
                charset = None
                data = cbordump
                unfinished = False

        if "text" not in kinds:
            if isinstance(data, bytes):
                data = repr(data)[2:-1].encode(fobj.encoding)
            else:
                data = repr(data)[1:-1].encode(fobj.encoding)
            status = ", quoted"
        else:
            status = ", raw"

        abridged = abridge
        if abridge:
            abridged, data = abridge_anystr(data, 1024, True) # type: ignore
        if abridged:
            status += ", abridged"

        what = ", ".join(kinds)
        fobj.write_str_ln(f"({complete}, {len(data)} bytes, {mime}, potentially [{what}]{status}):")
        fobj.write(data)
        fobj.write_str_ln("")

    def dump_headers(headers : Headers, indent : str = "") -> None:
        for name, value in headers:
            fobj.write_str(indent + name + ": ")
            fobj.write_bytes_ln(value)

    fobj.write_str_ln("")
    fobj.write_str_ln("Request headers:")
    dump_headers(req.headers, "  ")

    if res is not None:
        fobj.write_str_ln("")
        fobj.write_str_ln("Response headers:")
        dump_headers(res.headers, "  ")

    fobj.write_str_ln("")
    if len(req.body) > 0:
        fobj.write_str("Request body ")
        dump_data(req, req_complete)
    else:
        fobj.write_str_ln("Empty request body")

    if res is not None:
        fobj.write_str_ln("")
        if len(res.body) > 0:
            fobj.write_str("Response body ")
            dump_data(res, res_complete)
        else:
            fobj.write_str_ln("Empty response body")

    fobj.write_str_ln("")
    fobj.flush()

StreamEncoderElem = _t.TypeVar("StreamEncoderElem")
class StreamEncoder:
    def __init__(self, fobj : TIOWrappedWriter, abridged : bool) -> None:
        self.fobj = fobj
        self.abridged = abridged
        self.not_first = False

    def start(self) -> None:
        self.not_first = False

    def emit(self, path : str, names : list[str], values : list[_t.Any]) -> None:
        pass

    def finish(self) -> None:
        self.fobj.flush()

class CBORStreamEncoder(StreamEncoder):
    def __init__(self, fobj : TIOWrappedWriter, abridged : bool) -> None:
        super().__init__(fobj, abridged)

        encoders = _cbor2.default_encoders.copy()
        if abridged:
            encoders[bytes] = _t.cast(_t.Any, self.encode_cbor_abridged)
            encoders[str] = _t.cast(_t.Any, self.encode_cbor_abridged)
        self.encoder = _cbor2.CBOREncoder(_io.BytesIO(), encoders = encoders, default = self.encode_cbor)

    @staticmethod
    def encode_cbor(enc : _cbor2.CBOREncoder, obj : _t.Any) -> None:
        enc.encode(plainify(obj))

    @staticmethod
    def encode_cbor_abridged(enc : _cbor2.CBOREncoder, obj : _t.Any) -> None:
        abridged, value = abridge_anystr(obj, 256, False)
        if isinstance(value, bytes):
            enc.encode_bytestring(value)
        elif isinstance(value, str):
            enc.encode_string(value)
        else:
            assert False

    def start(self) -> None:
        super().start()
        self.fobj.write_bytes(b"\x9f") # start indefinite-length array

    def emit(self, path : str, names : list[str], values : list[_t.Any]) -> None:
        try:
            self.encoder.encode(values)
            self.fobj.write_bytes(self.encoder.fp.getvalue()) # type: ignore
        finally:
            self.encoder.fp = _io.BytesIO()

    def finish(self) -> None:
        self.fobj.write_bytes(b"\xff") # break symbol
        super().finish()

class PyStreamEncoder(StreamEncoder):
    def __init__(self, fobj : TIOWrappedWriter, abridged : bool) -> None:
        super().__init__(fobj, abridged)

        encoders = pyrepr_default_encoders.copy()
        if abridged:
            encoders[bytes] = _t.cast(_t.Any, self.encode_py_abridged)
            encoders[str] = _t.cast(_t.Any, self.encode_py_abridged)
        self.encoder = PyReprEncoder(_io.BytesIO(),
                                     width = 80, indent = 2, starting_indent = 0,
                                     encoders = encoders, default = self.encode_py)

    @staticmethod
    def encode_py(enc : PyReprEncoder, obj : _t.Any) -> None:
        if isinstance(obj, TimeStamp):
            enc.lexeme(str(obj))
            enc.comment(obj.format())
        else:
            enc.encode(plainify(obj))

    @staticmethod
    def encode_py_abridged(enc : PyReprEncoder, obj : _t.AnyStr) -> None:
        abridged, value = abridge_anystr(repr(obj), 256, False)
        enc.lexeme(value)
        if abridged:
            if isinstance(obj, bytes):
                enc.comment(f"{len(obj)} bytes total")
            else:
                enc.comment(f"{len(obj)} characters total")

    def start(self) -> None:
        super().start()
        self.fobj.write_str_ln("[")

    def emit(self, path : str, names : list[str], values : list[_t.Any]) -> None:
        try:
            if self.not_first:
                self.encoder.write_str(",")
                self.encoder.flush_line(True)
            else:
                self.not_first = True
            self.encoder.encode(values)
            self.fobj.write_bytes(self.encoder.fobj.getvalue())
        finally:
            self.encoder.fobj = _io.BytesIO()

    def finish(self) -> None:
        self.fobj.write_str_ln("\n]")
        super().finish()

class JSONStreamEncoder(StreamEncoder):
    def start(self) -> None:
        super().start()
        self.fobj.write_str_ln("[")

    @staticmethod
    def encode_json(obj : _t.Any) -> _t.Any:
        if isinstance(obj, bytes):
            return obj.decode("utf-8", errors = "replace")
        return plainify(obj)

    @staticmethod
    def abridge_json(obj : _t.Any) -> _t.Any:
        try:
            obj = plainify(obj)
        except Exception:
            pass

        if obj is None or isinstance(obj, (bool, int, float)):
            return obj
        elif isinstance(obj, (str, bytes)):
            _, value = abridge_anystr(obj, 256, False) # type: ignore
            return value
        elif isinstance(obj, list):
            return [JSONStreamEncoder.abridge_json(a) for a in obj]
        elif isinstance(obj, dict):
            return {k: JSONStreamEncoder.abridge_json(v) for k, v in obj.items()}
        raise Failure("can't abridge a value of type `%s`", type(obj).__name__)

    def emit(self, path : str, names : list[str], values : list[_t.Any]) -> None:
        if self.abridged:
            values = self.abridge_json(values)
        data = _json.dumps(values, ensure_ascii = False, indent = 2, default = self.encode_json)
        if self.not_first:
            self.fobj.write_str_ln(",")
        else:
            self.not_first = True
        self.fobj.write_str(data)

    def finish(self) -> None:
        self.fobj.write_str_ln("\n]")
        super().finish()

class RawStreamEncoder(StreamEncoder):
    def __init__(self, fobj : TIOWrappedWriter, abridged : bool, terminator : bytes) -> None:
        super().__init__(fobj, abridged)
        self.terminator = terminator

        encoders = tio_default_encoders.copy()
        if abridged:
            encoders[bytes] = _t.cast(_t.Any, self.encode_raw_abridged)
            encoders[str] = _t.cast(_t.Any, self.encode_raw_abridged)
        self.encoder = TIOEncoder(_io.BytesIO(), self.terminator, stdout.encoding,
                                  encoders = encoders, default = self.encode_raw)

    @staticmethod
    def encode_raw(enc : TIOEncoder, obj : _t.Any) -> None:
        if isinstance(obj, TimeStamp):
            enc.write_str(str(obj))
        else:
            raise Failure("can't raw-encode a value of type `%s`", type(obj).__name__)

    @staticmethod
    def encode_raw_abridged(enc : TIOEncoder, obj : _t.AnyStr) -> None:
        abridged, value = abridge_anystr(obj, 256, False)
        if isinstance(obj, bytes):
            enc.write_bytes(value)
        else:
            enc.write_str(value)
        if abridged:
            if isinstance(obj, bytes):
                enc.write_str(f" # {len(obj)} bytes total")
            else:
                enc.write_str(f" # {len(obj)} characters total")

    def emit(self, path : str, names : list[str], values : list[_t.Any]) -> None:
        try:
            for i in range(0, len(values)):
                name, value = names[i], values[i]
                try:
                    self.encoder.encode(value)
                except Failure as exc:
                    exc.elaborate("while encoding attribute `%s'", name)
                    raise exc
                self.encoder.write_bytes(self.terminator)
            self.fobj.write_bytes(self.encoder.fobj.getvalue())
        finally:
            self.encoder.fobj = _io.BytesIO()
