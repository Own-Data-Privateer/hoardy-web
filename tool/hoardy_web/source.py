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

import abc as _abc
import dataclasses as _dc
import io as _io
import os as _os
import typing as _t

from gettext import gettext

from kisstdlib.exceptions import *

from .io import *

class DeferredSource(metaclass=_abc.ABCMeta):
    @_abc.abstractmethod
    def approx_size(self) -> int:
        raise NotImplementedError()

    @_abc.abstractmethod
    def show_source(self) -> str:
        raise NotImplementedError()

    @_abc.abstractmethod
    def get_fileobj(self) -> _io.BufferedReader:
        raise NotImplementedError()

    def get_bytes(self) -> bytes:
        with self.get_fileobj() as f:
            return f.read()

    def same_as(self, other : _t.Any) -> bool:
        return False

    def replaces(self, other : _t.Any) -> bool:
        return True

class UnknownSource(DeferredSource):
    def approx_size(self) -> int:
        return 8

    def show_source(self) -> str:
        return f"<{id(self)}>"

    def get_fileobj(self) -> _io.BufferedReader:
        raise NotImplementedError()

    def get_bytes(self) -> bytes:
        raise NotImplementedError()

class _BytesIOReader(_io.BytesIO):
    def peek(self, size : int = 0) -> bytes:
        return self.getvalue()[self.tell():size]

BytesIOReader = _t.cast(_t.Callable[[bytes], _io.BufferedReader], _BytesIOReader)

@_dc.dataclass
class BytesSource(DeferredSource):
    data : bytes

    def approx_size(self) -> int:
        return 16 + len(self.data)

    def get_fileobj(self) -> _io.BufferedReader:
        return BytesIOReader(self.data)

    def get_bytes(self) -> bytes:
        return self.data

    def replaces(self, other : DeferredSource) -> bool:
        if isinstance(other, BytesSource) and \
           self.data == other.data:
            return False
        return True

@_dc.dataclass
class FileSource(DeferredSource):
    path : str | bytes
    st_mtime_ns : int
    st_dev : int
    st_ino : int

    def approx_size(self) -> int:
        return 40 + len(self.path)

    def show_source(self) -> str:
        return fsdecode_maybe(self.path)

    def get_fileobj(self) -> _io.BufferedReader:
        fobj = open(self.path, "rb")
        in_stat = _os.fstat(fobj.fileno())
        if self.st_mtime_ns != in_stat.st_mtime_ns:
            raise Failure("`%s` changed between accesses", self.path)
        return fobj

    def same_as(self, other : DeferredSource) -> bool:
        if isinstance(other, FileSource) and \
           self.st_ino != 0 and other.st_ino != 0 and \
           self.st_dev == other.st_dev and \
           self.st_ino == other.st_ino:
            # same source file inode
            return True
        return False

    def replaces(self, other : DeferredSource) -> bool:
        if isinstance(other, FileSource) and self.path == other.path:
            return False
        return True

def make_FileSource(path : str | bytes, in_stat : _os.stat_result) -> FileSource:
    return FileSource(path, in_stat.st_mtime_ns, in_stat.st_dev, in_stat.st_ino)

DeferredSourceType = _t.TypeVar("DeferredSourceType", bound=DeferredSource)

@_dc.dataclass
class StreamElementSource(DeferredSource, _t.Generic[DeferredSourceType]):
    stream_source : DeferredSourceType
    num : int

    def approx_size(self) -> int:
        return 24 + self.stream_source.approx_size()

    def show_source(self) -> str:
        return self.stream_source.show_source() + "//" + str(self.num)

    def get_fileobj(self) -> _io.BufferedReader:
        raise NotImplementedError()

    def get_bytes(self) -> bytes:
        raise NotImplementedError()

    def replaces(self, other : DeferredSource) -> bool:
        if isinstance(other, StreamElementSource) and \
           self.stream_source == other.stream_source and \
           self.num == other.num:
            return False
        return True
