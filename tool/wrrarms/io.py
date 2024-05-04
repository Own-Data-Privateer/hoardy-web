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

import dataclasses as _dc
import errno as _errno
import io as _io
import os as _os
import shutil as _shutil
import sys as _sys
import typing as _t

from gettext import gettext, ngettext

from kisstdlib.exceptions import *

if _sys.platform != "win32":
    import fcntl as _fcntl

def fsync_maybe(fd : int) -> None:
    try:
        _os.fsync(fd)
    except OSError as exc:
        if exc.errno != _errno.EINVAL:
            raise exc
        # EINVAL means fd is not attached to a file, so we
        # ignore this error

def fsync_fpath(fpath : _t.AnyStr, flags : int = 0) -> None:
    fd = _os.open(fpath, _os.O_RDONLY | flags)
    try:
        _os.fsync(fd)
    finally:
        _os.close(fd)

def handle_ENAMETOOLONG(exc : OSError, name : _t.AnyStr) -> None:
    if exc.errno == _errno.ENAMETOOLONG:
        raise Failure(gettext(f"target file system rejects `%s` as too long: either one of the path components is longer than the maximum allowed file name on the target file system or the whole thing is longer than kernel MAX_PATH"), name)

def fileobj_content_equals(f : _io.BufferedReader, data : bytes) -> bool:
    # TODO more efficiently
    fdata = f.read()
    return fdata == data

def file_content_equals(path : _t.AnyStr, data : bytes) -> bool:
    try:
        with open(path, "rb") as f:
            return fileobj_content_equals(f, data)
    except FileNotFoundError:
        return False

@_dc.dataclass
class DeferredSync(_t.Generic[_t.AnyStr]):
    """Deferred file system syncs and unlinks."""

    replaces : list[tuple[_t.AnyStr, _t.AnyStr]] = _dc.field(default_factory=list)
    files : set[_t.AnyStr] = _dc.field(default_factory=set)
    dirs : set[_t.AnyStr] = _dc.field(default_factory=set)
    unlinks : set[_t.AnyStr] = _dc.field(default_factory=set)

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
              dsync : DeferredSync[_t.AnyStr] | None = None,
              do_replace : bool = False) -> None:
    if not do_replace and _os.path.lexists(dst):
        # fail early
        raise FileExistsError(_errno.EEXIST, _os.strerror(_errno.EEXIST), dst)

    dirname = _os.path.dirname(dst)

    make_dst(dst)

    if dsync is None:
        fsync_fpath(dst)
        fsync_fpath(dirname, _os.O_DIRECTORY)
    else:
        dsync.files.add(dst)
        dsync.dirs.add(dirname)

def atomic_make_file(make_dst : _t.Callable[[_t.AnyStr], None], dst : _t.AnyStr,
                     dsync : DeferredSync[_t.AnyStr] | None = None,
                     do_replace : bool = False) -> None:
    if not do_replace and _os.path.lexists(dst):
        # fail early
        raise FileExistsError(_errno.EEXIST, _os.strerror(_errno.EEXIST), dst)

    dirname = _os.path.dirname(dst)
    if isinstance(dst, str):
        dst_part = dst + ".part"
    else:
        dst_part = dst + b".part"

    make_dst(dst_part)

    if dsync is None:
        fsync_fpath(dst_part)

    dirfd = _os.open(dirname, _os.O_RDONLY | _os.O_DIRECTORY)
    if _sys.platform != "win32":
        _fcntl.flock(dirfd, _fcntl.LOCK_EX)

    try:
        # this is now atomic on POSIX
        if not do_replace and _os.path.lexists(dst):
            raise FileExistsError(_errno.EEXIST, _os.strerror(_errno.EEXIST), dst)

        if dsync is None:
            _os.replace(dst_part, dst)
            _os.fsync(dirfd)
        else:
            dsync.replaces.append((dst_part, dst))
            dsync.dirs.add(dirname)
    finally:
        if _sys.platform != "win32":
            _fcntl.flock(dirfd, _fcntl.LOCK_UN)
        _os.close(dirfd)

def atomic_copy2(src : _t.AnyStr, dst : _t.AnyStr,
                 dsync : DeferredSync[_t.AnyStr] | None = None,
                 do_replace : bool = False,
                 follow_symlinks : bool = True) -> None:
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
    atomic_make_file(make_dst, dst, dsync, do_replace)

def atomic_link(src : _t.AnyStr, dst : _t.AnyStr,
                dsync : DeferredSync[_t.AnyStr] | None = None,
                do_replace : bool = False,
                follow_symlinks : bool = True) -> None:
    if follow_symlinks and _os.path.islink(src):
        src = _os.path.realpath(src)

    def make_dst(dst_part : _t.AnyStr) -> None:
        _os.link(src, dst_part, follow_symlinks = follow_symlinks)

    # _os.link is atomic, so non-atomic make_file is ok
    if do_replace:
        atomic_make_file(make_dst, dst, dsync, do_replace)
    else:
        make_file(make_dst, dst, dsync, do_replace)

def atomic_symlink(src : _t.AnyStr, dst : _t.AnyStr,
                   dsync : DeferredSync[_t.AnyStr] | None = None,
                   do_replace : bool = False,
                   follow_symlinks : bool = True) -> None:
    if follow_symlinks and _os.path.islink(src):
        src = _os.path.realpath(src)

    def make_dst(dst_part : _t.AnyStr) -> None:
        _os.symlink(src, dst_part)

    # _os.symlink is atomic, so non-atomic make_file is ok
    if do_replace:
        atomic_make_file(make_dst, dst, dsync, do_replace)
    else:
        make_file(make_dst, dst, dsync, do_replace)

def atomic_link_or_copy2(src : _t.AnyStr, dst : _t.AnyStr,
                         dsync : DeferredSync[_t.AnyStr] | None = None,
                         do_replace : bool = False,
                         follow_symlinks : bool = True) -> None:
    try:
        atomic_link(src, dst, dsync, do_replace, follow_symlinks)
    except OSError as exc:
        if exc.errno != _errno.EXDEV:
            raise exc
        atomic_copy2(src, dst, dsync, do_replace, follow_symlinks)

def atomic_move(src : _t.AnyStr, dst : _t.AnyStr,
                dsync : DeferredSync[_t.AnyStr] | None = None,
                do_replace : bool = False,
                follow_symlinks : bool = True) -> None:
    atomic_link_or_copy2(src, dst, dsync, do_replace, follow_symlinks)
    if dsync is None:
        _os.unlink(src)
    else:
        dsync.unlinks.add(src)

DataSource = _t.TypeVar("DataSource")
class DeferredIO(_t.Generic[DataSource, _t.AnyStr]):
    """A deferred IO operation over abs_out_path : _.AnyStr, which uses a DataSource
       that has ReqresExpr inside as the source of data to be IO'd.

       This exists for efficiently reasons: to eliminate away consequent
       `os.rename` and `os.symlink` calls to the same target when updating FS
       paths, and also so that disk writes could be batched.
    """

    def format_source(self) -> str | bytes:
        raise NotImplementedError()

    def approx_size(self) -> int:
        raise NotImplementedError()

    @staticmethod
    def defer(abs_out_path : _t.AnyStr, old_source : DataSource | None, new_source: DataSource) \
            -> tuple[_t.Any | None, DataSource | None, bool]:
            #        ^ this is _t.Self
        raise NotImplementedError()

    def update_from(self, new_source : DataSource) -> tuple[DataSource | None, bool]:
        raise NotImplementedError()

    def run(self, abs_out_path : _t.AnyStr,
            dsync : DeferredSync[_t.AnyStr] | None = None,
            dry_run : bool = False) \
            -> DataSource | None:
        raise NotImplementedError()

def undeferred_write(data : bytes, dst : _t.AnyStr,
                     dsync : DeferredSync[_t.AnyStr] | None = None,
                     do_replace : bool = False) -> None:
    dirname = _os.path.dirname(dst)
    try:
        _os.makedirs(dirname, exist_ok = True)
    except OSError as exc:
        handle_ENAMETOOLONG(exc, dirname)
        raise exc

    def make_dst(dst_part : _t.AnyStr) -> None:
        with open(dst_part, "xb") as f:
            f.write(data)

    try:
        atomic_make_file(make_dst, dst, dsync, do_replace)
    except FileExistsError as exc:
        raise Failure(gettext(f"trying to overwrite `%s` which already exists"), exc.filename)
    except OSError as exc:
        handle_ENAMETOOLONG(exc, dst)
        raise exc

@_dc.dataclass
class SourcedBytes(_t.Generic[_t.AnyStr]):
    source : _t.AnyStr
    data : bytes

    def approx_size(self) -> int:
        return 64 + len(self.source) + len(self.data)

    def format_source(self) -> _t.AnyStr:
        return self.source

def make_DeferredFileWriteIntent(allow_updates : bool) -> type:
    @_dc.dataclass
    class DeferredFileWrite(DeferredIO[SourcedBytes[_t.AnyStr], _t.AnyStr], _t.Generic[_t.AnyStr]):
        source : SourcedBytes[_t.AnyStr]
        exists : bool
        updated : bool = _dc.field(default = False)

        def format_source(self) -> str | bytes:
            return self.source.format_source()

        def approx_size(self) -> int:
            return 32 + self.source.approx_size()

        @staticmethod
        def defer(abs_out_path : _t.AnyStr,
                  old_source : SourcedBytes[_t.AnyStr] | None,
                  new_source : SourcedBytes[_t.AnyStr]) \
                -> tuple[_t.Any | None, SourcedBytes[_t.Any], bool]:
            if old_source is None:
                try:
                    with open(abs_out_path, "rb") as f:
                        old_source = SourcedBytes(abs_out_path, f.read())
                except FileNotFoundError:
                    return DeferredFileWrite(new_source, False), new_source, True
                except OSError as exc:
                    handle_ENAMETOOLONG(exc, abs_out_path)
                    raise exc

            intent = DeferredFileWrite(old_source, True)
            source, permitted = intent.update_from(new_source)
            if source is old_source:
                return None, source, permitted
            else:
                return intent, source, permitted

        def update_from(self, new_source : SourcedBytes[_t.AnyStr]) \
                -> tuple[SourcedBytes[_t.AnyStr], bool]:
            if self.source.data == new_source.data:
                # same data
                return self.source, True

            if not allow_updates:
                return self.source, False

            # update
            self.source = new_source
            self.updated = True
            return self.source, True

        def run(self, abs_out_path : _t.AnyStr,
                dsync : DeferredSync[_t.AnyStr] | None = None,
                dry_run : bool = False) \
                -> SourcedBytes[_t.AnyStr] | None:
            if dry_run or (self.updated and file_content_equals(abs_out_path, self.source.data)):
                # nothing to do
                return self.source

            undeferred_write(self.source.data, abs_out_path, dsync, False)
            return self.source

    return DeferredFileWrite
