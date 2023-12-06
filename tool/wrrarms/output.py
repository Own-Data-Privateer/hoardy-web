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

import cbor2.decoder as _cbor2dec
import cbor2.encoder as _cbor2enc
import io as _io
import json as _json
import typing as _t

from kisstdlib.exceptions import *
from kisstdlib.io import *

from .wrr import *
from .type import *

def abridge_anystr(value : _t.AnyStr, length : int, ln : bool) -> tuple[bool, _t.AnyStr]:
    hlength = length // 2
    if len(value) > length:
        if isinstance(value, bytes):
            return True, value[:hlength] + (b"\n...\n" if ln else b" ... ") + value[-hlength:]
        else:
            return True, value[:hlength] + ("\n...\n" if ln else " ... ") + value[-hlength:]
    else:
        return False, value

def wrr_pprint(fobj : TIOWrappedWriter, reqres : Reqres, path : str | bytes, abridge : bool) -> None:
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
    fobj.write_str_ln(f"WEBREQRES/{str(reqres.version)} {reqres.protocol} {req.method} {req.url} {code} {reason}")
    fobj.write_str_ln(f"source {reqres.source}")

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

    fobj.write_str_ln(f"clock {fmt_epoch_interval(req.started_at, reqres.finished_at)}")

    if len(reqres.extra) > 0:
        for k, v in reqres.extra.items():
            fobj.write_str(k + " ")
            fobj.write_bytes(pyrepr_dumps(v, starting_indent = 2, width = 80, default = PyStreamEncoder.encode_py).lstrip())
        fobj.write_str_ln("")

    def dump_data(data : str | bytes, complete : str) -> None:
        def encode(value : str) -> bytes:
            return value.encode(fobj.encoding)

        final = False
        raw = False
        if isinstance(data, str):
            if data.find("\0") != -1:
                guess = "binary"
            else:
                guess = f"text encoding={fobj.encoding}"
                raw = True
            data = encode(data)
        elif isinstance(data, bytes):
            guess = "binary"
        else:
            assert False

        if data.startswith(b"\x89PNG"):
            guess = "image/png"
            final, raw = True, False
        elif data.startswith(b"\xff\xd8\xff\xe0\x00\x10JFIF"):
            guess = "image/jpeg"
            final, raw = True, False
        elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            guess = "image/webp"
            final, raw = True, False

        if not final:
            try:
                js = _json.loads(data.decode(fobj.encoding, errors = "replace"))
            except _json.decoder.JSONDecodeError:
                pass
            else:
                guess = f"json"
                jsdump = _json.dumps(js, ensure_ascii = False, indent = 2)
                data = encode(jsdump)
                final, raw = True, True

        if not final:
            try:
                with _io.BytesIO(data) as fp:
                    cb = _cbor2dec.CBORDecoder(fp).decode()
                    if len(fp.read()) != 0:
                        # not all of the data was decoded
                        raise Exception("failed to parse")
                cbordump = pyrepr_dumps(cb, width = 80)
            except Exception:
                pass
            else:
                guess = "cbor"
                data = cbordump
                final, raw = True, True

        if not final and guess.startswith("text"):
            data_strip = data.strip()
            if data_strip.startswith(b"<svg ") and data_strip.endswith(b"</svg>"):
                guess = "image/svg+xml"
                final, raw = True, True

        if not final and guess.startswith("text"):
            if data.find(b"<html") != -1:
                guess += "/html"
                if data.find(b"</html>") == -1:
                    guess += " incomplete=true"
                final, raw = True, True

        status = ""
        if raw:
            status += ", raw"
        else:
            data = encode(repr(data)[2:-1])
            status += ", quoted"

        abridged = abridge
        if abridge:
            abridged, data = abridge_anystr(data, 1024, True)
        if abridged:
            status += ", abridged"

        fobj.write_str_ln(f"({complete}, {len(data)} bytes, {guess}{status}):")
        fobj.write_bytes_ln(data)

    def dump_headers(headers : Headers, indent : str = "") -> None:
        for name, value in headers:
            fobj.write_str(indent + name + ": ")
            fobj.write_bytes_ln(value)

    fobj.write_str_ln("\nRequest headers:")
    dump_headers(req.headers, "  ")

    if res is not None:
        fobj.write_str_ln("\nResponse headers:")
        dump_headers(res.headers, "  ")

    if len(req.body) > 0:
        fobj.write_str("\nRequest body ")
        dump_data(req.body, req_complete)
    else:
        fobj.write_str_ln("\nEmpty request body")

    if res is not None:
        if len(res.body) > 0:
            fobj.write_str("\nResponse body ")
            dump_data(res.body, res_complete)
        else:
            fobj.write_str_ln("\nEmpty response body")

    fobj.write_str_ln("")

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

        encoders = _cbor2enc.default_encoders.copy()
        if abridged:
            encoders[bytes] = _t.cast(_t.Any, self.encode_cbor_abridged)
            encoders[str] = _t.cast(_t.Any, self.encode_cbor_abridged)
        self.encoder = _cbor2enc.CBOREncoder(_io.BytesIO(), default = self.encode_cbor)
        self.encoder._encoders = encoders

    @staticmethod
    def encode_cbor(enc : _cbor2enc.CBOREncoder, obj : _t.Any) -> None:
        enc.encode(plainify(obj))

    @staticmethod
    def encode_cbor_abridged(enc : _cbor2enc.CBOREncoder, obj : _t.Any) -> None:
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
            self.fobj.write_bytes(self.encoder.fp.getvalue())
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
        if isinstance(obj, Epoch):
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
        if isinstance(obj, Epoch):
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
