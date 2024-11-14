# Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
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

import gzip as _gzip
import io as _io
import typing as _t

InType = _t.TypeVar("InType")
OutType = _t.TypeVar("OutType")
def map_optional(f : _t.Callable[[InType], OutType], x : InType | None) -> OutType | None:
    if x is None:
        return None
    else:
        return f(x)

def map_optionals(f : _t.Callable[[InType], list[OutType]], x : InType | None) -> list[OutType]:
    if x is None:
        return []
    else:
        return f(x)

def gzip_maybe(data : bytes) -> bytes:
    """Given some bytes, return their GZipped version if they compress, return the original otherwise."""

    buf = _io.BytesIO()
    with _gzip.GzipFile(fileobj=buf, filename="", mtime=0, mode="wb", compresslevel=9) as gz:
        gz.write(data)
    compressed_data = buf.getvalue()

    if len(compressed_data) < len(data):
        return compressed_data
    else:
        return data

def ungzip_fileobj_maybe(fobj : _io.BufferedReader) -> _io.BufferedReader:
    """UnGZip a file object if it appears to be GZipped."""

    head = fobj.peek(2)[:2]
    if head == b"\037\213":
        fobj = _t.cast(_io.BufferedReader, _gzip.GzipFile(fileobj=fobj, mode="rb"))
    return fobj

PipeType = _t.TypeVar("PipeType")
def make_func_pipe(pipe : list[_t.Callable[[PipeType], PipeType]]) -> _t.Callable[[PipeType], PipeType]:
    def sub(x : PipeType) -> PipeType:
        for func in pipe:
            x = func(x)
        return x
    return sub

EnvType = _t.TypeVar("EnvType")
def make_envfunc_pipe(pipe : list[_t.Callable[[EnvType, PipeType], PipeType]]) -> _t.Callable[[EnvType, PipeType], PipeType]:
    def sub(env : EnvType, x : PipeType) -> PipeType:
        for func in pipe:
            x = func(env, x)
        return x
    return sub
