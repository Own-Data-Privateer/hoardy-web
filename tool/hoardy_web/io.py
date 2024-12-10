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

import dataclasses as _dc
import errno as _errno
import io as _io
import os as _os
import shutil as _shutil
import stat as _stat
import sys as _sys
import typing as _t

_have_fcntl = False
try:
    import fcntl as _fcntl
except ImportError:
    pass
else:
    _have_fcntl = True

def fsdecode_maybe(x : str | bytes) -> str:
    if isinstance(x, bytes):
        return _os.fsdecode(x)
    else:
        return x

def read_whole_file_maybe(path : str | bytes) -> bytes | None:
    try:
        with open(path, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None

def fsync_maybe(fd : int) -> None:
    try:
        _os.fsync(fd)
    except OSError as exc:
        if exc.errno != _errno.EINVAL:
            raise exc
        # EINVAL means fd is not attached to a file, so we
        # ignore this error

def fsync_fpath(fpath : str | bytes, flags : int = 0) -> None:
    fd = _os.open(fpath, _os.O_RDONLY | flags)
    try:
        _os.fsync(fd)
    finally:
        _os.close(fd)

def fileobj_content_equals(f : _io.BufferedReader, data : bytes) -> bool:
    # TODO more efficiently
    fdata = f.read()
    return fdata == data

def file_content_equals(path : str | bytes, data : bytes) -> bool:
    try:
        with open(path, "rb") as f:
            return fileobj_content_equals(f, data)
    except FileNotFoundError:
        return False

class DeferredSync:
    """Deferred file system syncs and unlinks."""

    replaces : list[tuple[str | bytes, str | bytes]]
    files : set[str | bytes]
    dirs : set[str | bytes]
    unlinks : set[str | bytes]

    def __init__(self) -> None:
        self.replaces = []
        self.files = set()
        self.dirs = set()
        self.unlinks = set()

    def sync(self) -> None:
        if len(self.replaces) > 0:
            for fpath, _ in self.replaces:
                fsync_fpath(fpath)

            for ffrom, fto in self.replaces:
                _os.replace(ffrom, fto)
            self.replaces = []

        if len(self.files) > 0:
            for fpath in self.files:
                fsync_fpath(fpath)
            self.files = set()

        if len(self.dirs) > 0:
            for fpath in self.dirs:
                fsync_fpath(fpath, _os.O_DIRECTORY)
            self.dirs = set()

    def finish(self) -> None:
        self.sync()

        if len(self.unlinks) > 0:
            for fpath in self.unlinks:
                try:
                    _os.unlink(fpath)
                except Exception:
                    pass
            self.unlinks = set()

def make_file(make_dst : _t.Callable[[_t.AnyStr], None], dst : _t.AnyStr,
              allow_overwrites : bool = False,
              *,
              dsync : DeferredSync | None = None) -> None:
    if not allow_overwrites and _os.path.lexists(dst):
        # fail early
        raise FileExistsError(_errno.EEXIST, _os.strerror(_errno.EEXIST), dst)

    dirname = _os.path.dirname(dst)

    _os.makedirs(dirname, exist_ok = True)
    make_dst(dst)

    if dsync is None:
        fsync_fpath(dst)
        fsync_fpath(dirname, _os.O_DIRECTORY)
    else:
        dsync.files.add(dst)
        dsync.dirs.add(dirname)

def atomic_make_file(make_dst : _t.Callable[[_t.AnyStr], None], dst : _t.AnyStr,
                     allow_overwrites : bool = False,
                     *,
                     dsync : DeferredSync | None = None) -> None:
    if not allow_overwrites and _os.path.lexists(dst):
        # fail early
        raise FileExistsError(_errno.EEXIST, _os.strerror(_errno.EEXIST), dst)

    dirname = _os.path.dirname(dst)
    if isinstance(dst, str):
        dst_part = dst + ".part"
    else:
        dst_part = dst + b".part"

    _os.makedirs(dirname, exist_ok = True)
    make_dst(dst_part)

    if dsync is None:
        fsync_fpath(dst_part)

    dirfd = _os.open(dirname, _os.O_RDONLY | _os.O_DIRECTORY)
    if _have_fcntl:
        _fcntl.flock(dirfd, _fcntl.LOCK_EX)

    try:
        # this is now atomic on POSIX
        if not allow_overwrites and _os.path.lexists(dst):
            raise FileExistsError(_errno.EEXIST, _os.strerror(_errno.EEXIST), dst)

        if dsync is None:
            _os.replace(dst_part, dst)
            _os.fsync(dirfd)
        else:
            dsync.replaces.append((dst_part, dst))
            dsync.dirs.add(dirname)
    finally:
        if _have_fcntl:
            _fcntl.flock(dirfd, _fcntl.LOCK_UN)
        _os.close(dirfd)

def atomic_copy2(src : _t.AnyStr, dst : _t.AnyStr,
                 allow_overwrites : bool = False,
                 *,
                 follow_symlinks : bool = True,
                 dsync : DeferredSync | None = None) -> None:
    def make_dst(dst_part : _t.AnyStr) -> None:
        if not follow_symlinks and _os.path.islink(src):
            _os.symlink(_os.readlink(src), dst_part)
        else:
            with open(src, "rb") as fsrc:
                try:
                    with open(dst_part, "xb") as fdst:
                        _shutil.copyfileobj(fsrc, fdst)
                except Exception as exc:
                    try: _os.unlink(dst_part)
                    except Exception: pass
                    raise exc
        _shutil.copystat(src, dst_part, follow_symlinks = follow_symlinks)

    # always use the atomic version here, like rsync does,
    # since copying can be interrupted in the middle
    atomic_make_file(make_dst, dst, allow_overwrites, dsync = dsync)

def atomic_link(src : _t.AnyStr, dst : _t.AnyStr,
                allow_overwrites : bool = False,
                *,
                follow_symlinks : bool = True,
                dsync : DeferredSync | None = None) -> None:
    if follow_symlinks and _os.path.islink(src):
        src = _os.path.realpath(src)

    def make_dst(dst_part : _t.AnyStr) -> None:
        _os.link(src, dst_part, follow_symlinks = follow_symlinks)

    # _os.link is atomic, so non-atomic make_file is ok
    if allow_overwrites:
        atomic_make_file(make_dst, dst, allow_overwrites, dsync = dsync)
    else:
        make_file(make_dst, dst, allow_overwrites, dsync = dsync)

def atomic_symlink(src : _t.AnyStr, dst : _t.AnyStr,
                   allow_overwrites : bool = False,
                   *,
                   follow_symlinks : bool = True,
                   dsync : DeferredSync | None = None) -> None:
    if follow_symlinks and _os.path.islink(src):
        src = _os.path.realpath(src)

    def make_dst(dst_part : _t.AnyStr) -> None:
        _os.symlink(src, dst_part)

    # _os.symlink is atomic, so non-atomic make_file is ok
    if allow_overwrites:
        atomic_make_file(make_dst, dst, allow_overwrites, dsync = dsync)
    else:
        make_file(make_dst, dst, allow_overwrites, dsync = dsync)

def atomic_link_or_copy2(src : _t.AnyStr, dst : _t.AnyStr,
                         allow_overwrites : bool = False,
                         *,
                         follow_symlinks : bool = True,
                         dsync : DeferredSync | None = None) -> None:
    try:
        atomic_link(src, dst, allow_overwrites, follow_symlinks = follow_symlinks, dsync = dsync)
    except OSError as exc:
        if exc.errno != _errno.EXDEV:
            raise exc
        atomic_copy2(src, dst, allow_overwrites, follow_symlinks = follow_symlinks, dsync = dsync)

def atomic_move(src : _t.AnyStr, dst : _t.AnyStr,
                allow_overwrites : bool = False,
                *,
                follow_symlinks : bool = True,
                dsync : DeferredSync | None = None) -> None:
    atomic_link_or_copy2(src, dst, allow_overwrites, follow_symlinks = follow_symlinks, dsync = dsync)
    if dsync is None:
        _os.unlink(src)
    else:
        dsync.unlinks.add(src)

def atomic_write(data : bytes, dst : _t.AnyStr,
                 allow_overwrites : bool = False,
                 *,
                 dsync : DeferredSync | None = None) -> None:
    def make_dst(dst_part : _t.AnyStr) -> None:
        with open(dst_part, "xb") as f:
            f.write(data)

    atomic_make_file(make_dst, dst, allow_overwrites, dsync = dsync)
