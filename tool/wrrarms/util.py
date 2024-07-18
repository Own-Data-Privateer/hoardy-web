# Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
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

import gzip as _gzip
import io as _io
import typing as _t

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

def ungzip_fobj_maybe(fobj : _io.BufferedReader) -> _io.BufferedReader:
    """UnGZip a file object if it appears to be GZipped."""

    head = fobj.peek(2)[:2]
    if head == b"\037\213":
        fobj = _t.cast(_io.BufferedReader, _gzip.GzipFile(fileobj=fobj, mode="rb"))
    return fobj
