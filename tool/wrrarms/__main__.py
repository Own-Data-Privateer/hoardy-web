# Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
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
from kisstdlib.io.stdio import *
from kisstdlib.logging import *

from .wrr import *
from .output import *
from .io import *

def issue(pattern : str, *args : _t.Any) -> None:
    message = pattern % args
    if stderr.isatty:
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

def compile_filter(expr : str) -> tuple[str, LinstFunc]:
    return (expr, linst_compile(expr, linst_atom_or_env))

def compile_expr(expr : str) -> tuple[str, LinstFunc]:
    return (expr, linst_compile(expr, ReqresExpr_lookup))

def compile_filters(cargs : _t.Any) -> None:
    cargs.alls = list(map(compile_filter, cargs.alls))
    cargs.anys = list(map(compile_filter, cargs.anys))

def filters_allow(cargs : _t.Any, rrexpr : ReqresExpr) -> bool:
    def eval_it(expr : str, func : LinstFunc) -> bool:
        ev = func(rrexpr, None)
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

def compile_remap(cargs : _t.Any) -> None:
    if cargs.remap_urls == "id":
        cargs.remap_url_func = remap_url_id
    elif cargs.remap_urls == "void":
        cargs.remap_url_func = remap_url_into_void
    else:
        assert False

def elaborate_paths(cargs : _t.Any) -> None:
    for i in range(0, len(cargs.paths)):
        cargs.paths[i] = _os.path.expanduser(cargs.paths[i])

def handle_paths(cargs : _t.Any, append_stdin0 : bool = True) -> None:
    if append_stdin0 and cargs.stdin0:
        paths = stdin.read_all_bytes().split(b"\0")
        last = paths.pop()
        if last != b"":
            raise Failure(gettext("`--stdin0` input format error"))
        cargs.paths += paths

    elaborate_paths(cargs)

    if cargs.walk_paths is not None:
        cargs.paths.sort(reverse=not cargs.walk_paths)

LoadElem = _t.TypeVar("LoadElem")
def load_map_orderly(load_func : _t.Callable[[_io.BufferedReader, _t.AnyStr], LoadElem],
                     emit_func : _t.Callable[[_t.AnyStr, _t.AnyStr, _os.stat_result, LoadElem], None],
                     dir_or_file_path : _t.AnyStr,
                     *,
                     follow_symlinks : bool = True,
                     ordering : bool | None = False,
                     errors : str = "fail") -> None:
    for path in walk_orderly(dir_or_file_path,
                             include_directories = False,
                             ordering = ordering,
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
                try:
                    data = load_func(fobj, abs_path)
                except Failure as exc:
                    exc.elaborate(gettext("load"))
                    raise exc

                try:
                    emit_func(abs_path, path, in_stat, data)
                except Failure as exc:
                    exc.elaborate(gettext("emit"))
                    raise exc
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
                        **kwargs : _t.Any) -> None:
    global should_raise
    should_raise = False
    for path in paths:
        load_map_orderly(wrr_load_expr, emit, path, **kwargs)

def map_wrr_paths(emit : _t.Callable[[_t.AnyStr, _t.AnyStr, ReqresExpr], None],
                  paths : list[_t.AnyStr],
                  **kwargs : _t.Any) -> None:
    map_wrr_paths_extra(lambda x, y, a, z: emit(x, y, z), paths, **kwargs)

def get_bytes(value : _t.Any) -> bytes:
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
    handle_paths(cargs)

    def emit(abs_in_path : str, rel_in_path : str, rrexpr : ReqresExpr) -> None:
        if not filters_allow(cargs, rrexpr): return

        wrr_pprint(stdout, rrexpr.reqres, abs_in_path, cargs.abridged, cargs.paranoid)
        stdout.flush()

    map_wrr_paths(emit, cargs.paths, ordering=cargs.walk_fs, errors=cargs.errors)

def print_exprs(rrexpr : ReqresExpr, exprs : list[tuple[str, LinstFunc]],
                separator : bytes, fobj : MinimalIOWriter) -> None:
    not_first = False
    for expr, func in exprs:
        try:
            data = get_bytes(func(rrexpr, None))
        except CatastrophicFailure as exc:
            exc.elaborate(gettext("while evaluating `%s`"), expr)
            raise exc

        if not_first:
            fobj.write_bytes(separator)
        not_first = True

        fobj.write_bytes(data)

default_get_expr = "response.body|eb"
def cmd_get(cargs : _t.Any) -> None:
    if len(cargs.mexprs) == 0:
        cargs.mexprs = { stdout: [compile_expr(default_get_expr)] }
    compile_remap(cargs)

    abs_path = _os.path.abspath(_os.path.expanduser(cargs.path))
    rrexpr = wrr_loadf_expr(abs_path)
    rrexpr.items["remap_url"] = cargs.remap_url_func

    for fobj, exprs in cargs.mexprs.items():
        print_exprs(rrexpr, exprs, cargs.separator, fobj)
        fobj.flush()

def cmd_run(cargs : _t.Any) -> None:
    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_get_expr)]
    compile_remap(cargs)

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
            rrexpr.items["remap_url"] = cargs.remap_url_func

            # TODO: extension guessing
            fileno, tmp_path = _tempfile.mkstemp(prefix = "wrrarms_run_", suffix = ".tmp")
            tmp_paths.append(tmp_path)

            with TIOWrappedWriter(_os.fdopen(fileno, "wb")) as f:
                print_exprs(rrexpr, cargs.exprs, cargs.separator, f)

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

default_stream_expr = "."
def cmd_stream(cargs : _t.Any) -> None:
    compile_filters(cargs)
    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_stream_expr)]
    compile_remap(cargs)
    handle_paths(cargs)

    stream = get_StreamEncoder(cargs)

    def emit(abs_in_path : str, rel_in_path : str, rrexpr : ReqresExpr) -> None:
        if not filters_allow(cargs, rrexpr): return

        values : list[_t.Any] = []
        for expr, func in cargs.exprs:
            try:
                values.append(func(rrexpr, None))
            except CatastrophicFailure as exc:
                exc.elaborate(gettext("while evaluating `%s`"), expr)
                raise exc
        stream.emit(abs_in_path, cargs.exprs, values)

    stream.start()
    try:
        map_wrr_paths(emit, cargs.paths, ordering=cargs.walk_fs, errors=cargs.errors)
    finally:
        stream.finish()

def cmd_find(cargs : _t.Any) -> None:
    compile_filters(cargs)
    handle_paths(cargs)

    def emit(abs_in_path : str, rel_in_path : str, rrexpr : ReqresExpr) -> None:
        if not filters_allow(cargs, rrexpr): return
        stdout.write(abs_in_path)
        stdout.write_bytes(cargs.terminator)
        stdout.flush()

    map_wrr_paths(emit, cargs.paths, ordering=cargs.walk_fs, errors=cargs.errors)

output_aliases = {
    "default":    "%(syear)d/%(smonth)02d/%(sday)02d/%(shour)02d%(sminute)02d%(ssecond)02d%(stime_msq)03d_%(qtime_ms)s_%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(hostname)s_%(num)d",
    "short":      "%(syear)d/%(smonth)02d/%(sday)02d/%(stime_ms)d_%(qtime_ms)s_%(num)d",

    "surl":       "%(scheme)s/%(netloc)s/%(mq_path)s%(oqm)s%(mq_query)s",
    "surl_msn":   "%(scheme)s/%(netloc)s/%(mq_path)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_%(num)d",

    "shupq":      "%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s%(filepath_ext)s",
    "shupq_n":    "%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s.%(num)d%(filepath_ext)s",
    "shupq_msn":  "%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "shupnq":     "%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s%(filepath_ext)s",
    "shupnq_n":   "%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(num)d%(filepath_ext)s",
    "shupnq_msn": "%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "shupnq_mhs": "%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s",
    "shupnq_mhsn":"%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s",

    "srhupq":     "%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s%(filepath_ext)s",
    "srhupq_n":   "%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s.%(num)d%(filepath_ext)s",
    "srhupq_msn": "%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "srhupnq":    "%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s%(filepath_ext)s",
    "srhupnq_n":  "%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(num)d%(filepath_ext)s",
    "srhupnq_msn":"%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "srhupnq_mhs":"%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s",
    "srhupnq_mhsn":"%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s",

    "url":        "%(netloc)s/%(mq_path)s%(oqm)s%(mq_query)s",
    "url_msn":    "%(netloc)s/%(mq_path)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_%(num)d",

    "hupq":       "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s%(filepath_ext)s",
    "hupq_n":     "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s.%(num)d%(filepath_ext)s",
    "hupq_msn":   "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "hupnq":      "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s%(filepath_ext)s",
    "hupnq_n":    "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(num)d%(filepath_ext)s",
    "hupnq_msn":  "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "hupnq_mhs":  "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s",
    "hupnq_mhsn": "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s",

    "rhupq":      "%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s%(filepath_ext)s",
    "rhupq_n":    "%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s.%(num)d%(filepath_ext)s",
    "rhupq_msn":  "%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "rhupnq":     "%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s%(filepath_ext)s",
    "rhupnq_n":   "%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(num)d%(filepath_ext)s",
    "rhupnq_msn": "%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "rhupnq_mhs": "%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s",
    "rhupnq_mhsn":"%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s",

    "flat":       "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s%(filepath_ext)s",
    "flat_n":     "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(num)d%(filepath_ext)s",
    "flat_ms":    "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s%(filepath_ext)s",
    "flat_msn":   "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "flat_mhs":   "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s",
    "flat_mhsn":  "%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s",
}

output_aliases_tests = [
    "https://example.org",
    "https://example.org/",
    "https://example.org/index.html",
    "https://example.org/media",
    "https://example.org/media/",
    "https://example.org/view?one=1&two=2&three=&three=3#fragment",
    "https://königsgäßchen.example.org/index.html",
    "https://ジャジェメント.ですの.example.org/испытание/is/",
    "https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/",
]

def output_example(name : str, indent : int) -> str:
    def mk(url : str) -> ReqresExpr:
        return ReqresExpr(trivial_Reqres(parse_url(url)), None, [])

    rev : dict[str, list[str]] = {}
    for url in output_aliases_tests:
        x = mk(url)
        x.items["num"] = 0
        current = output_aliases[name] % x
        try:
            l = rev[current]
        except KeyError:
            l = []
            rev[current] = l
        l.append(url)

    res = []
    for r in rev:
        res.append(" " * indent + "- " + ", ".join(map(lambda x: f"`{x}`", rev[r])) + " -> `" + r + "`")

    return "\n".join(res).replace('%', '%%')

def test_outputs_aliases() -> None:
    def mk(url : str) -> ReqresExpr:
        return ReqresExpr(trivial_Reqres(parse_url(url)), None, [])

    res = ""
    prev = ""
    for name in output_aliases:
        for url in output_aliases_tests:
            x = mk(url)
            x.items["num"] = 0
            prefix = "\n" + name + ":" + " " * (12 - len(name)) + " "
            current = output_aliases[name] % x
            if prev != current:
                res += prefix + current
            else:
                res += prefix + "=="
            prev = current

    print(res)

    assert res + "\n" == """
default:      1970/01/01/001640000_0_GET_50d7_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_8198_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_f0dc_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_086d_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_3fbb_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_5658_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_4f11_C200C_königsgäßchen.example.org_0
default:      1970/01/01/001640000_0_GET_c4ae_C200C_ジャジェメント.ですの.example.org_0
default:      ==
short:        1970/01/01/1000000_0_0
short:        ==
short:        ==
short:        ==
short:        ==
short:        ==
short:        ==
short:        ==
short:        ==
surl:         https/example.org/
surl:         ==
surl:         https/example.org/index.html
surl:         https/example.org/media
surl:         ==
surl:         https/example.org/view?one=1&two=2&three&three=3
surl:         https/königsgäßchen.example.org/index.html
surl:         https/ジャジェメント.ですの.example.org/испытание/is
surl:         ==
surl_msn:     https/example.org/__GET_C200C_0
surl_msn:     ==
surl_msn:     https/example.org/index.html__GET_C200C_0
surl_msn:     https/example.org/media__GET_C200C_0
surl_msn:     ==
surl_msn:     https/example.org/view?one=1&two=2&three&three=3__GET_C200C_0
surl_msn:     https/königsgäßchen.example.org/index.html__GET_C200C_0
surl_msn:     https/ジャジェメント.ですの.example.org/испытание/is__GET_C200C_0
surl_msn:     ==
shupq:        https/example.org/index.htm
shupq:        ==
shupq:        https/example.org/index.html
shupq:        https/example.org/media/index.htm
shupq:        ==
shupq:        https/example.org/view/index?one=1&two=2&three&three=3.htm
shupq:        https/königsgäßchen.example.org/index.html
shupq:        https/ジャジェメント.ですの.example.org/испытание/is/index.htm
shupq:        ==
shupq_n:      https/example.org/index.0.htm
shupq_n:      ==
shupq_n:      https/example.org/index.0.html
shupq_n:      https/example.org/media/index.0.htm
shupq_n:      ==
shupq_n:      https/example.org/view/index?one=1&two=2&three&three=3.0.htm
shupq_n:      https/königsgäßchen.example.org/index.0.html
shupq_n:      https/ジャジェメント.ですの.example.org/испытание/is/index.0.htm
shupq_n:      ==
shupq_msn:    https/example.org/index.GET_C200C_0.htm
shupq_msn:    ==
shupq_msn:    https/example.org/index.GET_C200C_0.html
shupq_msn:    https/example.org/media/index.GET_C200C_0.htm
shupq_msn:    ==
shupq_msn:    https/example.org/view/index?one=1&two=2&three&three=3.GET_C200C_0.htm
shupq_msn:    https/königsgäßchen.example.org/index.GET_C200C_0.html
shupq_msn:    https/ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm
shupq_msn:    ==
shupnq:       https/example.org/index.htm
shupnq:       ==
shupnq:       https/example.org/index.html
shupnq:       https/example.org/media/index.htm
shupnq:       ==
shupnq:       https/example.org/view/index?one=1&two=2&three=3.htm
shupnq:       https/königsgäßchen.example.org/index.html
shupnq:       https/ジャジェメント.ですの.example.org/испытание/is/index.htm
shupnq:       ==
shupnq_n:     https/example.org/index.0.htm
shupnq_n:     ==
shupnq_n:     https/example.org/index.0.html
shupnq_n:     https/example.org/media/index.0.htm
shupnq_n:     ==
shupnq_n:     https/example.org/view/index?one=1&two=2&three=3.0.htm
shupnq_n:     https/königsgäßchen.example.org/index.0.html
shupnq_n:     https/ジャジェメント.ですの.example.org/испытание/is/index.0.htm
shupnq_n:     ==
shupnq_msn:   https/example.org/index.GET_C200C_0.htm
shupnq_msn:   ==
shupnq_msn:   https/example.org/index.GET_C200C_0.html
shupnq_msn:   https/example.org/media/index.GET_C200C_0.htm
shupnq_msn:   ==
shupnq_msn:   https/example.org/view/index?one=1&two=2&three=3.GET_C200C_0.htm
shupnq_msn:   https/königsgäßchen.example.org/index.GET_C200C_0.html
shupnq_msn:   https/ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm
shupnq_msn:   ==
shupnq_mhs:   https/example.org/index.GET_50d7_C200C.htm
shupnq_mhs:   https/example.org/index.GET_8198_C200C.htm
shupnq_mhs:   https/example.org/index.GET_f0dc_C200C.html
shupnq_mhs:   https/example.org/media/index.GET_086d_C200C.htm
shupnq_mhs:   https/example.org/media/index.GET_3fbb_C200C.htm
shupnq_mhs:   https/example.org/view/index?one=1&two=2&three=3.GET_5658_C200C.htm
shupnq_mhs:   https/königsgäßchen.example.org/index.GET_4f11_C200C.html
shupnq_mhs:   https/ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C.htm
shupnq_mhs:   ==
shupnq_mhsn:  https/example.org/index.GET_50d7_C200C_0.htm
shupnq_mhsn:  https/example.org/index.GET_8198_C200C_0.htm
shupnq_mhsn:  https/example.org/index.GET_f0dc_C200C_0.html
shupnq_mhsn:  https/example.org/media/index.GET_086d_C200C_0.htm
shupnq_mhsn:  https/example.org/media/index.GET_3fbb_C200C_0.htm
shupnq_mhsn:  https/example.org/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm
shupnq_mhsn:  https/königsgäßchen.example.org/index.GET_4f11_C200C_0.html
shupnq_mhsn:  https/ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C_0.htm
shupnq_mhsn:  ==
srhupq:       https/org.example/index.htm
srhupq:       ==
srhupq:       https/org.example/index.html
srhupq:       https/org.example/media/index.htm
srhupq:       ==
srhupq:       https/org.example/view/index?one=1&two=2&three&three=3.htm
srhupq:       https/org.example.königsgäßchen/index.html
srhupq:       https/org.example.ですの.ジャジェメント/испытание/is/index.htm
srhupq:       ==
srhupq_n:     https/org.example/index.0.htm
srhupq_n:     ==
srhupq_n:     https/org.example/index.0.html
srhupq_n:     https/org.example/media/index.0.htm
srhupq_n:     ==
srhupq_n:     https/org.example/view/index?one=1&two=2&three&three=3.0.htm
srhupq_n:     https/org.example.königsgäßchen/index.0.html
srhupq_n:     https/org.example.ですの.ジャジェメント/испытание/is/index.0.htm
srhupq_n:     ==
srhupq_msn:   https/org.example/index.GET_C200C_0.htm
srhupq_msn:   ==
srhupq_msn:   https/org.example/index.GET_C200C_0.html
srhupq_msn:   https/org.example/media/index.GET_C200C_0.htm
srhupq_msn:   ==
srhupq_msn:   https/org.example/view/index?one=1&two=2&three&three=3.GET_C200C_0.htm
srhupq_msn:   https/org.example.königsgäßchen/index.GET_C200C_0.html
srhupq_msn:   https/org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm
srhupq_msn:   ==
srhupnq:      https/org.example/index.htm
srhupnq:      ==
srhupnq:      https/org.example/index.html
srhupnq:      https/org.example/media/index.htm
srhupnq:      ==
srhupnq:      https/org.example/view/index?one=1&two=2&three=3.htm
srhupnq:      https/org.example.königsgäßchen/index.html
srhupnq:      https/org.example.ですの.ジャジェメント/испытание/is/index.htm
srhupnq:      ==
srhupnq_n:    https/org.example/index.0.htm
srhupnq_n:    ==
srhupnq_n:    https/org.example/index.0.html
srhupnq_n:    https/org.example/media/index.0.htm
srhupnq_n:    ==
srhupnq_n:    https/org.example/view/index?one=1&two=2&three=3.0.htm
srhupnq_n:    https/org.example.königsgäßchen/index.0.html
srhupnq_n:    https/org.example.ですの.ジャジェメント/испытание/is/index.0.htm
srhupnq_n:    ==
srhupnq_msn:  https/org.example/index.GET_C200C_0.htm
srhupnq_msn:  ==
srhupnq_msn:  https/org.example/index.GET_C200C_0.html
srhupnq_msn:  https/org.example/media/index.GET_C200C_0.htm
srhupnq_msn:  ==
srhupnq_msn:  https/org.example/view/index?one=1&two=2&three=3.GET_C200C_0.htm
srhupnq_msn:  https/org.example.königsgäßchen/index.GET_C200C_0.html
srhupnq_msn:  https/org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm
srhupnq_msn:  ==
srhupnq_mhs:  https/org.example/index.GET_50d7_C200C.htm
srhupnq_mhs:  https/org.example/index.GET_8198_C200C.htm
srhupnq_mhs:  https/org.example/index.GET_f0dc_C200C.html
srhupnq_mhs:  https/org.example/media/index.GET_086d_C200C.htm
srhupnq_mhs:  https/org.example/media/index.GET_3fbb_C200C.htm
srhupnq_mhs:  https/org.example/view/index?one=1&two=2&three=3.GET_5658_C200C.htm
srhupnq_mhs:  https/org.example.königsgäßchen/index.GET_4f11_C200C.html
srhupnq_mhs:  https/org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C.htm
srhupnq_mhs:  ==
srhupnq_mhsn: https/org.example/index.GET_50d7_C200C_0.htm
srhupnq_mhsn: https/org.example/index.GET_8198_C200C_0.htm
srhupnq_mhsn: https/org.example/index.GET_f0dc_C200C_0.html
srhupnq_mhsn: https/org.example/media/index.GET_086d_C200C_0.htm
srhupnq_mhsn: https/org.example/media/index.GET_3fbb_C200C_0.htm
srhupnq_mhsn: https/org.example/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm
srhupnq_mhsn: https/org.example.königsgäßchen/index.GET_4f11_C200C_0.html
srhupnq_mhsn: https/org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C_0.htm
srhupnq_mhsn: ==
url:          example.org/
url:          ==
url:          example.org/index.html
url:          example.org/media
url:          ==
url:          example.org/view?one=1&two=2&three&three=3
url:          königsgäßchen.example.org/index.html
url:          ジャジェメント.ですの.example.org/испытание/is
url:          ==
url_msn:      example.org/__GET_C200C_0
url_msn:      ==
url_msn:      example.org/index.html__GET_C200C_0
url_msn:      example.org/media__GET_C200C_0
url_msn:      ==
url_msn:      example.org/view?one=1&two=2&three&three=3__GET_C200C_0
url_msn:      königsgäßchen.example.org/index.html__GET_C200C_0
url_msn:      ジャジェメント.ですの.example.org/испытание/is__GET_C200C_0
url_msn:      ==
hupq:         example.org/index.htm
hupq:         ==
hupq:         example.org/index.html
hupq:         example.org/media/index.htm
hupq:         ==
hupq:         example.org/view/index?one=1&two=2&three&three=3.htm
hupq:         königsgäßchen.example.org/index.html
hupq:         ジャジェメント.ですの.example.org/испытание/is/index.htm
hupq:         ==
hupq_n:       example.org/index.0.htm
hupq_n:       ==
hupq_n:       example.org/index.0.html
hupq_n:       example.org/media/index.0.htm
hupq_n:       ==
hupq_n:       example.org/view/index?one=1&two=2&three&three=3.0.htm
hupq_n:       königsgäßchen.example.org/index.0.html
hupq_n:       ジャジェメント.ですの.example.org/испытание/is/index.0.htm
hupq_n:       ==
hupq_msn:     example.org/index.GET_C200C_0.htm
hupq_msn:     ==
hupq_msn:     example.org/index.GET_C200C_0.html
hupq_msn:     example.org/media/index.GET_C200C_0.htm
hupq_msn:     ==
hupq_msn:     example.org/view/index?one=1&two=2&three&three=3.GET_C200C_0.htm
hupq_msn:     königsgäßchen.example.org/index.GET_C200C_0.html
hupq_msn:     ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm
hupq_msn:     ==
hupnq:        example.org/index.htm
hupnq:        ==
hupnq:        example.org/index.html
hupnq:        example.org/media/index.htm
hupnq:        ==
hupnq:        example.org/view/index?one=1&two=2&three=3.htm
hupnq:        königsgäßchen.example.org/index.html
hupnq:        ジャジェメント.ですの.example.org/испытание/is/index.htm
hupnq:        ==
hupnq_n:      example.org/index.0.htm
hupnq_n:      ==
hupnq_n:      example.org/index.0.html
hupnq_n:      example.org/media/index.0.htm
hupnq_n:      ==
hupnq_n:      example.org/view/index?one=1&two=2&three=3.0.htm
hupnq_n:      königsgäßchen.example.org/index.0.html
hupnq_n:      ジャジェメント.ですの.example.org/испытание/is/index.0.htm
hupnq_n:      ==
hupnq_msn:    example.org/index.GET_C200C_0.htm
hupnq_msn:    ==
hupnq_msn:    example.org/index.GET_C200C_0.html
hupnq_msn:    example.org/media/index.GET_C200C_0.htm
hupnq_msn:    ==
hupnq_msn:    example.org/view/index?one=1&two=2&three=3.GET_C200C_0.htm
hupnq_msn:    königsgäßchen.example.org/index.GET_C200C_0.html
hupnq_msn:    ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm
hupnq_msn:    ==
hupnq_mhs:    example.org/index.GET_50d7_C200C.htm
hupnq_mhs:    example.org/index.GET_8198_C200C.htm
hupnq_mhs:    example.org/index.GET_f0dc_C200C.html
hupnq_mhs:    example.org/media/index.GET_086d_C200C.htm
hupnq_mhs:    example.org/media/index.GET_3fbb_C200C.htm
hupnq_mhs:    example.org/view/index?one=1&two=2&three=3.GET_5658_C200C.htm
hupnq_mhs:    königsgäßchen.example.org/index.GET_4f11_C200C.html
hupnq_mhs:    ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C.htm
hupnq_mhs:    ==
hupnq_mhsn:   example.org/index.GET_50d7_C200C_0.htm
hupnq_mhsn:   example.org/index.GET_8198_C200C_0.htm
hupnq_mhsn:   example.org/index.GET_f0dc_C200C_0.html
hupnq_mhsn:   example.org/media/index.GET_086d_C200C_0.htm
hupnq_mhsn:   example.org/media/index.GET_3fbb_C200C_0.htm
hupnq_mhsn:   example.org/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm
hupnq_mhsn:   königsgäßchen.example.org/index.GET_4f11_C200C_0.html
hupnq_mhsn:   ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C_0.htm
hupnq_mhsn:   ==
rhupq:        org.example/index.htm
rhupq:        ==
rhupq:        org.example/index.html
rhupq:        org.example/media/index.htm
rhupq:        ==
rhupq:        org.example/view/index?one=1&two=2&three&three=3.htm
rhupq:        org.example.königsgäßchen/index.html
rhupq:        org.example.ですの.ジャジェメント/испытание/is/index.htm
rhupq:        ==
rhupq_n:      org.example/index.0.htm
rhupq_n:      ==
rhupq_n:      org.example/index.0.html
rhupq_n:      org.example/media/index.0.htm
rhupq_n:      ==
rhupq_n:      org.example/view/index?one=1&two=2&three&three=3.0.htm
rhupq_n:      org.example.königsgäßchen/index.0.html
rhupq_n:      org.example.ですの.ジャジェメント/испытание/is/index.0.htm
rhupq_n:      ==
rhupq_msn:    org.example/index.GET_C200C_0.htm
rhupq_msn:    ==
rhupq_msn:    org.example/index.GET_C200C_0.html
rhupq_msn:    org.example/media/index.GET_C200C_0.htm
rhupq_msn:    ==
rhupq_msn:    org.example/view/index?one=1&two=2&three&three=3.GET_C200C_0.htm
rhupq_msn:    org.example.königsgäßchen/index.GET_C200C_0.html
rhupq_msn:    org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm
rhupq_msn:    ==
rhupnq:       org.example/index.htm
rhupnq:       ==
rhupnq:       org.example/index.html
rhupnq:       org.example/media/index.htm
rhupnq:       ==
rhupnq:       org.example/view/index?one=1&two=2&three=3.htm
rhupnq:       org.example.königsgäßchen/index.html
rhupnq:       org.example.ですの.ジャジェメント/испытание/is/index.htm
rhupnq:       ==
rhupnq_n:     org.example/index.0.htm
rhupnq_n:     ==
rhupnq_n:     org.example/index.0.html
rhupnq_n:     org.example/media/index.0.htm
rhupnq_n:     ==
rhupnq_n:     org.example/view/index?one=1&two=2&three=3.0.htm
rhupnq_n:     org.example.königsgäßchen/index.0.html
rhupnq_n:     org.example.ですの.ジャジェメント/испытание/is/index.0.htm
rhupnq_n:     ==
rhupnq_msn:   org.example/index.GET_C200C_0.htm
rhupnq_msn:   ==
rhupnq_msn:   org.example/index.GET_C200C_0.html
rhupnq_msn:   org.example/media/index.GET_C200C_0.htm
rhupnq_msn:   ==
rhupnq_msn:   org.example/view/index?one=1&two=2&three=3.GET_C200C_0.htm
rhupnq_msn:   org.example.königsgäßchen/index.GET_C200C_0.html
rhupnq_msn:   org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm
rhupnq_msn:   ==
rhupnq_mhs:   org.example/index.GET_50d7_C200C.htm
rhupnq_mhs:   org.example/index.GET_8198_C200C.htm
rhupnq_mhs:   org.example/index.GET_f0dc_C200C.html
rhupnq_mhs:   org.example/media/index.GET_086d_C200C.htm
rhupnq_mhs:   org.example/media/index.GET_3fbb_C200C.htm
rhupnq_mhs:   org.example/view/index?one=1&two=2&three=3.GET_5658_C200C.htm
rhupnq_mhs:   org.example.königsgäßchen/index.GET_4f11_C200C.html
rhupnq_mhs:   org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C.htm
rhupnq_mhs:   ==
rhupnq_mhsn:  org.example/index.GET_50d7_C200C_0.htm
rhupnq_mhsn:  org.example/index.GET_8198_C200C_0.htm
rhupnq_mhsn:  org.example/index.GET_f0dc_C200C_0.html
rhupnq_mhsn:  org.example/media/index.GET_086d_C200C_0.htm
rhupnq_mhsn:  org.example/media/index.GET_3fbb_C200C_0.htm
rhupnq_mhsn:  org.example/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm
rhupnq_mhsn:  org.example.königsgäßchen/index.GET_4f11_C200C_0.html
rhupnq_mhsn:  org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C_0.htm
rhupnq_mhsn:  ==
flat:         example.org/index.htm
flat:         ==
flat:         example.org/index.html
flat:         example.org/media__index.htm
flat:         ==
flat:         example.org/view__index?one=1&two=2&three=3.htm
flat:         königsgäßchen.example.org/index.html
flat:         ジャジェメント.ですの.example.org/испытание__is__index.htm
flat:         ==
flat_n:       example.org/index.0.htm
flat_n:       ==
flat_n:       example.org/index.0.html
flat_n:       example.org/media__index.0.htm
flat_n:       ==
flat_n:       example.org/view__index?one=1&two=2&three=3.0.htm
flat_n:       königsgäßchen.example.org/index.0.html
flat_n:       ジャジェメント.ですの.example.org/испытание__is__index.0.htm
flat_n:       ==
flat_ms:      example.org/index.GET_C200C.htm
flat_ms:      ==
flat_ms:      example.org/index.GET_C200C.html
flat_ms:      example.org/media__index.GET_C200C.htm
flat_ms:      ==
flat_ms:      example.org/view__index?one=1&two=2&three=3.GET_C200C.htm
flat_ms:      königsgäßchen.example.org/index.GET_C200C.html
flat_ms:      ジャジェメント.ですの.example.org/испытание__is__index.GET_C200C.htm
flat_ms:      ==
flat_msn:     example.org/index.GET_C200C_0.htm
flat_msn:     ==
flat_msn:     example.org/index.GET_C200C_0.html
flat_msn:     example.org/media__index.GET_C200C_0.htm
flat_msn:     ==
flat_msn:     example.org/view__index?one=1&two=2&three=3.GET_C200C_0.htm
flat_msn:     königsgäßchen.example.org/index.GET_C200C_0.html
flat_msn:     ジャジェメント.ですの.example.org/испытание__is__index.GET_C200C_0.htm
flat_msn:     ==
flat_mhs:     example.org/index.GET_50d7_C200C.htm
flat_mhs:     example.org/index.GET_8198_C200C.htm
flat_mhs:     example.org/index.GET_f0dc_C200C.html
flat_mhs:     example.org/media__index.GET_086d_C200C.htm
flat_mhs:     example.org/media__index.GET_3fbb_C200C.htm
flat_mhs:     example.org/view__index?one=1&two=2&three=3.GET_5658_C200C.htm
flat_mhs:     königsgäßchen.example.org/index.GET_4f11_C200C.html
flat_mhs:     ジャジェメント.ですの.example.org/испытание__is__index.GET_c4ae_C200C.htm
flat_mhs:     ==
flat_mhsn:    example.org/index.GET_50d7_C200C_0.htm
flat_mhsn:    example.org/index.GET_8198_C200C_0.htm
flat_mhsn:    example.org/index.GET_f0dc_C200C_0.html
flat_mhsn:    example.org/media__index.GET_086d_C200C_0.htm
flat_mhsn:    example.org/media__index.GET_3fbb_C200C_0.htm
flat_mhsn:    example.org/view__index?one=1&two=2&three=3.GET_5658_C200C_0.htm
flat_mhsn:    königsgäßchen.example.org/index.GET_4f11_C200C_0.html
flat_mhsn:    ジャジェメント.ですの.example.org/испытание__is__index.GET_c4ae_C200C_0.htm
flat_mhsn:    ==
"""

not_allowed = gettext("; this is not allowed to prevent accidental data loss")
variance_help = gettext("; your `--output` format fails to provide enough variance to solve this problem automatically (did your forget to place a `%%(num)d` substitution in there?)") + not_allowed

def str_anystr(x : str | bytes) -> str:
    if isinstance(x, str):
        return x
    else:
        return _os.fsdecode(x)

@_dc.dataclass
class Memory:
    consumption : int = 0

@_dc.dataclass
class SeenCounter(_t.Generic[_t.AnyStr]):
    mem : Memory
    state : _c.OrderedDict[_t.AnyStr, int] = _dc.field(default_factory=_c.OrderedDict)

    def __len__(self) -> int:
        return len(self.state)

    def count(self, value : _t.AnyStr) -> int:
        try:
            count = self.state[value]
        except KeyError:
            self.state[value] = 0
            self.mem.consumption += len(value)
            return 0
        else:
            count += 1
            self.state[value] = count
            return count

    def pop(self) -> tuple[_t.AnyStr, int]:
        res = self.state.popitem(False)
        abs_out_path, _ = res
        self.mem.consumption -= len(abs_out_path)
        return res

def make_deferred_emit(cargs : _t.Any,
                       destination : _t.AnyStr,
                       action : str,
                       actioning : str,
                       deferredIO : type[DeferredIO[DataSource, _t.AnyStr]]) \
        -> tuple[_t.Callable[[DataSource, ReqresExpr], None], _t.Callable[[], None]]:
    output_format = cargs.output_format + ".wrr"

    # current memory consumption
    mem = Memory()
    # for each `--output` value, how many times it was seen
    seen_counter : SeenCounter[_t.AnyStr] = SeenCounter(mem)

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

    max_memory_mib = cargs.max_memory * 1024 * 1024
    def flush_updates(final : bool) -> None:
        """Flush some of the queue."""
        max_deferred : int = cargs.max_deferred if not final else 0
        max_memory : int = max_memory_mib if not final else 0
        max_seen : int = cargs.max_seen
        max_cached : int = cargs.max_cached
        max_batched : int = cargs.max_batched

        num_deferred = len(deferred_intents)
        num_cached = len(source_cache)
        num_seen = len(seen_counter)
        if num_deferred <= max_deferred and \
           num_cached <= max_cached and \
           num_seen <= max_seen and \
           mem.consumption <= max_memory:
            return

        done_files : list[_t.AnyStr] | None = None
        if cargs.terminator is not None:
            done_files = []

        def complete_intent(abs_out_path : _t.AnyStr, intent : DeferredIO[DataSource, _t.AnyStr]) -> None:
            mem.consumption -= intent.approx_size() + len(abs_out_path)

            if not cargs.quiet:
                if cargs.dry_run:
                    ing = gettext(f"dry-run: (not) {actioning}")
                else:
                    ing = gettext(actioning)

                stderr.write_str(ing)
                stderr.write_str(": `")
                stderr.write(intent.format_source())
                stderr.write_str("` -> `")
                stderr.write(abs_out_path)
                stderr.write_str_ln("`")
                stderr.flush()

            try:
                updated_source = intent.run(abs_out_path, dsync, cargs.dry_run)
            except Failure as exc:
                if cargs.errors == "ignore":
                    return
                exc.elaborate(gettext(f"while {actioning} `%s` -> `%s`"),
                              str_anystr(intent.format_source()),
                              str_anystr(abs_out_path))
                if cargs.errors != "fail":
                    _logging.error("%s", str(exc))
                    return
                # raise CatastrophicFailure so that load_map_orderly wouldn't try handling it
                raise CatastrophicFailure("%s", str(exc))

            if done_files is not None:
                done_files.append(abs_out_path)

            if updated_source is not None:
                try:
                    old_source = source_cache[abs_out_path]
                except KeyError: pass
                else:
                    mem.consumption -= old_source.approx_size() + len(abs_out_path) # type: ignore
                source_cache[abs_out_path] = updated_source
                mem.consumption += updated_source.approx_size() + len(abs_out_path) # type: ignore

        # flush seen cache
        while num_seen > 0 and \
              (num_seen > max_seen or mem.consumption > max_memory):
            abs_out_path, _ = seen_counter.pop()
            num_seen -= 1

            # if we are over the `--seen-number` not only we must forget
            # about older files, we must also run all operations on the paths
            # we are eliminating so that later deferredIO could pick up newly
            # created files and number them properly
            intent = deferred_intents.pop(abs_out_path, None)
            if intent is None: continue
            complete_intent(abs_out_path, intent)
            num_deferred -= 1

        # flush deferred_intents
        if not final and \
           num_deferred <= max_deferred + max_batched and \
           mem.consumption <= max_memory:
            # we have enough resources to delay some deferredIO, let's do so,
            # so that when we finally hit our resource limits, we would
            # execute max_batched or more deferred actions at once
            # this improves IO performance
            max_deferred += max_batched

        while num_deferred > 0 and \
              (num_deferred > max_deferred or mem.consumption > max_memory):
            abs_out_path, intent = deferred_intents.popitem(False)
            complete_intent(abs_out_path, intent)
            num_deferred -= 1

        # fsync
        dsync.sync()

        # report to stdout
        if done_files is not None:
            for abs_out_path in done_files:
                stdout.write(abs_out_path)
                stdout.write_bytes(cargs.terminator)

            stdout.flush()
            fsync_maybe(stdout.fobj.fileno())

        # delete source files when doing --move, etc
        dsync.finish()

        # flush source_cache
        while num_cached > 0 and \
              (num_cached > max_cached or mem.consumption > max_memory):
            abs_out_path, source = source_cache.popitem(False)
            num_cached -= 1
            mem.consumption -= source.approx_size() + len(abs_out_path) # type: ignore

    def finish_updates() -> None:
        """Flush all of the queue."""
        flush_updates(True)
        assert mem.consumption == 0

    def emit(new_source : DataSource, rrexpr : ReqresExpr) -> None:
        if not filters_allow(cargs, rrexpr): return

        rrexpr.items["num"] = 0
        ogprefix = _os.path.join(destination, output_format % rrexpr)
        prev_rel_out_path = None
        intent : DeferredIO[DataSource, _t.AnyStr] | None = None
        while True:
            rrexpr.items["num"] = seen_counter.count(ogprefix)
            if isinstance(destination, str):
                rel_out_path = _os.path.join(destination, output_format % rrexpr)
            else:
                rel_out_path = _os.path.join(destination, _os.fsencode(output_format % rrexpr))
            abs_out_path = _os.path.abspath(rel_out_path)

            old_source : DataSource | None
            try:
                old_source = source_cache.pop(abs_out_path)
            except KeyError:
                old_source = None
            else:
                mem.consumption -= old_source.approx_size() + len(abs_out_path) # type: ignore

            updated_source : DataSource | None
            try:
                intent = deferred_intents.pop(abs_out_path)
            except KeyError:
                intent, updated_source, permitted = deferredIO.defer(abs_out_path, old_source, new_source) # type: ignore
            else:
                mem.consumption -= intent.approx_size() + len(abs_out_path)
                updated_source, permitted = intent.update_from(new_source)
            del old_source

            if intent is not None:
                deferred_intents[abs_out_path] = intent
                mem.consumption += intent.approx_size() + len(abs_out_path)

            if updated_source is not None:
                source_cache[abs_out_path] = updated_source
                mem.consumption += updated_source.approx_size() + len(abs_out_path) # type: ignore

            if not permitted:
                if prev_rel_out_path == rel_out_path:
                    exc = Failure(gettext("destination already exists") + variance_help)
                    exc.elaborate(gettext(f"while {actioning} `%s` -> `%s`"),
                                  str_anystr(new_source.format_source()), # type: ignore
                                  str_anystr(abs_out_path))
                    raise exc
                prev_rel_out_path = rel_out_path
                continue

            break

        if intent is None:
            # noop
            if cargs.terminator is not None:
                stdout.write(abs_out_path)
                stdout.write_bytes(cargs.terminator)

        if not cargs.lazy:
            flush_updates(False)

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
        stime_maybe : Epoch | None

        def get_stime(self, data : bytes | None = None) -> Epoch:
            if self.stime_maybe is not None:
                return self.stime_maybe

            res : Epoch
            if data is not None:
                bio = _t.cast(_io.BufferedReader, _io.BytesIO(data))
                res = wrr_load_expr(bio, self.abs_path).stime
            else:
                res = wrr_loadf_expr(self.abs_path).stime
            self.stime_maybe = res
            return res

        def approx_size(self) -> int:
            return 128 + len(self.abs_path)

        def format_source(self) -> _t.AnyStr:
            return self.abs_path

    @_dc.dataclass
    class OrganizeIntent(DeferredIO[OrganizeSource[_t.AnyStr], _t.AnyStr], _t.Generic[_t.AnyStr]):
        source : OrganizeSource[_t.AnyStr]
        exists : bool

        def format_source(self) -> _t.AnyStr:
            return self.source.format_source()

        def approx_size(self) -> int:
            return 32 + self.source.approx_size()

        @staticmethod
        def defer(abs_out_path : _t.AnyStr,
                  old_source: OrganizeSource[_t.AnyStr] | None,
                  new_source : OrganizeSource[_t.AnyStr]) \
                -> tuple[DeferredIO[OrganizeSource[_t.AnyStr], _t.AnyStr] | None,
                         OrganizeSource[_t.AnyStr] | None,
                         bool]:
            if new_source.abs_path == abs_out_path:
                # hot evaluation path: renaming, hardlinking,
                # symlinking, or etc to itself; skip it
                return None, old_source, True

            if old_source is None:
                try:
                    out_lstat = _os.lstat(abs_out_path)
                except FileNotFoundError:
                    # target does not exists
                    return OrganizeIntent(new_source, False), new_source, True
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
                            return OrganizeIntent(new_source, True), new_source, True
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
                old_source = OrganizeSource(abs_out_path, out_stat, None)

            # re-create an intent for the target as if it was generated from old_source
            intent = OrganizeIntent(old_source, True)
            # update it from new_source
            source, permitted = intent.update_from(new_source)
            # check the result
            if moving and permitted:
                # permitted moves always generate a replace
                return OrganizeIntent(new_source, True), new_source, True
            elif source is old_source:
                # the source was unchanged, generate a noop
                return None, source, permitted
            else:
                return intent, source, permitted

        def update_from(self, new_source : OrganizeSource[_t.AnyStr]) \
                -> tuple[OrganizeSource[_t.AnyStr], bool]:
            if symlinking and self.source.abs_path == new_source.abs_path:
                # same source file path
                return self.source, True

            disk_data : bytes | None = None
            if check_data:
                if _os.path.samestat(self.source.stat_result, new_source.stat_result):
                    # same source file inode
                    return self.source, True

                # check if overwriting it would be a noop
                # TODO more efficiently
                with open(self.source.abs_path, "rb") as f:
                    disk_data = f.read()

                if file_content_equals(new_source.abs_path, disk_data):
                    # same data on disk
                    return self.source, True

            if not allow_updates:
                return self.source, False

            if self.source.get_stime(disk_data) < new_source.get_stime():
                # update source
                self.source = new_source

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
                action_op(self.source.abs_path, abs_out_path, dsync, self.exists)
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
        emit_one(OrganizeSource(abs_in_path, in_stat, rrexpr.stime), rrexpr)

    return emit, finish

def cmd_organize(cargs : _t.Any) -> None:
    if cargs.walk_paths == "unset":
        cargs.walk_paths = None if not cargs.allow_updates else False
    if cargs.walk_fs == "unset":
        cargs.walk_fs = True if not cargs.allow_updates else False

    compile_filters(cargs)
    elaborate_output(cargs)
    handle_paths(cargs)

    if cargs.destination is not None:
        # destination is set explicitly
        emit, finish = make_organize_emit(cargs, cargs.destination, cargs.allow_updates)
        try:
            map_wrr_paths_extra(emit, cargs.paths, ordering=cargs.walk_fs, errors=cargs.errors)
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
                map_wrr_paths_extra(emit, [path], ordering=cargs.walk_fs, errors=cargs.errors)
            finally:
                finish()

def cmd_import_generic(cargs : _t.Any, load_wrrs : _t.Callable[[_io.BufferedReader, _t.AnyStr], _t.Iterator[Reqres]]) -> None:
    compile_filters(cargs)
    elaborate_output(cargs)
    handle_paths(cargs)

    emit_one : _t.Callable[[SourcedBytes[_t.AnyStr], ReqresExpr], None]
    emit_one, finish = make_deferred_emit(cargs, cargs.destination, "import", "importing", make_DeferredFileWriteIntent(cargs.allow_updates))

    def emit(abs_in_path : _t.AnyStr, rel_in_path : _t.AnyStr, in_stat : _os.stat_result, rr : _t.Iterator[Reqres]) -> None:
        dev, ino = in_stat.st_dev, in_stat.st_ino
        n = 0
        for reqres in rr:
            if want_stop: raise KeyboardInterrupt()

            rrexpr = ReqresExpr(reqres, abs_in_path, [n])
            # TODO: to fix this cast, make ReqresExpr a _t.Generic
            emit_one(SourcedBytes(_t.cast(_t.AnyStr, rrexpr.format_source()), wrr_dumps(rrexpr.reqres)), rrexpr) # type: ignore
            n += 1

    global should_raise
    should_raise = False

    try:
        for path in cargs.paths:
            load_map_orderly(load_wrrs, emit, path, ordering=cargs.walk_fs, errors=cargs.errors)
    finally:
        finish()

def cmd_import_bundle(cargs : _t.Any) -> None:
    cmd_import_generic(cargs, wrr_load_bundle)

def cmd_import_mitmproxy(cargs : _t.Any) -> None:
    from .mitmproxy import load_as_wrrs
    cmd_import_generic(cargs, load_as_wrrs)

default_export_expr = "response.body|eb|scrub response +all_refs,-actions"
def cmd_export_mirror(cargs : _t.Any) -> None:
    compile_filters(cargs)
    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_export_expr)]
    elaborate_output(cargs)
    handle_paths(cargs)

    always_fallback = cargs.remap_urls in ["id", "void"]
    remap_url_fallback : _t.Callable[[Epoch, str, int, ParsedURL], str]
    if cargs.remap_urls in ["id", "open"]:
        remap_url_fallback = lambda st, ap, kind, purl: remap_url_id(kind, purl.raw_url)
    elif cargs.remap_urls in ["void", "closed"]:
        remap_url_fallback = lambda st, ap, kind, purl: remap_url_into_void(kind, purl.raw_url)
    elif cargs.remap_urls == "all":
        def remap_url_fallback(stime : Epoch, document_path : str, kind : int, purl : ParsedURL) -> str:
            trrexpr = ReqresExpr(trivial_Reqres(purl, stime, stime, stime), None, [])
            trrexpr.items["num"] = 0
            rel_out_path : str = _os.path.join(destination, cargs.output_format % trrexpr)
            abs_out_path = _os.path.abspath(rel_out_path)
            return _os.path.relpath(abs_out_path, document_path)
    else:
        assert False

    def remap_url_func_maker(queue : list[str], enqueue : bool, stime : Epoch, document_path : str) -> _t.Callable[[int, str], str]:
        def remap_url_func(kind : int, url : str) -> str:
            try:
                purl = parse_url(url)
            except URLParsingError:
                issue("malformed URL `%s`", url)
                return remap_url_into_void(kind, url)

            if purl.scheme not in Reqres_url_schemes:
                issue("not remapping `%s`", url)
                return url

            net_url = purl.net_url
            try:
                _, _, abs_out_path = index[net_url]
            except KeyError:
                abs_out_path = None

            if abs_out_path is not None and net_url not in visited:
                visited.add(net_url)
                # queue this if we are not over max_depth or this is a resource
                if enqueue or kind == 2:
                    queue.append(net_url)
                    if stdout.isatty:
                        stdout.write_bytes(b"\033[33m")
                    stdout.write_str_ln(gettext("queued %s (%s)") % (purl.pretty_url, net_url))
                    if stdout.isatty:
                        stdout.write_bytes(b"\033[0m")
                    stdout.flush()

            if abs_out_path is None or always_fallback:
                return remap_url_fallback(stime, document_path, kind, purl)

            return _os.path.relpath(abs_out_path, document_path)
        return remap_url_func

    destination = _os.path.expanduser(cargs.destination)

    allow_updates = cargs.allow_updates == True
    skip_existing = cargs.allow_updates == "partial"

    mem = Memory()
    seen_counter : SeenCounter[str] = SeenCounter(mem)

    # net_url -> (stime, src_path, dst_path)
    index : dict[str, tuple[Epoch, str, str]] = dict()
    # indexed by net_url
    visited : set[str] = set()
    queue : list[str] = []
    current_depth : int = 0
    max_depth : int = cargs.depth

    queue_all = len(cargs.roots) == 0
    def collect(abs_in_path : str, rel_in_path : str, rrexpr : ReqresExpr) -> None:
        reqres = rrexpr.reqres
        response = reqres.response
        if reqres.request.method != "GET" or \
           response is None or \
           response.code != 200:
            return

        if not filters_allow(cargs, rrexpr): return

        net_url = rrexpr.net_url
        stime = rrexpr.stime
        try:
            prev_stime, _, abs_out_path = index[net_url]
        except KeyError:
            prev_stime = None

            rrexpr.items["num"] = 0
            ogprefix = _os.path.join(destination, cargs.output_format % rrexpr)
            rrexpr.items["num"] = seen_counter.count(ogprefix)
            rel_out_path = _os.path.join(destination, cargs.output_format % rrexpr)
            abs_out_path = _os.path.abspath(rel_out_path)

        if prev_stime is None or prev_stime < stime:
            # update
            index[net_url] = stime, abs_in_path, abs_out_path

        if queue_all and net_url not in visited:
            visited.add(net_url)
            queue.append(net_url)

    map_wrr_paths(collect, cargs.paths, ordering=cargs.walk_fs, errors=cargs.errors)

    for url in cargs.roots:
        net_url = parse_url(url).net_url
        if net_url not in index:
            raise CatastrophicFailure(gettext("`--root` `%s` was not found among candidates loaded from given input `PATH`s"), url)
        if net_url not in visited:
            visited.add(net_url)
            queue.append(net_url)

    n = 0
    index_total = len(index)
    prev_total = 0

    while len(queue) > 0:
        if want_stop: raise KeyboardInterrupt()

        prev_total += len(queue)

        prev_queue = queue
        queue = []

        current_depth += 1
        enqueue = current_depth <= max_depth

        for net_url in prev_queue:
            if want_stop: raise KeyboardInterrupt()

            n += 1
            n100 = 100 * n
            n_total = prev_total + len(queue)
            stime, abs_in_path, abs_out_path = index[net_url]
            exists = _os.path.exists(abs_out_path)

            if stdout.isatty:
                stdout.write_bytes(b"\033[32m")
            stdout.write_str_ln(gettext("exporting #%d, %.2f%% of %d (%.2f%% of %d indexed)") % (n, n100 / n_total, n_total, n100 / index_total, index_total))
            if stdout.isatty:
                stdout.write_bytes(b"\033[0m")
            stdout.write_str_ln(gettext("URL %s\nsrc %s\ndst %s") % (net_url, abs_in_path, abs_out_path))
            stdout.flush()

            if skip_existing and exists:
                if stdout.isatty:
                    stdout.write_bytes(b"\033[31m")
                stdout.write_str_ln(gettext("skipped! (destination exists, `--partial` is set)"))
                if stdout.isatty:
                    stdout.write_bytes(b"\033[0m")
                stdout.flush()
                continue

            try:
                rrexpr = wrr_loadf_expr(abs_in_path)
                rrexpr.items["remap_url"] = remap_url_func_maker(queue, enqueue, stime, _os.path.dirname(abs_out_path))

                data : bytes
                with TIOWrappedWriter(_io.BytesIO()) as f:
                    print_exprs(rrexpr, cargs.exprs, cargs.separator, f)
                    data = f.fobj.getvalue()

                if exists and file_content_equals(abs_out_path, data):
                    # this is a noop overwrite, skip it
                    continue
                undeferred_write(data, abs_out_path, None, allow_updates)
            except Failure as exc:
                if cargs.errors == "ignore":
                    continue
                exc.elaborate(gettext(f"while processing `%s`"), abs_in_path)
                if cargs.errors != "fail":
                    _logging.error("%s", str(exc))
                    continue
                raise CatastrophicFailure("%s", str(exc))
            except Exception:
                error(gettext("while processing `%s`"), abs_in_path)
                raise

def add_doc(fmt : argparse.BetterHelpFormatter) -> None:
    _ : _t.Callable[[str], str] = gettext

    fmt.add_text(_("# Examples"))

    fmt.start_section(_("Pretty-print all reqres in `../dumb_server/pwebarc-dump` using an abridged (for ease of reading and rendering) verbose textual representation"))
    fmt.add_code(f"{__package__} pprint ../dumb_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Pipe raw response body from a given WRR file to stdout"))
    fmt.add_code(f'{__package__} get ../dumb_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_(f"Pipe response body scrubbed of dynamic content from a given WRR file to stdout"))
    fmt.add_code(f'{__package__} get -e "response.body|eb|scrub response defaults" ../dumb_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_("Get first 4 characters of a hex digest of sha256 hash computed on the URL without the fragment/hash part"))
    fmt.add_code(f'{__package__} get -e "net_url|to_ascii|sha256|take_prefix 4" ../dumb_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_("Pipe response body from a given WRR file to stdout, but less efficiently, by generating a temporary file and giving it to `cat`"))
    fmt.add_code(f"{__package__} run cat ../dumb_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_text(_(f"Thus `{__package__} run` can be used to do almost anything you want, e.g."))
    fmt.add_code(f"{__package__} run less ../dumb_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_code(f"{__package__} run -- sort -R ../dumb_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_code(f"{__package__} run -n 2 -- diff -u ../dumb_server/pwebarc-dump/path/to/file-v1.wrr ../dumb_server/pwebarc-dump/path/to/file-v2.wrr")
    fmt.end_section()

    fmt.start_section(_(f"List paths of all WRR files from `../dumb_server/pwebarc-dump` that contain only complete `200 OK` responses with bodies larger than 1K"))
    fmt.add_code(f"""wrrarms find --and "status|~= .200C" --and "response.body|len|> 1024" ../dumb_server/pwebarc-dump""")
    fmt.end_section()

    fmt.start_section(_(f"Rename all WRR files in `../dumb_server/pwebarc-dump/default` according to their metadata using `--output default` (see the `{__package__} organize` section for its definition, the `default` format is designed to be human-readable while causing almost no collisions, thus making `num` substitution parameter to almost always stay equal to `0`, making things nice and deterministic)"))
    fmt.add_code(f"{__package__} organize ../dumb_server/pwebarc-dump/default")
    fmt.add_text(_("alternatively, just show what would be done"))
    fmt.add_code(f"{__package__} organize --dry-run ../dumb_server/pwebarc-dump/default")
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

    fmt.start_section(_("Produce a JSON list of `[<file path>, <time it finished loading in seconds since UNIX epoch>, <URL>]` tuples (one per reqres) and pipe it into `jq` for indented and colored output"))
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
    _ : _t.Callable[[str], str] = gettext

    parser = ArgumentParser(
        prog=__package__,
        description=_("A tool to pretty-print, compute and print values from, search, organize (programmatically rename/move/symlink/hardlink files), import, export, (WIP: check, deduplicate, and edit) pWebArc WRR (WEBREQRES, Web REQuest+RESponse) archive files.") + "\n\n" +
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
- `fail`: report failure and stop the execution; default
- `skip`: report failure but skip the reqres that produced it from the output and continue
- `ignore`: `skip`, but don't report the failure"""))

    def add_filters(cmd : _t.Any, do_what : str) -> None:
        grp = cmd.add_argument_group(f"filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `{__package__} get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s")
        grp.add_argument("--or", dest="anys", metavar="EXPR", action="append", type=str, default = [],
                         help=_(f"only {do_what} reqres which match any of these expressions"))
        grp.add_argument("--and", dest="alls", metavar="EXPR", action="append", type=str, default = [],
                         help=_(f"only {do_what} reqres which match all of these expressions"))

    def add_pure(cmd : _t.Any, filter_what : str) -> None:
        add_errors(cmd)
        add_filters(cmd, filter_what)

    def add_impure(cmd : _t.Any, filter_what : str) -> None:
        add_pure(cmd, filter_what)
        grp = cmd.add_mutually_exclusive_group()
        grp.add_argument("--dry-run", action="store_true", help=_("perform a trial run without actually performing any changes"))
        grp.add_argument("-q", "--quiet", action="store_true", help=_("don't log computed updates to stderr"))

    def add_abridged(cmd : _t.Any) -> None:
        grp = cmd.add_mutually_exclusive_group()
        grp.add_argument("-u", "--unabridged", dest="abridged", action="store_false", help=_("print all data in full"))
        grp.add_argument("--abridged", action="store_true", help=_("shorten long strings for brevity, useful when you want to visually scan through batch data dumps; default"))
        cmd.set_defaults(abridged = True)

    def add_termsep(cmd : _t.Any, name : str, what : str = "printing", whatval : str = "print values", allow_not : bool = True, allow_none : bool = False, short : bool = True) -> None:
        agrp = cmd.add_argument_group(what)
        grp = agrp.add_mutually_exclusive_group()

        def_def = "; " + _("default")
        def_val : bytes | None
        if allow_none:
            grp.add_argument("--no-print", dest=f"{name}ator", action="store_const", const = None, help=_("don't print anything") + def_def)
            def_lf = ""
            def_val = None
        else:
            def_lf = def_def
            def_val = b"\n"

        if allow_not:
            grp.add_argument(f"--not-{name}ated", dest=f"{name}ator", action="store_const", const = b"", help=_(f"{whatval} without {name}ating them with anything, just concatenate them"))

        if short:
            grp.add_argument("-l", f"--lf-{name}ated", dest=f"{name}ator", action="store_const", const = b"\n", help=_(f"{whatval} {name}ated with `\\n` (LF) newline characters") + def_lf)
            grp.add_argument("-z", f"--zero-{name}ated", dest=f"{name}ator", action="store_const", const = b"\0", help=_(f"{whatval} {name}ated with `\\0` (NUL) bytes"))
        else:
            grp.add_argument(f"--lf-{name}ated", dest=f"{name}ator", action="store_const", const = b"\n", help=_(f"{whatval} {name}ated with `\\n` (LF) newline characters") + def_lf)
            grp.add_argument(f"--zero-{name}ated", dest=f"{name}ator", action="store_const", const = b"\0", help=_(f"{whatval} {name}ated with `\\0` (NUL) bytes"))

        if name == "termin":
            cmd.set_defaults(terminator = def_val)
        elif name == "separ":
            cmd.set_defaults(separator = def_val)

    def add_terminator(cmd : _t.Any, *args : _t.Any, **kwargs : _t.Any) -> None:
        add_termsep(cmd, "termin", *args, **kwargs)

    def add_separator(cmd : _t.Any, *args : _t.Any, **kwargs : _t.Any) -> None:
        add_termsep(cmd, "separ", *args, **kwargs)

    def add_paths(cmd : _t.Any, kind : str = "default") -> None:
        def_paths : bool | str | None
        def_walk : bool | str | None
        if kind == "default":
            def_def = "; " + _("default")
            def_sup = ""
            def_paths = None
            def_walk = True
        elif kind == "organize":
            def_def = "; " + _("default when `--keep`")
            def_sup = "; " + _("default when `--latest`")
            def_paths = "unset"
            def_walk = "unset"
        else:
            assert False

        agrp = cmd.add_argument_group("file system path ordering")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--paths-given-order", dest="walk_paths", action="store_const", const = None, help=_("`argv` and `--stdin0` `PATH`s are processed in the order they are given") + def_def)
        grp.add_argument("--paths-sorted", dest="walk_paths", action="store_const", const = True, help=_("`argv` and `--stdin0` `PATH`s are processed in lexicographic order"))
        grp.add_argument("--paths-reversed", dest="walk_paths", action="store_const", const = False, help=_("`argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order") + def_sup)
        cmd.set_defaults(walk_paths = def_paths)

        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--walk-fs-order", dest="walk_fs", action="store_const", const = None, help=_("recursive file system walk is done in the order `readdir(2)` gives results"))
        grp.add_argument("--walk-sorted", dest="walk_fs", action="store_const", const = True, help=_("recursive file system walk is done in lexicographic order") + def_def)
        grp.add_argument("--walk-reversed", dest="walk_fs", action="store_const", const = False, help=_("recursive file system walk is done in reverse lexicographic order") + def_sup)
        cmd.set_defaults(walk_fs = def_walk)

        cmd.add_argument("--stdin0", action="store_true", help=_("read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments"))

        cmd.add_argument("paths", metavar="PATH", nargs="*", type=str, help=_("inputs, can be a mix of files and directories (which will be traversed recursively)"))

    # pprint
    cmd = subparsers.add_parser("pprint", help=_("pretty-print given WRR files"),
                                description = _("""Pretty-print given WRR files to stdout."""))
    add_pure(cmd, "print")
    add_abridged(cmd)
    agrp = cmd.add_argument_group("MIME type sniffing")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--naive", dest="paranoid", action="store_const", const=False, help=_(f"""populate "potentially" lists like `{__package__} (get|run|export) --expr '(request|response).body|eb|scrub \\2 defaults'` does; default"""))
    grp.add_argument("--paranoid", dest="paranoid", action="store_const", const=True, help=_(f"""populate "potentially" lists in the output using paranoid MIME type sniffing like `{__package__} (get|run|export) --expr '(request|response).body|eb|scrub \\2 +paranoid'` does; this exists to answer "Hey! Why did it censor out my data?!" questions"""))
    grp.set_defaults(paranoid = False)
    add_paths(cmd)
    cmd.set_defaults(func=cmd_pprint)

    class AddExpr(argparse.Action):
        def __call__(self, parser : _t.Any, cfg : argparse.Namespace, value : _t.Any, option_string : _t.Optional[str] = None) -> None:
            cfg.exprs.append(compile_expr(value))

    fd_fobj = {0: stdin, 1: stdout, 2: stderr}

    class AddExprFd(argparse.Action):
        def __call__(self, parser : _t.Any, cfg : argparse.Namespace, value : _t.Any, option_string : _t.Optional[str] = None) -> None:
            fileno = cfg.expr_fd
            try:
                fobj = fd_fobj[fileno]
            except KeyError:
                fobj = TIOWrappedWriter(_os.fdopen(fileno, "wb"))
                fd_fobj[fileno] = fobj

            try:
                els = cfg.mexprs[fobj]
            except KeyError:
                els = []
                cfg.mexprs[fobj] = els

            els.append(compile_expr(value))

    def add_expr(cmd : _t.Any, kind : str) -> None:
        def __(value : str, indent : int = 6) -> str:
            prefix = " " * indent
            lines = value.split("\n")
            return f"\n{prefix}".join([_(line) for line in lines]).replace('%', '%%')

        agrp = cmd.add_argument_group("expression evaluation")

        if kind == "get":
            agrp.add_argument("--expr-fd", metavar="INT", type=int, default = 1, help=_(f"file descriptor to which the results of evaluations of the following `--expr`s computations should be written; can be specified multiple times, thus separating different `--expr`s into different output streams; default: `%(default)s`, i.e. `stdout`"))

            def_expr = f"`{default_get_expr}`, which will dump the HTTP response body"
            agrp.add_argument("-e", "--expr", dest="mexprs", metavar="EXPR", action=AddExprFd, type=str, default = {}, help=_(f'an expression to compute; can be specified multiple times in which case computed outputs will be printed sequentially; see also "printing" options below') + \
                "; " + \
                _("default: %s") % (def_expr,) + "; " + \
                _("each `EXPR` describes a state-transformer (pipeline) which starts from value `None` and evaluates a script built from the following") + ":\n" + \
                "- " + _("constants and functions:") + "\n" + \
                "".join([f"  - `{name}`: {__(value[0])}\n" for name, value in ReqresExpr_atoms.items()]) + \
                "- " + _("reqres fields, these work the same way as constants above, i.e. they replace current value of `None` with field's value, if reqres is missing the field in question, which could happen for `response*` fields, the result is `None`:") + "\n" + \
                "".join([f"  - `{name}`: {__(value)}\n" for name, value in Reqres_fields.items()]) + \
                "- " + _("derived attributes:") + "\n" + \
                "".join([f"  - `{name}`: {__(value)}\n" for name, value in Reqres_derived_attrs.items()]) + \
                "- " + _("a compound expression built by piping (`|`) the above, for example") + __(f""":
- `{default_get_expr}` (the default for `get`) will print raw `response.body` or an empty byte string, if there was no response;
- `{default_get_expr}|scrub response defaults` will take the above value, `scrub` it using default content scrubbing settings which will censor out all action and resource reference URLs;
- `{default_export_expr}` (the default for `export`) will remap all `href` jump-links and `src` resource references to local files while still censoring out all action URLs (since those don't make sense for a static mirror);
- `response.complete` will print the value of `response.complete` or `None`, if there was no response;
- `response.complete|false` will print `response.complete` or `False`;
- `net_url|to_ascii|sha256` will print `sha256` hash of the URL that was actually sent over the network;
- `net_url|to_ascii|sha256|take_prefix 4` will print the first 4 characters of the above;
- `path_parts|take_prefix 3|pp_to_path` will print first 3 path components of the URL, minimally quoted to be used as a path;
- `query_ne_parts|take_prefix 3|qsl_to_path|abbrev 128` will print first 3 non-empty query parameters of the URL, abbreviated to 128 characters or less, minimally quoted to be used as a path;""", 2))
        else:
            if kind == "run":
                def_expr = f"`{default_get_expr}`, which will dump the HTTP response body"
            elif kind == "stream":
                def_expr = f"`{default_stream_expr}`, which will dump the whole reqres structure"
            elif kind == "export":
                def_expr = f"`{default_export_expr}`, which will export safe scrubbed versions of all files"
            else:
                assert False

            agrp.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action=AddExpr, type=str, default = [], help=_(f"an expression to compute, same expression format and semantics as `{__package__} get --expr` (which see); can be specified multiple times") + \
                              "; " + \
                              _("default: %s") % (def_expr,))

        def_def = "; " + _("default")
        if kind != "export":
            def_id = def_def
            def_all = ""
        else:
            def_id = ""
            def_all = def_def

        agrp = cmd.add_argument_group("URL remapping; used by `scrub` atom of `--expr`")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--remap-id", dest="remap_urls", action="store_const", const="id", help=_("remap all URLs with an identity function; i.e. don't remap anything") + def_id)
        grp.add_argument("--remap-void", dest="remap_urls", action="store_const", const="void", help=_("remap all jump-link and action URLs to `javascript:void(0)` and all resource URLs into empty `data:` URLs; resulting web pages will be self-contained"))

        if kind == "export":
            grp.add_argument("--remap-open", "-k", "--convert-links", dest="remap_urls", action="store_const", const="open", help=_("point all URLs present in input `PATH`s and reachable from `--root`s in no more that `--depth` steps to their corresponding output paths, remap all other URLs like `--remap-id` does; this is similar to `wget (-k|--convert-links)`"))
            grp.add_argument("--remap-closed", dest="remap_urls", action="store_const", const="closed", help=_("remap all reachable URLs like `--remap-open` does, remap all other URLs like `--remap-void` does; `export`ed `mirror`s will be self-contained"))
            grp.add_argument("--remap-all", dest="remap_urls", action="store_const", const="all", help=_(f"remap all reachable URLs like `--remap-open` does, remap other URLs as if for each missing URL a trivial `GET <URL> -> 200 OK` reqres is present among input `PATH`s; this will produce broken links if the `--output` format depends on anything but the URL itself, but for a simple `--output` (like the default `hupq`) this will remap missing URLs to `--output` paths that they would occupy if they were present; this allows `{__package__} export` to be used incrementally; `export`ed `mirror`s will be self-contained") + def_all)

        if kind != "export":
            cmd.set_defaults(remap_urls = "id")
        else:
            cmd.set_defaults(remap_urls = "all")

        if kind == "stream":
            add_terminator(cmd, "`--format=raw` output printing", "print `--format=raw` output values")
        elif kind != "export":
            add_separator(cmd)
        else:
            add_separator(cmd, "exporting", "export values", short = False)

    # get
    cmd = subparsers.add_parser("get", help=_("print values produced by computing given expressions on a given WRR file"),
                                description = _(f"""Compute output values by evaluating expressions `EXPR`s on a given reqres stored at `PATH`, then print them to stdout terminating each value as specified."""))

    add_expr(cmd, "get")

    cmd.add_argument("path", metavar="PATH", type=str, help=_("input WRR file path"))
    cmd.set_defaults(func=cmd_get)

    # run
    cmd = subparsers.add_parser("run", help=_("spawn a process with generated temporary files produced by given expressions computed on given WRR files as arguments"),
                                description = _("""Compute output values by evaluating expressions `EXPR`s for each of `NUM` reqres stored at `PATH`s, dump the results into into newly generated temporary files terminating each value as specified, spawn a given `COMMAND` with given arguments `ARG`s and the resulting temporary file paths appended as the last `NUM` arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process."""))

    add_expr(cmd, "run")

    cmd.add_argument("-n", "--num-args", metavar="NUM", type=int, default = 1, help=_("number of `PATH`s; default: `%(default)s`"))
    cmd.add_argument("command", metavar="COMMAND", type=str, help=_("command to spawn"))
    cmd.add_argument("args", metavar="ARG", nargs="*", type=str, help=_("additional arguments to give to the `COMMAND`"))
    cmd.add_argument("paths", metavar="PATH", nargs="+", type=str, help=_("input WRR file paths to be mapped into new temporary files"))
    cmd.set_defaults(func=cmd_run)

    # stream
    cmd = subparsers.add_parser("stream", help=_(f"produce a stream of structured lists containing values produced by computing given expressions on given WRR files, a generalized `{__package__} get`"),
                                description = _("""Compute given expressions for each of given WRR files, encode them into a requested format, and print the result to stdout."""))
    add_pure(cmd, "print")
    add_abridged(cmd)
    cmd.add_argument("--format", choices=["py", "cbor", "json", "raw"], default="py", help=_("""generate output in:
- py: Pythonic Object Representation aka `repr`; default
- cbor: CBOR (RFC8949)
- json: JavaScript Object Notation aka JSON; **binary data can't be represented, UNICODE replacement characters will be used**
- raw: concatenate raw values; termination is controlled by `*-terminated` options
"""))
    add_expr(cmd, "stream")
    add_paths(cmd)
    cmd.set_defaults(func=cmd_stream)

    # find
    cmd = subparsers.add_parser("find", help=_("print paths of WRR files matching specified criteria"),
                                description = _(f"""Print paths of WRR files matching specified criteria."""))
    add_pure(cmd, "print paths to")
    add_terminator(cmd, "found files printing", "print absolute paths of matching WRR files", allow_not=False)
    add_paths(cmd)
    cmd.set_defaults(func=cmd_find)

    def add_memory(cmd : _t.Any, max_deferred : int = 1024, max_batch : int = 128) -> None:
        agrp = cmd.add_argument_group("caching, deferring, and batching")
        agrp.add_argument("--seen-number", metavar = "INT", dest="max_seen", type=int, default=16384, help=_(f"""track at most this many distinct generated `--output` values; default: `%(default)s`;
making this larger improves disk performance at the cost of increased memory consumption;
setting it to zero will force force `{__package__}` to constantly re-check existence of `--output` files and force `{__package__}` to execute  all IO actions immediately, disregarding `--defer-number` setting"""))
        agrp.add_argument("--cache-number", metavar = "INT", dest="max_cached", type=int, default=8192, help=_(f"""cache `stat(2)` information about this many files in memory; default: `%(default)s`;
making this larger improves performance at the cost of increased memory consumption;
setting this to a too small number will likely force `{__package__}` into repeatedly performing lots of `stat(2)` system calls on the same files;
setting this to a value smaller than `--defer-number` will not improve memory consumption very much since deferred IO actions also cache information about their own files
"""))
        agrp.add_argument("--defer-number", metavar = "INT", dest="max_deferred", type=int, default=max_deferred, help=_("""defer at most this many IO actions; default: `%(default)s`;
making this larger improves performance at the cost of increased memory consumption;
setting it to zero will force all IO actions to be applied immediately"""))
        agrp.add_argument("--batch-number", metavar = "INT", dest="max_batched", type=int, default=max_batch, help=_(f"""queue at most this many deferred IO actions to be applied together in a batch; this queue will only be used if all other resource constraints are met; default: %(default)s"""))
        agrp.add_argument("--max-memory", metavar = "INT", dest="max_memory", type=int, default=1024, help=_("""the caches, the deferred actions queue, and the batch queue, all taken together, must not take more than this much memory in MiB; default: `%(default)s`;
making this larger improves performance;
the actual maximum whole-program memory consumption is `O(<size of the largest reqres> + <--seen-number> + <sum of lengths of the last --seen-number generated --output paths> + <--cache-number> + <--defer-number> + <--batch-number> + <--max-memory>)`"""))
        agrp.add_argument("--lazy", action="store_true", help=_(f"""sets all of the above options to positive infinity;
most useful when doing `{__package__} organize --symlink --latest --output flat` or similar, where the number of distinct generated `--output` values and the amount of other data `{__package__}` needs to keep in memory is small, in which case it will force `{__package__}` to compute the desired file system state first and then perform all disk writes in a single batch"""))

    def add_fileout(cmd : _t.Any, kind : str) -> None:
        agrp = cmd.add_argument_group("file outputs")

        if kind == "organize":
            agrp.add_argument("-t", "--to", dest="destination", metavar="DESTINATION", type=str, help=_("destination directory; when unset each source `PATH` must be a directory which will be treated as its own `DESTINATION`"))
            agrp.add_argument("-o", "--output", metavar="FORMAT", default="default", type=str, help=_("""format describing generated output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string:""") + "\n" + \
                         "- " + _("available aliases and corresponding %%-substitutions:") + "\n" + \
                         "".join([f"  - `{name}`{' ' * (12 - len(name))}: `{value.replace('%', '%%')}`" + ("; the default" if name == "default" else "") + "\n" + output_example(name, 8) + "\n" for name, value in output_aliases.items()]) + \
                         "- " + _("available substitutions:") + "\n" + \
                         "  - " + _(f"all expressions of `{__package__} get --expr` (which see)") + ";\n" + \
                         "  - `num`: " + _("number of times the resulting output path was encountered before; adding this parameter to your `--output` format will ensure all generated file names will be unique"))
        elif kind == "import" or kind == "export":
            if kind != "export":
                def_def = "default"
            else:
                def_def = "hupq"

            agrp.add_argument("-t", "--to", dest="destination", metavar="DESTINATION", type=str, required=True, help=_("destination directory"))
            agrp.add_argument("-o", "--output", metavar="FORMAT", default=def_def, type=str, help=_(f"""format describing generated output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string; same expression format as `{__package__} organize --output` (which see); default: %(default)s"""))
        else:
            assert False

        add_terminator(cmd, "new `--output`s printing", "print absolute paths of newly produced or replaced files", allow_not=False, allow_none=True)

        agrp = cmd.add_argument_group("updates to `--output`s")
        grp = agrp.add_mutually_exclusive_group()

        def_disallow = _("disallow overwrites and replacements of any existing `--output` files under `DESTINATION`, i.e. only ever create new files under `DESTINATION`, producing errors instead of attempting any other updates; default")

        def def_dangerous(what : str) -> str:
            return _(f"DANGEROUS! not recommended, {what} to a new `DESTINATION` with the default `--no-overwrites` and then `rsync`ing some of the files over to the old `DESTINATION` is a safer way to do this")

        if kind == "organize":
            grp.add_argument("--no-overwrites", dest="allow_updates", action="store_const", const=False, help=def_disallow + ";\n" + \
                _("""`--output` targets that are broken symlinks will be considered to be non-existent and will be replaced;
when the operation's source is binary-eqivalent to the `--output` target, the operation will be permitted, but the disk write will be reduced to a noop, i.e. the results will be deduplicated;
the `dirname` of a source file and the `--to` target directories can be the same, in that case the source file will be renamed to use new `--output` name, though renames that attempt to swap source file names will still fail
"""))
            grp.add_argument("--latest", dest="allow_updates", action="store_const", const=True, help=_("""replace files under `DESTINATION` with their latest version;
this is only allowed in combination with `--symlink` at the moment;
for each source `PATH` file, the destination `--output` file will be replaced with a symlink to the source if and only if `stime_ms` of the source reqres is newer than `stime_ms` of the reqres stored at the destination file
"""))
        elif kind == "import":
            grp.add_argument("--no-overwrites", dest="allow_updates", action="store_const", const=False, help=def_disallow)
            grp.add_argument("--overwrite-dangerously", dest="allow_updates", action="store_const", const=True, help=_("permit overwriting of old `--output` files under `DESTINATION`") + ";\n" + def_dangerous("importing"))
        elif kind == "export":
            grp.add_argument("--no-overwrites", dest="allow_updates", action="store_const", const=False, help=def_disallow + ";\n" + \
                _("""repeated exports of the same export targets with the same parameters (which, therefore, will produce the same `--output` data) are allowed and will be reduced to noops;
however, trying to overwrite existing `--output` files under `DESTINATION` with any new data will produce errors;
this allows reusing the `DESTINATION` between unrelated exports and between exports that produce the same data on disk in their common parts
"""))
            grp.add_argument("--skip-existing", "--partial", dest="allow_updates", action="store_const", const="partial", help=_("""skip exporting of targets which have a corresponding `--output` file under `DESTINATION`;
using this together with `--depth` is likely to produce a partially broken result, since skipping an export target will also skip all the documents it references;
on the other hand, this is quite useful when growing a partial mirror generated with `--remap-all`
"""))
            grp.add_argument("--overwrite-dangerously", dest="allow_updates", action="store_const", const=True, help=_("export all targets while permitting overwriting of old `--output` files under `DESTINATION`") + ";\n" + def_dangerous("exporting"))

        cmd.set_defaults(allow_updates = False)

    # organize
    cmd = subparsers.add_parser("organize", help=_("programmatically rename/move/hardlink/symlink WRR files based on their contents"),
                                description = _(f"""Parse given WRR files into their respective reqres and then rename/move/hardlink/symlink each file to `DESTINATION` with the new path derived from each reqres' metadata.

Operations that could lead to accidental data loss are not permitted.
E.g. `{__package__} organize --move` will not overwrite any files, which is why the default `--output` contains `%(num)d`."""))
    add_impure(cmd, "work on")

    agrp = cmd.add_argument_group("action")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--move", dest="action", action="store_const", const="move", help=_("move source files under `DESTINATION`; default"))
    grp.add_argument("--copy", dest="action", action="store_const", const="copy", help=_("copy source files to files under `DESTINATION`"))
    grp.add_argument("--hardlink", dest="action", action="store_const", const="hardlink", help=_("create hardlinks from source files to paths under `DESTINATION`"))
    grp.add_argument("--symlink", dest="action", action="store_const", const="symlink", help=_("create symlinks from source files to paths under `DESTINATION`"))
    cmd.set_defaults(action = "move")

    add_fileout(cmd, "organize")
    add_memory(cmd)

    add_paths(cmd, "organize")
    cmd.set_defaults(func=cmd_organize)

    def add_import_args(cmd : _t.Any) -> None:
        add_impure(cmd, "import")
        add_fileout(cmd, "import")
        add_memory(cmd, 0, 1024)
        add_paths(cmd)

    # import
    supcmd = subparsers.add_parser("import", help=_("convert other HTTP archive formats into WRR"),
                                   description = _(f"""Use specified parser to parse data in each `INPUT` `PATH` into (a sequence of) reqres and then generate and place their WRR-dumps into separate WRR files under `DESTINATION` with paths derived from their metadata.
In short, this is `{__package__} organize --copy` for `INPUT` files that use different files formats."""))
    supsub = supcmd.add_subparsers(title="file formats")

    cmd = supsub.add_parser("bundle", help=_("convert WRR-bundles into separate WRR files"),
                            description = _(f"""Parse each `INPUT` `PATH` as a WRR-bundle (an optionally compressed sequence of WRR-dumps) and then generate and place their WRR-dumps into separate WRR files under `DESTINATION` with paths derived from their metadata."""))
    add_import_args(cmd)
    cmd.set_defaults(func=cmd_import_bundle)

    cmd = supsub.add_parser("mitmproxy", help=_("convert `mitmproxy` stream dumps into WRR files"),
                            description = _(f"""Parse each `INPUT` `PATH` as `mitmproxy` stream dump (by using `mitmproxy`'s own parser) into a sequence of reqres and then generate and place their WRR-dumps into separate WRR files under `DESTINATION` with paths derived from their metadata."""))
    add_import_args(cmd)
    cmd.set_defaults(func=cmd_import_mitmproxy)

    # export
    supcmd = subparsers.add_parser("export", help=_(f"convert WRR archives into other formats"),
                                   description = _(f"""Parse given WRR files into their respective reqres, convert to another file format, and then dump the result under `DESTINATION` with the new path derived from each reqres' metadata."""))
    supsub = supcmd.add_subparsers(title="file formats")

    cmd = supsub.add_parser("mirror", help=_("convert given WRR files into a local website mirror stored in interlinked plain files"),
                            description = _(f"""Parse given WRR files, filter out those that have no responses, transform and then dump their response bodies into separate files under `DESTINATION` with the new path derived from each reqres' metadata.
In short, this is a combination of `{__package__} organize --copy` followed by in-place `{__package__} get`.
In other words, this generates static offline website mirrors, producing results similar to those of `wget -mpk`."""))
    add_impure(cmd, "export")
    add_expr(cmd, "export")
    add_fileout(cmd, "export")

    agrp = cmd.add_argument_group("export targets")
    agrp.add_argument("-r", "--root", dest="roots", metavar="URL", action="append", type=str, default = [], help=_(f"recursion root; a URL which will be used as a root for recursive export; can be specified multiple times; if none are specified, then all (`net_url`) URLs available from input `PATH`s will be treated as roots"))
    agrp.add_argument("-d", "--depth", metavar="DEPTH", type=int, default=0, help=_('maximum recursion depth level; the default is `%(default)s`, which means "`--root` documents and their resources only"; setting this to `1` will also export one level of documents referenced via jump and action links, if those are being remapped to local files with `--remap-*`; higher values will mean even more recursion'))

    add_paths(cmd)
    cmd.set_defaults(func=cmd_export_mirror)

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
