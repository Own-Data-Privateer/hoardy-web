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

import collections as _c
import dataclasses as _dc
import errno as _errno
import io as _io
import logging as _logging
import os as _os
import shutil as _shutil
import signal as _signal
import stat as _stat
import subprocess as _subprocess
import sys as _sys
import tempfile as _tempfile
import traceback as _traceback
import typing as _t

from gettext import gettext, ngettext

from kisstdlib import argparse
from kisstdlib.exceptions import *
from kisstdlib.io import *
from kisstdlib.logging import *

from .wrr import *
from .output import *
from .io import *

def issue(pattern : str, *args : _t.Any) -> None:
    message = pattern % args
    if stderr.fobj.isatty():
        stderr.write_str_ln("\033[31m" + message + "\033[0m")
    else:
        stderr.write_str(message)
    stderr.flush()

def error(pattern : str, *args : _t.Any) -> None:
    issue(gettext("error") + ": " + pattern, *args)

def die(code : int, pattern : str, *args : _t.Any) -> _t.NoReturn:
    error(pattern, *args)
    _sys.exit(code)

interrupt_msg = "\n" + gettext("Gently finishing up... Press ^C again to forcefully interrupt.")
want_stop = False
should_raise = True
def sig_handler(sig : int, frame : _t.Any) -> None:
    global want_stop
    global should_raise
    want_stop = True
    if should_raise:
        raise KeyboardInterrupt()
    if sig == _signal.SIGINT:
        issue(interrupt_msg)
    should_raise = True

def handle_signals() -> None:
    _signal.signal(_signal.SIGINT, sig_handler)
    _signal.signal(_signal.SIGTERM, sig_handler)

def compile_filters(cargs : _t.Any) -> None:
    cargs.alls = list(map(lambda expr: (expr, linst_compile(expr, linst_atom_or_env)), cargs.alls))
    cargs.anys = list(map(lambda expr: (expr, linst_compile(expr, linst_atom_or_env)), cargs.anys))

def filters_allow(cargs : _t.Any, rrexpr : ReqresExpr) -> bool:
    def eval_it(expr : str, func : LinstFunc) -> bool:
        ev = func(rrexpr.get_value, None)
        if not isinstance(ev, bool):
            e = CatastrophicFailure(gettext("while evaluating `%s`: expected a value of type `bool`, got `%s`"), expr, repr(ev))
            if rrexpr.fs_path is not None:
                e.elaborate(gettext("while processing `%s`"), rrexpr.fs_path)
            raise e
        return ev

    for data in cargs.alls:
        if not eval_it(*data):
            return False

    for data in cargs.anys:
        if eval_it(*data):
            return True

    if len(cargs.anys) > 0:
        return False
    else:
        return True

def elaborate_paths(cargs : _t.Any) -> None:
    for i in range(0, len(cargs.paths)):
        cargs.paths[i] = _os.path.expanduser(cargs.paths[i])

def handle_sorting(cargs : _t.Any, default_walk : bool | None = None) -> None:
    if cargs.walk_paths == "unset":
        cargs.walk_paths = default_walk
    if cargs.walk_fs == "unset":
        cargs.walk_fs = True

    if cargs.walk_paths is not None:
        cargs.paths.sort(reverse=not cargs.walk_paths)

def elaborate_output(cargs : _t.Any) -> None:
    if cargs.dry_run:
        cargs.terminator = None

    if cargs.output.startswith("format:"):
        cargs.output_format = cargs.output[7:]
    else:
        try:
            cargs.output_format = output_aliases[cargs.output]
        except KeyError:
            raise CatastrophicFailure(gettext('unknown `--output` alias "%s", prepend "format:" if you want it to be interpreted as a Pythonic %%-substutition'), cargs.output)

def slurp_stdin0(cargs : _t.Any) -> None:
    if not cargs.stdin0: return
    paths = stdin.read_all_bytes().split(b"\0")
    last = paths.pop()
    if last != b"":
        raise Failure(gettext("`--stdin0` input format error"))
    cargs.paths += paths

LoadElem = _t.TypeVar("LoadElem")
def load_map_orderly(load_func : _t.Callable[[_io.BufferedReader, _t.AnyStr], LoadElem],
                     emit_func : _t.Callable[[_t.AnyStr, _t.AnyStr, _os.stat_result, LoadElem], None],
                     dir_or_file_path : _t.AnyStr,
                     follow_symlinks : bool = True,
                     order_by : bool | None = False,
                     errors : str = "fail") -> None:
    for path in walk_orderly(dir_or_file_path,
                             include_directories = False,
                             order_by = order_by,
                             follow_symlinks = follow_symlinks,
                             handle_error = None if errors == "fail" else _logging.error):
        if want_stop: raise KeyboardInterrupt()

        if (isinstance(path, str) and path.endswith(".part")) or \
           (isinstance(path, bytes) and path.endswith(b".part")):
            continue
        abs_path = _os.path.abspath(path)
        try:
            if follow_symlinks:
                abs_path = _os.path.realpath(abs_path)

            try:
                fobj = open(abs_path, "rb")
                in_stat = _os.fstat(fobj.fileno())
            except OSError as exc:
                raise Failure(gettext("failed to open `%s`"), path)

            try:
                data = load_func(fobj, abs_path)
                emit_func(abs_path, path, in_stat, data)
            finally:
                fobj.close()
        except Failure as exc:
            if errors == "ignore":
                continue
            exc.elaborate(gettext("while processing `%s`"), path)
            if errors != "fail":
                _logging.error("%s", str(exc))
                continue
            raise exc

def map_wrr_paths_extra(emit : _t.Callable[[_t.AnyStr, _t.AnyStr, _os.stat_result, ReqresExpr], None],
                        paths : list[_t.AnyStr],
                        *args : _t.Any, **kwargs : _t.Any) -> None:
    global should_raise
    should_raise = False
    for path in paths:
        load_map_orderly(wrr_load_expr, emit, path, *args, **kwargs)

def map_wrr_paths(emit : _t.Callable[[_t.AnyStr, _t.AnyStr, ReqresExpr], None],
                  paths : list[_t.AnyStr],
                  *args : _t.Any, **kwargs : _t.Any) -> None:
    map_wrr_paths_extra(lambda x, y, a, z: emit(x, y, z), paths, *args, **kwargs)

def get_bytes(expr : str, rrexpr : ReqresExpr) -> bytes:
    value = rrexpr.eval(expr)

    if value is None or isinstance(value, (bool, int, float, Epoch)):
        value = str(value)

    if isinstance(value, str):
        return value.encode(_sys.getdefaultencoding())
    elif isinstance(value, bytes):
        return value
    else:
        raise Failure(gettext("don't know how to print an expression of type `%s`"), type(value).__name__)

def cmd_pprint(cargs : _t.Any) -> None:
    compile_filters(cargs)
    elaborate_paths(cargs)
    slurp_stdin0(cargs)
    handle_sorting(cargs)

    def emit(abs_in_path : str, rel_in_path : str, rrexpr : ReqresExpr) -> None:
        if not filters_allow(cargs, rrexpr): return

        wrr_pprint(stdout, rrexpr.reqres, abs_in_path, cargs.abridged)
        stdout.flush()

    map_wrr_paths(emit, cargs.paths, order_by=cargs.walk_fs, errors=cargs.errors)

def cmd_get(cargs : _t.Any) -> None:
    if len(cargs.exprs) == 0:
        cargs.exprs = ["response.body|es"]

    abs_path = _os.path.abspath(_os.path.expanduser(cargs.path))
    rrexpr = wrr_loadf_expr(abs_path)
    for expr in cargs.exprs:
        data = get_bytes(expr, rrexpr)
        stdout.write_bytes(data)
        stdout.write_bytes(cargs.terminator)

def cmd_run(cargs : _t.Any) -> None:
    if cargs.num_args < 1:
        raise Failure(gettext("`run` sub-command requires at least one PATH"))
    elif cargs.num_args - 1 > len(cargs.args):
        raise Failure(gettext("not enough arguments to satisfy `--num-args`"))

    # move (num_args - 1) arguments from args to paths
    ntail = len(cargs.args) + 1 - cargs.num_args
    args = cargs.args[:ntail]
    cargs.paths = cargs.args[ntail:] + cargs.paths

    elaborate_paths(cargs)

    tmp_paths = []
    try:
        for path in cargs.paths:
            abs_path = _os.path.abspath(path)
            rrexpr = wrr_loadf_expr(abs_path)

            # TODO: extension guessing
            fileno, tmp_path = _tempfile.mkstemp(prefix = "wrrarms_run_", suffix = ".tmp")
            tmp_paths.append(tmp_path)

            with TIOWrappedWriter(_os.fdopen(fileno, "wb")) as f:
                for expr in cargs.exprs:
                    data = get_bytes(expr, rrexpr)
                    f.write_bytes(data)
                    f.write_bytes(cargs.terminator)

        retcode = _subprocess.Popen([cargs.command] + args + tmp_paths).wait()
        _sys.exit(retcode)
    finally:
        for path in tmp_paths:
            _os.unlink(path)

def get_StreamEncoder(cargs : _t.Any) -> StreamEncoder:
    stream : StreamEncoder
    if cargs.format == "py":
        stream = PyStreamEncoder(stdout, cargs.abridged)
    elif cargs.format == "cbor":
        stream = CBORStreamEncoder(stdout, cargs.abridged)
    elif cargs.format == "json":
        stream = JSONStreamEncoder(stdout, cargs.abridged)
    elif cargs.format == "raw":
        stream = RawStreamEncoder(stdout, cargs.abridged, cargs.terminator)
    else:
        assert False
    return stream

def cmd_stream(cargs : _t.Any) -> None:
    compile_filters(cargs)
    elaborate_paths(cargs)
    slurp_stdin0(cargs)
    handle_sorting(cargs)

    stream = get_StreamEncoder(cargs)

    def emit(abs_in_path : str, rel_in_path : str, rrexpr : ReqresExpr) -> None:
        if not filters_allow(cargs, rrexpr): return

        values : list[_t.Any] = []
        for expr in cargs.exprs:
            values.append(rrexpr.eval(expr))
        stream.emit(abs_in_path, cargs.exprs, values)

    stream.start()
    try:
        map_wrr_paths(emit, cargs.paths, order_by=cargs.walk_fs, errors=cargs.errors)
    finally:
        stream.finish()

def cmd_find(cargs : _t.Any) -> None:
    compile_filters(cargs)
    elaborate_paths(cargs)
    slurp_stdin0(cargs)
    handle_sorting(cargs)

    def emit(abs_in_path : str, rel_in_path : str, rrexpr : ReqresExpr) -> None:
        if not filters_allow(cargs, rrexpr): return
        stdout.write_bytes(_os.fsencode(abs_in_path) + cargs.terminator)
        stdout.flush()

    map_wrr_paths(emit, cargs.paths, order_by=cargs.walk_fs, errors=cargs.errors)

output_aliases = {
    "default":  "%(syear)d/%(smonth)02d/%(sday)02d/%(shour)02d%(sminute)02d%(ssecond)02d%(stime_msq)03d_%(qtime_ms)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s_%(hostname)s.%(num)d.wrr",
    "short": "%(syear)d/%(smonth)02d/%(sday)02d/%(stime_ms)d_%(qtime_ms)s.%(num)d.wrr",

    "surl":       "%(scheme)s/%(netloc)s/%(path_parts|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path)s",
    "url":                   "%(netloc)s/%(path_parts|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path)s",
    "surl_msn":   "%(scheme)s/%(netloc)s/%(path_parts|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path)s_%(method)s_%(status)s.%(num)d.wrr",
    "url_msn":               "%(netloc)s/%(path_parts|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path)s_%(method)s_%(status)s.%(num)d.wrr",

    "shpq":       "%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr",
    "hpq":                   "%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr",
    "shpq_msn":   "%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",
    "hpq_msn":               "%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",

    "shupq":      "%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr",
    "hupq":                  "%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr",
    "shupq_msn":  "%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",
    "hupq_msn":              "%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",

    "srhupq":     "%(scheme)s/%(rhostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr",
    "rhupq":                 "%(rhostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr",
    "srhupq_msn": "%(scheme)s/%(rhostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",
    "rhupq_msn":             "%(rhostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",

    "shupnq":     "%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 120)s.wrr",
    "hupnq":                 "%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 120)s.wrr",
    "shupnq_msn": "%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",
    "hupnq_msn":             "%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",

    "flat":                  "%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 100)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s.wrr",
    "flat_n":                "%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 100)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s.%(num)d.wrr",
}

not_allowed = gettext("; this is not allowed to prevent accidental data loss")
variance_help = gettext("; your `--output` format fails to provide enough variance to solve this problem automatically (did your forget to place a `%%(num)d` substitution in there?)") + not_allowed

def make_deferred_emit(cargs : _t.Any,
                       destination : _t.AnyStr,
                       action : str,
                       actioning : str,
                       deferredIO : type[DeferredIO[DataSource, _t.AnyStr]]) \
        -> tuple[_t.Callable[[DataSource, ReqresExpr], None], _t.Callable[[], None]]:
    seen_count_state : dict[_t.AnyStr, int] = {}
    def seen_count(value : _t.AnyStr) -> int:
        try:
            count = seen_count_state[value]
        except KeyError:
            seen_count_state[value] = 0
            return 0
        else:
            count += 1
            seen_count_state[value] = count
            return count

    # Deferred IO operations (aka "intents") that are yet to be executed,
    # indexed by filesystem paths. This is used both as a queue and as an
    # LRU-cache so that, e.g. repeated updates to the same output file would be
    # computed in memory.
    deferred_intents : _c.OrderedDict[_t.AnyStr, DeferredIO[DataSource, _t.AnyStr]] = _c.OrderedDict()

    # Deferred file system updates. This collects references to everything
    # that should be fsynced to disk before proceeding to make flush_updates
    # below both atomic and efficient.
    dsync : DeferredSync[_t.AnyStr] = DeferredSync()

    # Source info cache indexed by filesystem paths, this is purely to minimize
    # the number of calls to `stat`.
    source_cache : _c.OrderedDict[_t.AnyStr, DataSource] = _c.OrderedDict()

    def flush_updates(max_queue : int) -> None:
        """Flush some of the queue."""
        if len(deferred_intents) <= max_queue and len(source_cache) <= cargs.cache:
            return

        done_files : list[_t.AnyStr] | None = None
        if cargs.terminator is not None:
            done_files = []

        while len(deferred_intents) > max_queue:
            abs_out_path, intent = deferred_intents.popitem(False)

            if not cargs.quiet:
                if cargs.dry_run:
                    ing = gettext(f"dry-run: (not) {actioning}")
                else:
                    ing = gettext(actioning)

                stderr.write_str(f"{ing}: `")
                stderr.write(intent.format_source())
                stderr.write_str("` -> `")
                stderr.write(abs_out_path)
                stderr.write_str_ln("`")
                stderr.flush()

            try:
                out_source = intent.run(abs_out_path, dsync, cargs.dry_run)
            except Failure as exc:
                if cargs.errors == "ignore":
                    continue
                exc.elaborate(gettext(f"while {actioning} `%s` -> `%s`"), intent.format_source(), abs_out_path)
                if cargs.errors != "fail":
                    _logging.error("%s", str(exc))
                    continue
                # raise CatastrophicFailure so that load_map_orderly wouldn't try handling it
                raise CatastrophicFailure("%s", str(exc))

            if done_files is not None:
                done_files.append(abs_out_path)

            if out_source is not None:
                source_cache[abs_out_path] = out_source

        dsync.sync()

        if done_files is not None:
            for abs_out_path in done_files:
                stdout.write(abs_out_path)
                stdout.write_bytes(cargs.terminator)

            stdout.flush()
            fsync_maybe(stdout.fobj.fileno())

        dsync.finish()

        while len(source_cache) > cargs.cache:
            source_cache.popitem(False)

    def finish_updates() -> None:
        """Flush all of the queue."""
        flush_updates(0)

    def emit(in_source : DataSource, rrexpr : ReqresExpr) -> None:
        if not filters_allow(cargs, rrexpr): return

        rrexpr.items["num"] = 0
        ogprefix = _os.path.join(destination, cargs.output_format % rrexpr)
        prev_rel_out_path = None
        intent : DeferredIO[DataSource, _t.AnyStr] | None = None
        out_source : DataSource | None = None
        while True:
            rrexpr.items["num"] = seen_count(ogprefix)
            rel_out_path = _os.path.join(destination, cargs.output_format % rrexpr)
            abs_out_path = _os.path.abspath(rel_out_path)

            try:
                out_source = source_cache.pop(abs_out_path)
            except KeyError:
                out_source = None

            try:
                intent = deferred_intents.pop(abs_out_path)
            except KeyError:
                intent, out_source, permitted = deferredIO.defer(abs_out_path, out_source, in_source, rrexpr) # type: ignore
            else:
                out_source, permitted = intent.update_from(in_source, rrexpr)

            if intent is not None:
                deferred_intents[abs_out_path] = intent

            if out_source is not None:
                source_cache[abs_out_path] = out_source

            if not permitted:
                if prev_rel_out_path == rel_out_path:
                    finish_updates()
                    in_source_desc = in_source.anystr() # type: ignore
                    raise Failure(gettext(f"trying to {action} `%s` to `%s` which already exists") +
                                  variance_help, in_source_desc, rel_out_path)
                prev_rel_out_path = rel_out_path
                continue

            break

        if intent is None:
            # noop
            if cargs.terminator is not None:
                stdout.write(abs_out_path)
                stdout.write_bytes(cargs.terminator)
            return

        if not cargs.lazy:
            flush_updates(cargs.batch)

    return emit, finish_updates

def make_organize_emit(cargs : _t.Any, destination : str, allow_updates : bool) \
        -> tuple[_t.Callable[[str, str, _os.stat_result, ReqresExpr], None],
                 _t.Callable[[], None]]:
    destination = _os.path.expanduser(destination)

    action_op : _t.Any
    action = cargs.action
    if allow_updates:
        actioning = "updating " + action
    else:
        actioning = action + "ing"
    moving = False
    check_data = True
    symlinking = False
    if action == "move":
        if allow_updates:
            raise Failure(gettext("`--move` and `--latest` are not allowed together, it will lose your data"))
        actioning = "moving"
        action_op = atomic_move
        moving = True
    elif action == "copy":
        if allow_updates:
            raise Failure(gettext("`--copy` and `--latest` are not allowed together at the moment, it could lose your data"))
        action_op = atomic_copy2
    elif action == "hardlink":
        if allow_updates:
            raise Failure(gettext("`--hardlink` and `--latest` are not allowed together at the moment, it could lose your data"))
        action_op = atomic_link
    elif action == "symlink":
        action_op = atomic_symlink
        check_data = False
        symlinking = True
    else:
        assert False

    @_dc.dataclass
    class OrganizeSource(_t.Generic[_t.AnyStr]):
        abs_path : _t.AnyStr
        stat_result : _os.stat_result
        modified_ms : int | None

        def anystr(self) -> _t.AnyStr:
            return self.abs_path

    @_dc.dataclass
    class OrganizeIntent(DeferredIO[OrganizeSource[_t.AnyStr], _t.AnyStr]):
        source : OrganizeSource[_t.AnyStr]
        replace : bool

        def format_source(self) -> str | bytes:
            return self.source.anystr()

        @staticmethod
        def defer(abs_out_path : _t.AnyStr, out_source: OrganizeSource[_t.AnyStr] | None,
                  in_source : OrganizeSource[_t.AnyStr], rrexpr : ReqresExpr) \
                -> tuple[DeferredIO[OrganizeSource[_t.AnyStr], _t.AnyStr] | None, OrganizeSource[_t.AnyStr] | None, bool]:
            if in_source.abs_path == abs_out_path:
                # hot evaluation path: renaming, hardlinking,
                # symlinking, or etc to itself; skip it
                return None, out_source, True

            if out_source is None:
                try:
                    out_lstat = _os.lstat(abs_out_path)
                except FileNotFoundError:
                    # target does not exists
                    return OrganizeIntent(in_source, False), in_source, True
                except OSError as exc:
                    handle_ENAMETOOLONG(exc, abs_out_path)
                    raise exc
                else:
                    if _stat.S_ISLNK(out_lstat.st_mode):
                        # abs_out_path is a symlink
                        try:
                            # check symlink target is reachable
                            out_stat = _os.stat(abs_out_path)
                        except FileNotFoundError:
                            # target is a broken symlink
                            return OrganizeIntent(in_source, True), in_source, True
                        else:
                            if not symlinking:
                                raise Failure(gettext(f"`--{action}` is set but `%s` exists and is a symlink") + not_allowed,
                                              abs_out_path)

                            # get symlink target and use it as abs_out_path, thus
                            # (SETSRC) below will re-create the original source
                            abs_out_path = _os.path.realpath(abs_out_path)
                    elif symlinking:
                        raise Failure(gettext(f"`--{action}` is set but `%s` exists and is not a symlink") + not_allowed,
                                      abs_out_path)
                    else:
                        out_stat = out_lstat

                # (SETSRC)
                out_source = OrganizeSource(abs_out_path, out_stat, None)

            # re-create an intent for the target as if it was generated from out_source
            intent = OrganizeIntent(out_source, True)
            # update it from in_source
            source, permitted = intent.update_from(in_source, rrexpr)
            # check the result
            if moving and permitted:
                # permitted moves always generate a replace
                return OrganizeIntent(in_source, True), in_source, True
            elif not permitted or source is out_source:
                # operation is not permitted, or the source was unchanged,
                # generate a noop
                return None, source, permitted
            else:
                return intent, source, permitted

        def update_from(self, in_source : OrganizeSource[_t.AnyStr], rrexpr : ReqresExpr) \
                -> tuple[OrganizeSource[_t.AnyStr], bool]:
            if symlinking and self.source.abs_path == in_source.abs_path:
                # same source file path
                return self.source, True

            disk_data : bytes | None = None
            if check_data:
                if _os.path.samestat(self.source.stat_result, in_source.stat_result):
                    # same source file inode
                    return self.source, True

                # check if overwriting it would be a noop
                # TODO more efficiently
                with open(self.source.abs_path, "rb") as f:
                    disk_data = f.read()

                if file_content_equals(in_source.abs_path, disk_data):
                    # same data on disk
                    return self.source, True

            if not allow_updates:
                return self.source, False

            prev_modified_ms = self.source.modified_ms
            if prev_modified_ms is None:
                # mtime was not cached yet, get it
                if disk_data is None:
                    prev_modified_ms = wrr_loadf_expr(self.source.abs_path).stime_ms
                else:
                    # reuse disk_data read above
                    bio = _t.cast(_io.BufferedReader, _io.BytesIO(disk_data))
                    prev_modified_ms = wrr_load_expr(bio, self.source.abs_path).stime_ms
                # cache the result
                self.source.modified_ms = prev_modified_ms

            del disk_data

            new_modified_ms = in_source.modified_ms
            # in_source should be completely loaded just before each emit call
            assert new_modified_ms is not None

            if prev_modified_ms < new_modified_ms:
                # update source
                self.source = in_source

            return self.source, True

        def run(self, abs_out_path : _t.AnyStr, dsync : DeferredSync[_t.AnyStr] | None = None, dry_run : bool = False) \
                -> OrganizeSource[_t.AnyStr] | None:
            assert self.source.abs_path != abs_out_path

            if dry_run:
                return self.source

            try:
                dirname = _os.path.dirname(abs_out_path)
                _os.makedirs(dirname, exist_ok = True)
            except OSError as exc:
                handle_ENAMETOOLONG(exc, dirname)
                raise exc

            try:
                action_op(self.source.abs_path, abs_out_path, dsync, self.replace)
            except FileExistsError:
                raise Failure(gettext(f"`%s` already exists"), abs_out_path)
            except OSError as exc:
                handle_ENAMETOOLONG(exc, abs_out_path)
                if exc.errno == _errno.EXDEV:
                    raise Failure(gettext(f"can't {action} across file systems"))
                raise exc

            return self.source

    emit_one, finish = make_deferred_emit(cargs, destination, action, actioning, OrganizeIntent)

    def emit(abs_in_path : str, rel_in_path : str, in_stat : _os.stat_result, rrexpr : ReqresExpr) -> None:
        emit_one(OrganizeSource(abs_in_path, in_stat, rrexpr.stime_ms), rrexpr)

    return emit, finish

def cmd_organize(cargs : _t.Any) -> None:
    compile_filters(cargs)
    elaborate_output(cargs)
    elaborate_paths(cargs)
    slurp_stdin0(cargs)
    handle_sorting(cargs, None if not cargs.allow_updates else False)

    if cargs.destination is not None:
        # destination is set explicitly
        emit, finish = make_organize_emit(cargs, cargs.destination, cargs.allow_updates)
        try:
            map_wrr_paths_extra(emit, cargs.paths, order_by=cargs.walk_fs, errors=cargs.errors)
        finally:
            finish()
    else:
        if cargs.allow_updates:
            raise Failure(gettext("`--latest` without `--to` is not allowed"))

        # each path is its own destination
        for path in cargs.paths:
            try:
                path_stat = _os.stat(_os.path.expanduser(path))
            except FileNotFoundError:
                raise Failure(gettext("`%s` does not exist"), path)

            if not _stat.S_ISDIR(path_stat.st_mode):
                raise Failure(gettext("%s is not a directory but no `--to` is specified"), path)

        for path in cargs.paths:
            emit, finish = make_organize_emit(cargs, path, False)
            try:
                map_wrr_paths_extra(emit, [path], order_by=cargs.walk_fs, errors=cargs.errors)
            finally:
                finish()

def cmd_import_mitmproxy(cargs : _t.Any) -> None:
    compile_filters(cargs)
    elaborate_output(cargs)
    elaborate_paths(cargs)
    slurp_stdin0(cargs)
    handle_sorting(cargs)

    emit_one, finish = make_deferred_emit(cargs, cargs.destination, "import", "importing", DeferredFileNoOverwrite)

    def emit(abs_in_path : str, rel_in_path : str, in_stat : _os.stat_result, rr : _t.Iterator[Reqres]) -> None:
        dev, ino = in_stat.st_dev, in_stat.st_ino
        n = 0
        for reqres in rr:
            if want_stop: raise KeyboardInterrupt()

            rrexpr = ReqresExpr(reqres, None)
            rrexpr.items["mitmproxy_fs_path"] = abs_in_path
            rrexpr.items["mitmproxy_flow_num"] = n
            emit_one(SourcedData(abs_in_path + f"/{n}", wrr_dumps(rrexpr.reqres)), rrexpr)
            n += 1

    from .mitmproxy import load_as_wrrs

    global should_raise
    should_raise = False

    try:
        for path in cargs.paths:
            load_map_orderly(load_as_wrrs, emit, path, order_by=cargs.walk_fs, errors=cargs.errors)
    finally:
        finish()

def add_doc(fmt : argparse.BetterHelpFormatter) -> None:
    _ = gettext

    fmt.add_text(_("# Examples"))

    fmt.start_section(_("Pretty-print all reqres in `../dumb_server/pwebarc-dump` using an abridged (for ease of reading and rendering) verbose textual representation"))
    fmt.add_code(f"{__package__} pprint ../dumb_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Pipe response body from a given WRR file to stdout"))
    fmt.add_code(f"{__package__} get ../dumb_server/pwebarc-dump/path/to/file.wrr")
    fmt.end_section()

    fmt.start_section(_("Get first 4 characters of a hex digest of sha256 hash computed on the URL without the fragment/hash part"))
    fmt.add_code(f'{__package__} get -e "net_url|sha256|prefix 4" ../dumb_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_("Pipe response body from a given WRR file to stdout, but less efficiently, by generating a temporary file and giving it to `cat`"))
    fmt.add_code(f"{__package__} run cat ../dumb_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_text(_(f"Thus `{__package__} run` can be used to do almost anything you want, e.g."))
    fmt.add_code(f"{__package__} run less ../dumb_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_code(f"{__package__} run -- sort -R ../dumb_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_code(f"{__package__} run -n 2 -- diff -u ../dumb_server/pwebarc-dump/path/to/file-v1.wrr ../dumb_server/pwebarc-dump/path/to/file-v2.wrr")
    fmt.end_section()

    fmt.start_section(_(f"List paths of all WRR files from `../dumb_server/pwebarc-dump` that contain only complete `200 OK` responses with bodies larger than 1K"))
    fmt.add_code(f"""wrrarms find --and "status|== 200C" --and "response.body|len|> 1024" ../dumb_server/pwebarc-dump""")
    fmt.end_section()

    fmt.start_section(_(f"Rename all WRR files in `../dumb_server/pwebarc-dump/default` according to their metadata using `--output default` (see the `{__package__} organize` section for its definition, the `default` format is designed to be human-readable while causing almost no collisions, thus making `num` substitution parameter to almost always stay equal to `0`, making things nice and deterministic)"))
    fmt.add_code(f"{__package__} organize ../dumb_server/pwebarc-dump/default")
    fmt.add_text(_("alternatively, just show what would be done"))
    fmt.add_code(f"{__package__} organize --dry-run ../dumb_server/pwebarc-dump/default")
    fmt.end_section()

    fmt.start_section(_(f"The output of `{__package__} organize --zero-terminated` can be piped into `{__package__} organize --stdin0` to perform complex updates. E.g. the following will rename new reqres from `../dumb_server/pwebarc-dump` to `~/pwebarc/raw` renaming them with `--output default`, the `for` loop is there to preserve profiles"))
    fmt.add_code(f"""for arg in ../dumb_server/pwebarc-dump/* ; do
  wrrarms organize --zero-terminated --to ~/pwebarc/raw/"$(basename "$arg")" "$arg"
done > changes""")
    fmt.add_text(_("then, we can reuse `changes` to symlink all new files from `~/pwebarc/raw` to `~/pwebarc/all` using `--output hupq_msn`, which would show most of the URL in the file name:"))
    fmt.add_code(f"""wrrarms organize --stdin0 --symlink --to ~/pwebarc/all --output hupq_msn < changes""")
    fmt.add_text(_("and then, we can reuse `changes` again and use them to update `~/pwebarc/latest`, filling it with symlinks pointing to the latest `200 OK` complete reqres from `~/pwebarc/raw`, similar to what `wget -r` would produce (except `wget` would do network requests and produce responce bodies, while this will build a file system tree of symlinks to WRR files in `/pwebarc/raw`):"))
    fmt.add_code(f"""wrrarms organize --stdin0 --symlink --latest --to ~/pwebarc/latest --output hupq --and "status|== 200C" < changes""")
    fmt.end_section()

    fmt.start_section(_(f"`{__package__} organize --move` is de-duplicating when possible, while `--copy`, `--hardlink`, and `--symlink` are non-duplicating when possible, i.e."))
    fmt.add_code(f"""wrrarms organize --copy     --to ~/pwebarc/copy1 ~/pwebarc/original
wrrarms organize --copy     --to ~/pwebarc/copy2 ~/pwebarc/original
wrrarms organize --hardlink --to ~/pwebarc/copy3 ~/pwebarc/original

# noops
wrrarms organize --copy     --to ~/pwebarc/copy1 ~/pwebarc/original
wrrarms organize --hardlink --to ~/pwebarc/copy1 ~/pwebarc/original
wrrarms organize --copy     --to ~/pwebarc/copy2 ~/pwebarc/original
wrrarms organize --hardlink --to ~/pwebarc/copy2 ~/pwebarc/original
wrrarms organize --copy     --to ~/pwebarc/copy3 ~/pwebarc/original
wrrarms organize --hardlink --to ~/pwebarc/copy3 ~/pwebarc/original

# de-duplicate
wrrarms organize --move --to ~/pwebarc/all ~/pwebarc/original ~/pwebarc/copy1 ~/pwebarc/copy2 ~/pwebarc/copy3
""")
    fmt.add_text(_("will produce `~/pwebarc/all` which has each duplicated file stored only once. Similarly,"))
    fmt.add_code(f"""wrrarms organize --symlink --output hupq_msn --to ~/pwebarc/pointers ~/pwebarc/original
wrrarms organize --symlink --output shupq_msn --to ~/pwebarc/schemed ~/pwebarc/original

# noop
wrrarms organize --symlink --output hupq_msn --to ~/pwebarc/pointers ~/pwebarc/original ~/pwebarc/schemed
""")
    fmt.add_text(_("will produce `~/pwebarc/pointers` which has each symlink only once."))
    fmt.end_section()

    fmt.add_text(_("# Advanced examples"))

    fmt.start_section(_("Pretty-print all reqres in `../dumb_server/pwebarc-dump` by dumping their whole structure into an abridged Pythonic Object Representation (repr)"))
    fmt.add_code(f"{__package__} stream --expr . ../dumb_server/pwebarc-dump")
    fmt.add_code(f"{__package__} stream -e . ../dumb_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Pretty-print all reqres in `../dumb_server/pwebarc-dump` using the unabridged verbose textual representation"))
    fmt.add_code(f"{__package__} pprint --unabridged ../dumb_server/pwebarc-dump")
    fmt.add_code(f"{__package__} pprint -u ../dumb_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Pretty-print all reqres in `../dumb_server/pwebarc-dump` by dumping their whole structure into the unabridged Pythonic Object Representation (repr) format"))
    fmt.add_code(f"{__package__} stream --unabridged --expr . ../dumb_server/pwebarc-dump")
    fmt.add_code(f"{__package__} stream -ue . ../dumb_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Produce a JSON list of `[<file path>, <time it finished loading in milliseconds since UNIX epoch>, <URL>]` tuples (one per reqres) and pipe it into `jq` for indented and colored output"))
    fmt.add_code(f"{__package__} stream --format=json -ue fs_path -e finished_at -e request.url ../dumb_server/pwebarc-dump | jq .")
    fmt.end_section()

    fmt.start_section(_("Similarly, but produce a CBOR output"))
    fmt.add_code(f"{__package__} stream --format=cbor -ue fs_path -e finished_at -e request.url ../dumb_server/pwebarc-dump | less")
    fmt.end_section()

    fmt.start_section(_("Concatenate all response bodies of all the requests in `../dumb_server/pwebarc-dump`"))
    fmt.add_code(f'{__package__} stream --format=raw --not-terminated -ue "response.body|es" ../dumb_server/pwebarc-dump | less')
    fmt.end_section()

    fmt.start_section(_("Print all unique visited URLs, one per line"))
    fmt.add_code(f"{__package__} stream --format=raw --lf-terminated -ue request.url ../dumb_server/pwebarc-dump | sort | uniq")
    fmt.end_section()

    fmt.start_section(_("Same idea, but using NUL bytes while processing, and prints two URLs per line"))
    fmt.add_code(f"{__package__} stream --format=raw --zero-terminated -ue request.url ../dumb_server/pwebarc-dump | sort -z | uniq -z | xargs -0 -n2 echo")
    fmt.end_section()

    fmt.add_text(_("## How to handle binary data"))

    fmt.add_text(_(f"Trying to use response bodies produced by `{__package__} stream --format=json` is likely to result garbled data as JSON can't represent raw sequences of bytes, thus binary data will have to be encoded into UNICODE using replacement characters:"))
    fmt.add_code(f"{__package__} stream --format=json -ue . ../dumb_server/pwebarc-dump/path/to/file.wrr | jq .")
    fmt.add_text(_("The most generic solution to this is to use `--format=cbor` instead, which would produce a verbose CBOR representation equivalent to the one used by `--format=json` but with binary data preserved as-is:"))
    fmt.add_code(f"{__package__} stream --format=cbor -ue . ../dumb_server/pwebarc-dump/path/to/file.wrr | less")
    fmt.add_text(_("Or you could just dump raw response bodies separately:"))
    fmt.add_code(f"{__package__} stream --format=raw -ue response.body ../dumb_server/pwebarc-dump/path/to/file.wrr | less")
    fmt.add_code(f"{__package__} get ../dumb_server/pwebarc-dump/path/to/file.wrr | less")

class ArgumentParser(argparse.BetterArgumentParser):
    def error(self, message : str) -> _t.NoReturn:
        self.print_usage(_sys.stderr)
        die(2, "%s", message)

def main() -> None:
    _ = gettext

    parser = ArgumentParser(
        prog=__package__,
        description=_("A tool to pretty-print, compute and print values from, search, organize (programmatically rename/move/symlink/hardlink files), (WIP: check, deduplicate, and edit) pWebArc WRR (WEBREQRES, Web REQuest+RESponse) archive files.") + "\n\n" +
_("Terminology: a `reqres` (`Reqres` when a Python type) is an instance of a structure representing HTTP request+response pair with some additional metadata."),
        additional_sections = [add_doc],
        allow_abbrev = False,
        add_version = True,
        add_help = False)
    parser.add_argument("-h", "--help", action="store_true", help=_("show this help message and exit"))
    parser.add_argument("--markdown", action="store_true", help=_("show help messages formatted in Markdown"))

    subparsers = parser.add_subparsers(title="subcommands")

    def no_cmd(cargs : _t.Any) -> None:
        parser.print_help(stderr) # type: ignore
        _sys.exit(2)
    parser.set_defaults(func=no_cmd)

    def add_errors(cmd : _t.Any) -> None:
        grp = cmd.add_argument_group("error handling")
        grp.add_argument("--errors", choices=["fail", "skip", "ignore"], default="fail", help=_("""when an error occurs:
- `fail`: report failure and stop the execution (default)
- `skip`: report failure but skip the reqres that produced it from the output and continue
- `ignore`: `skip`, but don't report the failure"""))

    def add_filters(cmd : _t.Any, do_what : str) -> None:
        grp = cmd.add_argument_group("filters")
        grp.add_argument("--or", dest="anys", metavar="EXPR", action="append", type=str, default = [],
                         help=_(f"only {do_what} reqres which match any of these expressions..."))
        grp.add_argument("--and", dest="alls", metavar="EXPR", action="append", type=str, default = [],
                         help=_(f"... and all of these expressions, both can be specified multiple times, both use the same expression format as `{__package__} get --expr`, which see"))

    def add_abridged(cmd : _t.Any) -> None:
        grp = cmd.add_mutually_exclusive_group()
        grp.add_argument("-u", "--unabridged", dest="abridged", action="store_false", help=_("print all data in full"))
        grp.add_argument("--abridged", action="store_true", help=_("shorten long strings for brevity (useful when you want to visually scan through batch data dumps) (default)"))
        cmd.set_defaults(abridged = True)

    def add_terminator(cmd : _t.Any) -> None:
        agrp = cmd.add_argument_group("output")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--not-terminated", dest="terminator", action="store_const", const = b"", help=_("don't terminate output values with anything, just concatenate them (default)"))
        grp.add_argument("-l", "--lf-terminated", dest="terminator", action="store_const", const = b"\n", help=_("terminate output values with `\\n` (LF) newline characters"))
        grp.add_argument("-z", "--zero-terminated", dest="terminator", action="store_const", const = b"\0", help=_("terminate output values with `\\0` (NUL) bytes"))
        cmd.set_defaults(terminator = b"")

    def add_paths(cmd : _t.Any, with_update : bool = False) -> None:
        if with_update:
            def_def = " " + _("(default when `--keep`)")
            def_sup = " " + _("(default when `--latest`)")
        else:
            def_def = " " + _("(default)")
            def_sup = ""

        agrp = cmd.add_argument_group("file system path ordering")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--paths-given-order", dest="walk_paths", action="store_const", const = None, help=_("`argv` and `--stdin0` `PATH`s are processed in the order they are given") + def_def)
        grp.add_argument("--paths-sorted", dest="walk_paths", action="store_const", const = False, help=_("`argv` and `--stdin0` `PATH`s are processed in lexicographic order"))
        grp.add_argument("--paths-reversed", dest="walk_paths", action="store_const", const = True, help=_("`argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order") + def_sup)
        cmd.set_defaults(walk_paths = "unset")

        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--walk-fs-order", dest="walk_fs", action="store_const", const = None, help=_("recursive file system walk is done in the order `readdir(2)` gives results"))
        grp.add_argument("--walk-sorted", dest="walk_fs", action="store_const", const = False, help=_("recursive file system walk is done in lexicographic order") + def_def)
        grp.add_argument("--walk-reversed", dest="walk_fs", action="store_const", const = True, help=_("recursive file system walk is done in reverse lexicographic order") + def_sup)
        cmd.set_defaults(walk_fs = "unset")

        cmd.add_argument("--stdin0", action="store_true", help=_("read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments"))

        cmd.add_argument("paths", metavar="PATH", nargs="*", type=str, help=_("inputs, can be a mix of files and directories (which will be traversed recursively)"))

    # pprint
    cmd = subparsers.add_parser("pprint", help=_("pretty-print given WRR files"),
                                description = _("""Pretty-print given WRR files to stdout."""))
    add_errors(cmd)
    add_filters(cmd, "print")
    add_abridged(cmd)
    add_paths(cmd)
    cmd.set_defaults(func=cmd_pprint)

    # get
    cmd = subparsers.add_parser("get", help=_("print values produced by computing given expressions on a given WRR file"),
                                description = _(f"""Compute output values by evaluating expressions `EXPR`s on a given reqres stored at `PATH`, then print them to stdout terminating each value as specified."""))

    cmd.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action="append", type=str, default = [], help=_('an expression to compute; can be specified multiple times in which case computed outputs will be printed sequentially, see also "output" options below; (default: `response.body|es`); each EXPR describes a state-transformer (pipeline) which starts from value `None` and evaluates a script built from the following:') + "\n" + \
                     "- " + _("constants and functions:") + "\n" + \
                     "".join([f"  - `{name}`: {_(value[0]).replace('%', '%%')}\n" for name, value in Reqres_atoms.items()]) + \
                     "- " + _("reqres fields, these work the same way as constants above, i.e. they replace current value of `None` with field's value, if reqres is missing the field in question, which could happen for `response*` fields, the result is `None`:") + "\n" + \
                     "".join([f"  - `{name}`: {_(value).replace('%', '%%')}\n" for name, value in Reqres_fields.items()]) + \
                     "- " + _("derived attributes:") + "\n" + \
                     "".join([f"  - `{name}`: {_(value).replace('%', '%%')}\n" for name, value in Reqres_derived_attrs.items()]) + \
                     "- " + _("a compound expression built by piping (`|`) the above, for example:") + """
  - `net_url|sha256`
  - `net_url|sha256|prefix 4`
  - `path_parts|pp_to_path`
  - `query_parts|qsl_to_path|abbrev 128`
  - `response.complete`: this will print the value of `response.complete` or `None`, if there was no response
  - `response.complete|false`: this will print `response.complete` or `False`
  - `response.body|eb`: this will print `response.body` or an empty string, if there was no response
""")
    add_terminator(cmd)

    cmd.add_argument("path", metavar="PATH", type=str, help=_("input WRR file path"))
    cmd.set_defaults(func=cmd_get)

    # run
    cmd = subparsers.add_parser("run", help=_("spawn a process with generated temporary files produced by given expressions computed on given WRR files as arguments"),
                                description = _("""Compute output values by evaluating expressions `EXPR`s for each of `NUM` reqres stored at `PATH`s, dump the results into into newly generated temporary files terminating each value as specified, spawn a given `COMMAND` with given arguments `ARG`s and the resulting temporary file paths appended as the last `NUM` arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process."""))

    cmd.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action="append", type=str, default=["response.body|es"], help=_("the expression to compute, can be specified multiple times, see `{__package__} get --expr` for more info; (default: `response.body|es`)"))
    add_terminator(cmd)

    cmd.add_argument("-n", "--num-args", metavar="NUM", type=int, default = 1, help=_("number of `PATH`s (default: `%(default)s`)"))
    cmd.add_argument("command", metavar="COMMAND", type=str, help=_("command to spawn"))
    cmd.add_argument("args", metavar="ARG", nargs="*", type=str, help=_("additional arguments to give to the COMMAND"))
    cmd.add_argument("paths", metavar="PATH", nargs="+", type=str, help=_("input WRR file paths to be mapped into new temporary files"))
    cmd.set_defaults(func=cmd_run)

    # stream
    cmd = subparsers.add_parser("stream", help=_(f"produce a stream of structured lists containing values produced by computing given expressions on given WRR files, a generalized `{__package__} get`"),
                                description = _("""Compute given expressions for each of given WRR files, encode them into a requested format, and print the result to stdout."""))
    add_errors(cmd)
    add_filters(cmd, "print")
    add_abridged(cmd)

    cmd.add_argument("--format", choices=["py", "cbor", "json", "raw"], default="py", help=_("""generate output in:
- py: Pythonic Object Representation aka `repr` (default)
- cbor: CBOR (RFC8949)
- json: JavaScript Object Notation aka JSON; **binary data can't be represented, UNICODE replacement characters will be used**
- raw: concatenate raw values; termination is controlled by `*-terminated` options
"""))

    cmd.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action="append", type=str, default = [], help=_(f'an expression to compute, see `{__package__} get --expr` for more info on expression format, can be specified multiple times (default: `%(default)s`); to dump all the fields of a reqres, specify "`.`"'))

    agrp = cmd.add_argument_group("`--format=raw` output")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--not-terminated", dest="terminator", action="store_const", const = b"", help=_("don't terminate `raw` output values with anything, just concatenate them"))
    grp.add_argument("-l", "--lf-terminated", dest="terminator", action="store_const", const = b"\n", help=_("terminate `raw` output values with `\\n` (LF) newline characters (default)"))
    grp.add_argument("-z", "--zero-terminated", dest="terminator", action="store_const", const = b"\0", help=_("terminate `raw` output values with `\\0` (NUL) bytes"))
    cmd.set_defaults(terminator = b"\n")

    add_paths(cmd)
    cmd.set_defaults(func=cmd_stream)

    # find
    cmd = subparsers.add_parser("find", help=_("print paths of WRR files matching specified criteria"),
                                description = _(f"""Print paths of WRR files matching specified criteria."""))
    add_errors(cmd)
    add_filters(cmd, "output paths to")

    agrp = cmd.add_argument_group("output")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("-l", "--lf-terminated", dest="terminator", action="store_const", const = b"\n", help=_("output absolute paths of matching WRR files terminated with `\\n` (LF) newline characters to stdout (default)"))
    grp.add_argument("-z", "--zero-terminated", dest="terminator", action="store_const", const = b"\0", help=_("output absolute paths of matching WRR files terminated with `\\0` (NUL) bytes to stdout"))
    cmd.set_defaults(terminator = b"\n")

    add_paths(cmd)
    cmd.set_defaults(func=cmd_find)

    def add_output(cmd : _t.Any) -> None:
        grp = cmd.add_mutually_exclusive_group()
        grp.add_argument("--dry-run", action="store_true", help=_("perform a trial run without actually performing any changes"))
        grp.add_argument("-q", "--quiet", action="store_true", help=_("don't log computed updates to stderr"))

        agrp = cmd.add_argument_group("output")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--no-output", dest="terminator", action="store_const", const = None, help=_("don't print anything to stdout (default)"))
        grp.add_argument("-l", "--lf-terminated", dest="terminator", action="store_const", const = b"\n", help=_("output absolute paths of newly produced files terminated with `\\n` (LF) newline characters to stdout"))
        grp.add_argument("-z", "--zero-terminated", dest="terminator", action="store_const", const = b"\0", help=_("output absolute paths of newly produced files terminated with `\\0` (NUL) bytes to stdout"))
        cmd.set_defaults(terminator = None)

    # organize
    cmd = subparsers.add_parser("organize", help=_("programmatically rename/move/hardlink/symlink WRR files based on their contents"),
                                description = _(f"""Parse given WRR files into their respective reqres and then rename/move/hardlink/symlink each file to `DESTINATION` with the new path derived from each reqres' metadata.

Operations that could lead to accidental data loss are not permitted.
E.g. `{__package__} organize --move` will not overwrite any files, which is why the default `--output` contains `%(num)d`."""))
    add_errors(cmd)
    add_filters(cmd, "work on")
    add_output(cmd)

    agrp = cmd.add_argument_group("action")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--move", dest="action", action="store_const", const="move", help=_("move source files under `DESTINATION` (default)"))
    grp.add_argument("--copy", dest="action", action="store_const", const="copy", help=_("copy source files to files under `DESTINATION`"))
    grp.add_argument("--hardlink", dest="action", action="store_const", const="hardlink", help=_("create hardlinks from source files to paths under `DESTINATION`"))
    grp.add_argument("--symlink", dest="action", action="store_const", const="symlink", help=_("create symlinks from source files to paths under `DESTINATION`"))
    cmd.set_defaults(action = "move")

    agrp = cmd.add_argument_group("updates")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--keep", dest="allow_updates", action="store_const", const=False, help=_("""disallow replacements and overwrites for any existing files under `DESTINATION` (default);
broken symlinks are allowed to be replaced;
if source and target directories are the same then some files can still be renamed into previously non-existing names;
all other updates are disallowed"""))
    grp.add_argument("--latest", dest="allow_updates", action="store_const", const=True, help=_("replace files under `DESTINATION` if `stime_ms` for the source reqres is newer than the same value for reqres stored at the destination"))
    cmd.set_defaults(allow_updates = False)

    agrp = cmd.add_argument_group("batching and caching")
    agrp.add_argument("--batch-number", metavar = "INT", dest="batch", type=int, default=1024, help=_("batch at most this many IO actions together (default: `%(default)s`), making this larger improves performance at the cost of increased memory consumption, setting it to zero will force all IO actions to be applied immediately"))
    agrp.add_argument("--cache-number", metavar = "INT", dest="cache", type=int, default=4*1024, help=_("""cache `stat(2)` information about this many files in memory (default: `%(default)s`);
making this larger improves performance at the cost of increased memory consumption;
setting this to a too small number will likely force {__package__} into repeatedly performing lots of `stat(2)` system calls on the same files;
setting this to a value smaller than `--batch-number` will not improve memory consumption very much since batched IO actions also cache information about their own files
"""))
    agrp.add_argument("--lazy", action="store_true", help=_(f"sets `--cache-number` and `--batch-number` to positive infinity; most useful in combination with `--symlink --latest` in which case it will force `{__package__}` to compute the desired file system state first and then perform disk writes in a single batch"))

    cmd.add_argument("-t", "--to", dest="destination", metavar="DESTINATION", type=str, help=_("destination directory, when unset each source `PATH` must be a directory which will be treated as its own `DESTINATION`"))
    cmd.add_argument("-o", "--output", metavar="FORMAT", default="default", type=str, help=_("""format describing generated output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string:""") + "\n" + \
                     "- " + _("available aliases and corresponding %%-substitutions:") + "\n" + \
                     "".join([f"  - `{name}`: `{value.replace('%', '%%')}`" + (" (default)" if name == "default" else "") + "\n" for name, value in output_aliases.items()]) + \
                     "- " + _("available substitutions:") + "\n" + \
                     "  - `num`: " + _("number of times the resulting output path was encountered before; adding this parameter to your `--output` format will ensure all generated file names will be unique") + "\n" + \
                     "  - " + _(f"all expressions of `{__package__} get --expr`, which see"))

    add_paths(cmd, True)
    cmd.set_defaults(func=cmd_organize)

    # import
    supcmd = subparsers.add_parser("import", help=_("convert other archive formats into WRR files"),
                                   description = _("""Parse data in each `INPUT` `PATH` into reqres and dump them under `DESTINATION` with paths derived from their metadata, similar to `organize`.

Internally, this shares most of the code with `organize`, but unlike `organize` this holds the whole reqres in memory until its written out to disk.
"""))
    supsub = supcmd.add_subparsers(title="file formats")

    cmd = supsub.add_parser("mitmproxy", help=_("convert other archive formats into WRR files"))
    add_errors(cmd)
    add_filters(cmd, "import")
    add_output(cmd)
    cmd.add_argument("-t", "--to", dest="destination", metavar="DESTINATION", type=str, required=True, help=_("destination directory"))
    cmd.add_argument("-o", "--output", metavar="FORMAT", default="default", type=str, help=_(f"""format describing generated output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string; same as `{__package__} organize --output`, which see"""))
    add_paths(cmd)
    cmd.set_defaults(func=cmd_import_mitmproxy, batch = 0, cache = 4096, lazy = False)

    cargs = parser.parse_args(_sys.argv[1:])

    if cargs.help:
        if cargs.markdown:
            parser.set_formatter_class(argparse.MarkdownBetterHelpFormatter)
            print(parser.format_help(1024))
        else:
            print(parser.format_help())
        _sys.exit(0)

    _logging.basicConfig(level=_logging.WARNING,
                         stream = stderr)
    errorcnt = CounterHandler()
    logger = _logging.getLogger()
    logger.addHandler(errorcnt)
    #logger.setLevel(_logging.DEBUG)

    handle_signals()

    try:
        cargs.func(cargs)
    except KeyboardInterrupt:
        error("%s", _("Interrupted!"))
        errorcnt.errors += 1
    except CatastrophicFailure as exc:
        error("%s", str(exc))
        errorcnt.errors += 1
    except Exception as exc:
        _traceback.print_exception(type(exc), exc, exc.__traceback__, 100, stderr)
        errorcnt.errors += 1

    stdout.flush()
    stderr.flush()

    if errorcnt.errors > 0:
        stderr.write_str_ln(ngettext("There was %d error!", "There were %d errors!", errorcnt.errors) % (errorcnt.errors,))
        _sys.exit(1)
    _sys.exit(0)

if __name__ == "__main__":
    main()
