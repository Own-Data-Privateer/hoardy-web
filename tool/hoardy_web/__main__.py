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

import collections as _c
import dataclasses as _dc
import errno as _errno
import io as _io
import logging as _logging
import os as _os
import re as _re
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

__prog__ = "hoardy-web"

def issue(pattern : str, *args : _t.Any) -> None:
    message = pattern % args
    if stderr.isatty:
        stderr.write_str_ln("\033[31m" + message + "\033[0m")
    else:
        stderr.write_str_ln(message)
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

def filters_allow(cargs : _t.Any, rrexpr : ReqresExpr[_t.Any]) -> bool:
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
            cargs.output_format = output_alias[cargs.output]
        except KeyError:
            raise CatastrophicFailure(gettext('unknown `--output` alias "%s", prepend "format:" if you want it to be interpreted as a Pythonic %%-substutition'), cargs.output)

def elaborate_paths(paths : list[str | bytes]) -> None:
    for i in range(0, len(paths)):
        paths[i] = _os.path.expanduser(paths[i])

def handle_paths(cargs : _t.Any) -> None:
    if cargs.stdin0:
        paths = stdin.read_all_bytes().split(b"\0")
        last = paths.pop()
        if last != b"":
            raise Failure(gettext("`--stdin0` input format error"))
        cargs.paths += paths

    elaborate_paths(cargs.paths)

    if cargs.walk_paths is not None:
        cargs.paths.sort(reverse=not cargs.walk_paths)

LoadResult = _t.TypeVar("LoadResult")
LoadFFunc = _t.Callable[[_t.AnyStr], LoadResult]
EmitFunc =  _t.Callable[[LoadResult], None]

def load_map_orderly(load_func : LoadFFunc[_t.AnyStr, LoadResult],
                     emit_func : EmitFunc[LoadResult],
                     dir_or_file_path : _t.AnyStr,
                     *,
                     seen_paths : set[_t.AnyStr] | None = None,
                     follow_symlinks : bool = True,
                     ordering : bool | None = False,
                     errors : str = "fail") -> None:
    if seen_paths is not None:
        abs_dir_or_file_path = _os.path.abspath(dir_or_file_path)
        if abs_dir_or_file_path in seen_paths:
            return
        seen_paths.add(abs_dir_or_file_path)

    for path, _ in walk_orderly(dir_or_file_path,
                                include_files = with_extension_not_in([".part", b".part"]),
                                include_directories = False,
                                ordering = ordering,
                                follow_symlinks = follow_symlinks,
                                handle_error = None if errors == "fail" else _logging.error):
        if want_stop: raise KeyboardInterrupt()

        abs_path = _os.path.abspath(path)
        try:
            if follow_symlinks:
                abs_path = _os.path.realpath(abs_path)

            if seen_paths is not None and \
               abs_path != abs_dir_or_file_path: # do not skip top-level paths added above
                if abs_path in seen_paths:
                    continue
                seen_paths.add(abs_path)

            try:
                data = load_func(abs_path)
            except OSError as exc:
                raise Failure(gettext("failed to open `%s`"), path)
            except Failure as exc:
                exc.elaborate(gettext("load"))
                raise exc

            try:
                emit_func(data)
            except Failure as exc:
                exc.elaborate(gettext("emit"))
                raise exc
        except Failure as exc:
            if errors == "ignore":
                continue
            exc.elaborate(gettext("while processing `%s`"), path)
            if errors != "fail":
                _logging.error("%s", str(exc))
                continue
            raise exc

def map_wrr_paths_extra(cargs : _t.Any,
                        loadf_func : LoadFFunc[_t.AnyStr, LoadResult],
                        emit_func : EmitFunc[LoadResult],
                        paths : list[_t.AnyStr],
                        **kwargs : _t.Any) -> None:
    global should_raise
    should_raise = False
    for exp_path in paths:
        load_map_orderly(loadf_func, emit_func, exp_path, ordering=cargs.walk_fs, errors=cargs.errors, **kwargs)

def map_wrr_paths(cargs : _t.Any,
                  emit_func : EmitFunc[ReqresExpr[DeferredSourceType]],
                  paths : list[_t.AnyStr],
                  **kwargs : _t.Any) -> None:
    def emit_many(rrexprs : _t.Iterator[ReqresExpr[DeferredSourceType]]) -> None:
        for rrexpr in rrexprs:
            if want_stop: raise KeyboardInterrupt()

            rrexpr.sniff = cargs.sniff
            if not filters_allow(cargs, rrexpr): return
            emit_func(rrexpr)

    map_wrr_paths_extra(cargs, rrexprs_wrr_bundle_loadf, emit_many, paths, **kwargs) # type: ignore # type inference fail

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

    def emit(rrexpr : ReqresExpr[DeferredSourceType]) -> None:
        wrr_pprint(stdout, rrexpr.reqres, rrexpr.source.show_source(), cargs.abridged, cargs.sniff)
        stdout.flush()

    map_wrr_paths(cargs, emit, cargs.paths)

def print_exprs(rrexpr : ReqresExpr[_t.Any], exprs : list[tuple[str, LinstFunc]],
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

default_expr = {
    "get": "response.body|eb",
    "run": "response.body|eb",
    "stream": ".",
    "id": "response.body|eb|scrub response +all_refs",
    "void": "response.body|eb|scrub response -all_refs",
    "open": "response.body|eb|scrub response *all_refs",
    "closed": "response.body|eb|scrub response /all_refs",
    "all": "response.body|eb|scrub response &all_refs",
    "semi": "response.body|eb|scrub response *jumps,/actions,/reqs",
}

def cmd_get(cargs : _t.Any) -> None:
    if len(cargs.mexprs) == 0:
        cargs.mexprs = { stdout: [compile_expr(default_expr[cargs.default_expr])] }

    exp_path = _os.path.expanduser(cargs.path)
    rrexpr = rrexpr_wrr_loadf(exp_path)
    rrexpr.sniff = cargs.sniff

    for fobj, exprs in cargs.mexprs.items():
        print_exprs(rrexpr, exprs, cargs.separator, fobj)
        fobj.flush()

def cmd_run(cargs : _t.Any) -> None:
    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_expr[cargs.default_expr])]

    if cargs.num_args < 1:
        raise Failure(gettext("`run` sub-command requires at least one PATH"))
    elif cargs.num_args - 1 > len(cargs.args):
        raise Failure(gettext("not enough arguments to satisfy `--num-args`"))

    # move (num_args - 1) arguments from args to paths
    ntail = len(cargs.args) + 1 - cargs.num_args
    args = cargs.args[:ntail]
    cargs.paths = cargs.args[ntail:] + cargs.paths

    elaborate_paths(cargs.paths)

    tmp_paths = []
    try:
        for exp_path in cargs.paths:
            rrexpr = rrexpr_wrr_loadf(exp_path)
            rrexpr.sniff = cargs.sniff

            # TODO: extension guessing
            fileno, tmp_path = _tempfile.mkstemp(prefix = "hoardy_wrr_run_", suffix = ".tmp")
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

def cmd_stream(cargs : _t.Any) -> None:
    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_expr[cargs.default_expr])]

    compile_filters(cargs)
    handle_paths(cargs)

    stream = get_StreamEncoder(cargs)

    def emit(rrexpr : ReqresExpr[DeferredSourceType]) -> None:
        values : list[_t.Any] = []
        for expr, func in cargs.exprs:
            try:
                values.append(func(rrexpr, None))
            except CatastrophicFailure as exc:
                exc.elaborate(gettext("while evaluating `%s`"), expr)
                raise exc
        stream.emit(rrexpr.source.show_source(), cargs.exprs, values)

    stream.start()
    try:
        map_wrr_paths(cargs, emit, cargs.paths)
    finally:
        stream.finish()

def cmd_find(cargs : _t.Any) -> None:
    compile_filters(cargs)
    handle_paths(cargs)

    def emit(rrexpr : ReqresExpr[DeferredSourceType]) -> None:
        stdout.write(rrexpr.source.show_source())
        stdout.write_bytes(cargs.terminator)
        stdout.flush()

    map_wrr_paths(cargs, emit, cargs.paths)

example_url = [
    "https://example.org",
    "https://example.org/",
    "https://example.org/index.html",
    "https://example.org/media",
    "https://example.org/media/",
    "https://example.org/view?one=1&two=2&three=&three=3#fragment",
    "https://königsgäßchen.example.org/index.html",
    "https://ジャジェメント.ですの.example.org/испытание/is/",
    "https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/",
    "https://xn--hck7aa9d8fj9i.ですの.example.org/исп%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/",
]

def make_example(gen : _t.Callable[[str], str], indent : int) -> str:
    rev : dict[str, list[str]] = {}
    for url in example_url:
        current = gen(url)
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

atom_test = [
    "raw_url",
    "net_url",
    "pretty_url",
    "pretty_nurl",
]

def atom_example(name : str, indent : int) -> str:
    return make_example(lambda url: getattr(parse_url(url), name), indent)

output_alias = {
    "default":    "%(syear)d/%(smonth)02d/%(sday)02d/%(shour)02d%(sminute)02d%(ssecond)02d%(stime_msq)03d_%(qtime_ms)s_%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(hostname)s_%(num)d",
    "short":      "%(syear)d/%(smonth)02d/%(sday)02d/%(stime_ms)d_%(qtime_ms)s_%(num)d",

    "surl":       "%(scheme)s/%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s",
    "surl_msn":   "%(scheme)s/%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_%(num)d",

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

    "url":        "%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s",
    "url_msn":    "%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_%(num)d",

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

def output_example(name : str, indent : int) -> str:
    def gen(url : str) -> str:
        x = ReqresExpr(UnknownSource(), trivial_Reqres(parse_url(url)))
        x.items["num"] = 0
        return output_alias[name] % x
    return make_example(gen, indent)

def test_outputs_aliases() -> None:
    def mk(url : str) -> ReqresExpr[UnknownSource]:
        return ReqresExpr(UnknownSource(), trivial_Reqres(parse_url(url)))

    res = []
    prev = ""
    for name in output_alias:
        for url in example_url:
            x = mk(url)
            x.items["num"] = 0
            prefix = name + ":" + " " * (12 - len(name)) + " "
            current = output_alias[name] % x
            if prev != current:
                res.append(prefix + current)
            else:
                res.append(prefix + "==")
            prev = current

    pristine = """
default:      1970/01/01/001640000_0_GET_8198_C200C_example.org_0
default:      ==
default:      1970/01/01/001640000_0_GET_f0dc_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_086d_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_3fbb_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_5658_C200C_example.org_0
default:      1970/01/01/001640000_0_GET_4f11_C200C_königsgäßchen.example.org_0
default:      1970/01/01/001640000_0_GET_c4ae_C200C_ジャジェメント.ですの.example.org_0
default:      ==
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
shupnq_msn:   ==
shupnq_mhs:   https/example.org/index.GET_8198_C200C.htm
shupnq_mhs:   ==
shupnq_mhs:   https/example.org/index.GET_f0dc_C200C.html
shupnq_mhs:   https/example.org/media/index.GET_086d_C200C.htm
shupnq_mhs:   https/example.org/media/index.GET_3fbb_C200C.htm
shupnq_mhs:   https/example.org/view/index?one=1&two=2&three=3.GET_5658_C200C.htm
shupnq_mhs:   https/königsgäßchen.example.org/index.GET_4f11_C200C.html
shupnq_mhs:   https/ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C.htm
shupnq_mhs:   ==
shupnq_mhs:   ==
shupnq_mhsn:  https/example.org/index.GET_8198_C200C_0.htm
shupnq_mhsn:  ==
shupnq_mhsn:  https/example.org/index.GET_f0dc_C200C_0.html
shupnq_mhsn:  https/example.org/media/index.GET_086d_C200C_0.htm
shupnq_mhsn:  https/example.org/media/index.GET_3fbb_C200C_0.htm
shupnq_mhsn:  https/example.org/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm
shupnq_mhsn:  https/königsgäßchen.example.org/index.GET_4f11_C200C_0.html
shupnq_mhsn:  https/ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C_0.htm
shupnq_mhsn:  ==
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
srhupnq_msn:  ==
srhupnq_mhs:  https/org.example/index.GET_8198_C200C.htm
srhupnq_mhs:  ==
srhupnq_mhs:  https/org.example/index.GET_f0dc_C200C.html
srhupnq_mhs:  https/org.example/media/index.GET_086d_C200C.htm
srhupnq_mhs:  https/org.example/media/index.GET_3fbb_C200C.htm
srhupnq_mhs:  https/org.example/view/index?one=1&two=2&three=3.GET_5658_C200C.htm
srhupnq_mhs:  https/org.example.königsgäßchen/index.GET_4f11_C200C.html
srhupnq_mhs:  https/org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C.htm
srhupnq_mhs:  ==
srhupnq_mhs:  ==
srhupnq_mhsn: https/org.example/index.GET_8198_C200C_0.htm
srhupnq_mhsn: ==
srhupnq_mhsn: https/org.example/index.GET_f0dc_C200C_0.html
srhupnq_mhsn: https/org.example/media/index.GET_086d_C200C_0.htm
srhupnq_mhsn: https/org.example/media/index.GET_3fbb_C200C_0.htm
srhupnq_mhsn: https/org.example/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm
srhupnq_mhsn: https/org.example.königsgäßchen/index.GET_4f11_C200C_0.html
srhupnq_mhsn: https/org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C_0.htm
srhupnq_mhsn: ==
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
hupnq_msn:    ==
hupnq_mhs:    example.org/index.GET_8198_C200C.htm
hupnq_mhs:    ==
hupnq_mhs:    example.org/index.GET_f0dc_C200C.html
hupnq_mhs:    example.org/media/index.GET_086d_C200C.htm
hupnq_mhs:    example.org/media/index.GET_3fbb_C200C.htm
hupnq_mhs:    example.org/view/index?one=1&two=2&three=3.GET_5658_C200C.htm
hupnq_mhs:    königsgäßchen.example.org/index.GET_4f11_C200C.html
hupnq_mhs:    ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C.htm
hupnq_mhs:    ==
hupnq_mhs:    ==
hupnq_mhsn:   example.org/index.GET_8198_C200C_0.htm
hupnq_mhsn:   ==
hupnq_mhsn:   example.org/index.GET_f0dc_C200C_0.html
hupnq_mhsn:   example.org/media/index.GET_086d_C200C_0.htm
hupnq_mhsn:   example.org/media/index.GET_3fbb_C200C_0.htm
hupnq_mhsn:   example.org/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm
hupnq_mhsn:   königsgäßchen.example.org/index.GET_4f11_C200C_0.html
hupnq_mhsn:   ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C_0.htm
hupnq_mhsn:   ==
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
rhupnq_msn:   ==
rhupnq_mhs:   org.example/index.GET_8198_C200C.htm
rhupnq_mhs:   ==
rhupnq_mhs:   org.example/index.GET_f0dc_C200C.html
rhupnq_mhs:   org.example/media/index.GET_086d_C200C.htm
rhupnq_mhs:   org.example/media/index.GET_3fbb_C200C.htm
rhupnq_mhs:   org.example/view/index?one=1&two=2&three=3.GET_5658_C200C.htm
rhupnq_mhs:   org.example.königsgäßchen/index.GET_4f11_C200C.html
rhupnq_mhs:   org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C.htm
rhupnq_mhs:   ==
rhupnq_mhs:   ==
rhupnq_mhsn:  org.example/index.GET_8198_C200C_0.htm
rhupnq_mhsn:  ==
rhupnq_mhsn:  org.example/index.GET_f0dc_C200C_0.html
rhupnq_mhsn:  org.example/media/index.GET_086d_C200C_0.htm
rhupnq_mhsn:  org.example/media/index.GET_3fbb_C200C_0.htm
rhupnq_mhsn:  org.example/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm
rhupnq_mhsn:  org.example.königsgäßchen/index.GET_4f11_C200C_0.html
rhupnq_mhsn:  org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C_0.htm
rhupnq_mhsn:  ==
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
flat_msn:     ==
flat_mhs:     example.org/index.GET_8198_C200C.htm
flat_mhs:     ==
flat_mhs:     example.org/index.GET_f0dc_C200C.html
flat_mhs:     example.org/media__index.GET_086d_C200C.htm
flat_mhs:     example.org/media__index.GET_3fbb_C200C.htm
flat_mhs:     example.org/view__index?one=1&two=2&three=3.GET_5658_C200C.htm
flat_mhs:     königsgäßchen.example.org/index.GET_4f11_C200C.html
flat_mhs:     ジャジェメント.ですの.example.org/испытание__is__index.GET_c4ae_C200C.htm
flat_mhs:     ==
flat_mhs:     ==
flat_mhsn:    example.org/index.GET_8198_C200C_0.htm
flat_mhsn:    ==
flat_mhsn:    example.org/index.GET_f0dc_C200C_0.html
flat_mhsn:    example.org/media__index.GET_086d_C200C_0.htm
flat_mhsn:    example.org/media__index.GET_3fbb_C200C_0.htm
flat_mhsn:    example.org/view__index?one=1&two=2&three=3.GET_5658_C200C_0.htm
flat_mhsn:    königsgäßchen.example.org/index.GET_4f11_C200C_0.html
flat_mhsn:    ジャジェメント.ですの.example.org/испытание__is__index.GET_c4ae_C200C_0.htm
flat_mhsn:    ==
flat_mhsn:    ==
"""

    #print("\n" + "\n".join(res))

    pl = pristine.strip().split("\n")
    assert len(pl) == len(res)

    for i in range(0, len(res)):
        a = pl[i]
        b = res[i]
        if a != b:
            raise CatastrophicFailure("expected %s, got %s", a, b)

not_allowed = gettext("; this is not allowed to prevent accidental data loss")
variance_help = gettext("; your `--output` format fails to provide enough variance to solve this problem automatically (did your forget to place a `%%(num)d` substitution in there?)") + not_allowed

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

DeferredDestinationType = _t.TypeVar("DeferredDestinationType")
class DeferredOperation(_t.Generic[DeferredSourceType, DeferredDestinationType]):
    """A deferred `source` -> `destination` operation with updatable `source`.

       This exists to help you to eliminatate away repeated `os.rename`,
       `os.symlink`, etc calls to the same `destination` and to help
       implementing disk writes batching.
    """
    source : DeferredSourceType
    destination : DeferredDestinationType

    def __init__(self, source : DeferredSourceType, destination : DeferredDestinationType, overwrite : bool, allow_updates : bool) -> None:
        self.source = source
        self.destination = destination
        self.overwrite = overwrite
        self.allow_updates = allow_updates
        self.updated = False

    def approx_size(self) -> int:
        return 48 + self.source.approx_size()

    def switch_source(self, new_source : DeferredSourceType, force : bool = False) -> bool:
        """Switch source of this operation.

           Returns `True` if this change was permitted.
        """
        if not force:
            old_source = self.source
            if not new_source.replaces(old_source) or \
               new_source.same_as(old_source) or \
               new_source.get_bytes() == old_source.get_bytes():
                return True

        if not self.allow_updates:
            # updates are not allowed
            return False

        # update
        self.source = new_source
        self.updated = True
        return True

    def run(self, dsync : DeferredSync | None = None) -> None:
        """Write the `source` to `destination`."""
        raise NotImplementedError()

class DeferredFileWrite(DeferredOperation[DeferredSourceType, _t.AnyStr], _t.Generic[DeferredSourceType, _t.AnyStr]):
    def approx_size(self) -> int:
        return super().approx_size() + len(self.destination)

    def run(self, dsync : DeferredSync | None = None) -> None:
        data = self.source.get_bytes()
        if self.updated and file_content_equals(self.destination, data):
            # nothing to do
            return
        atomic_write(data, self.destination, self.overwrite or self.allow_updates, dsync = dsync)

def make_deferred_emit(cargs : _t.Any,
                       destination : _t.AnyStr,
                       action : str,
                       actioning : str,
                       defer : _t.Callable[[ReqresExpr[DeferredSourceType], _t.AnyStr, bool, bool],
                                           DeferredOperation[ReqresExpr[DeferredSourceType], _t.AnyStr]],
                       allow_updates : bool,
                       moving : bool = False,
                       symlinking : bool = False) \
        -> tuple[_t.Callable[[ReqresExpr[DeferredSourceType]], None],
                 _t.Callable[[], None]]:
    output_format = cargs.output_format + ".wrr"

    # current memory consumption
    mem = Memory()
    # for each `--output` value, how many times it was seen
    seen_counter : SeenCounter[_t.AnyStr] = SeenCounter(mem)

    # ReqresExpr cache indexed by destination path, this exists mainly
    # to minimize the number of calls to `stat`.
    rrexpr_cache : _c.OrderedDict[_t.AnyStr, ReqresExpr[DeferredSourceType]] = _c.OrderedDict()

    # Deferred IO operations (aka "intents") that are yet to be executed,
    # indexed by filesystem paths. This is used both as a queue and as an
    # LRU-cache so that, e.g. repeated updates to the same output file would be
    # computed in memory.
    deferred : _c.OrderedDict[_t.AnyStr, DeferredOperation[ReqresExpr[DeferredSourceType], _t.AnyStr]] = _c.OrderedDict()

    # Deferred file system updates. This collects references to everything
    # that should be fsynced to disk before proceeding to make flush_updates
    # below both atomic and efficient.
    dsync = DeferredSync()

    max_memory_mib = cargs.max_memory * 1024 * 1024
    def flush_updates(final : bool) -> None:
        """Flush some of the queue."""
        max_deferred : int = cargs.max_deferred if not final else 0
        max_memory : int = max_memory_mib if not final else 0
        max_seen : int = cargs.max_seen
        max_cached : int = cargs.max_cached
        max_batched : int = cargs.max_batched

        num_deferred = len(deferred)
        num_cached = len(rrexpr_cache)
        num_seen = len(seen_counter)
        if num_deferred <= max_deferred and \
           num_cached <= max_cached and \
           num_seen <= max_seen and \
           mem.consumption <= max_memory:
            return

        done_files : list[_t.AnyStr] | None = None
        if cargs.terminator is not None:
            done_files = []

        def run_intent(abs_out_path : _t.AnyStr, intent : DeferredOperation[ReqresExpr[DeferredSourceType], _t.AnyStr]) -> None:
            mem.consumption -= intent.approx_size() + len(abs_out_path)
            rrexpr = intent.source

            if not cargs.quiet:
                if cargs.dry_run:
                    ing = gettext(f"dry-run: (not) {actioning}")
                else:
                    ing = gettext(actioning)

                stderr.write_str(ing)
                stderr.write_str(": `")
                stderr.write(rrexpr.show_source())
                stderr.write_str("` -> `")
                stderr.write(abs_out_path)
                stderr.write_str_ln("`")
                stderr.flush()

            try:
                if not cargs.dry_run:
                    intent.run(dsync)
            except Failure as exc:
                if cargs.errors == "ignore":
                    return
                exc.elaborate(gettext(f"while {actioning} `%s` -> `%s`"),
                              rrexpr.show_source(),
                              fsdecode_maybe(abs_out_path))
                if cargs.errors != "fail":
                    _logging.error("%s", str(exc))
                    return
                # raise CatastrophicFailure so that load_map_orderly wouldn't try handling it
                raise CatastrophicFailure("%s", str(exc))

            if done_files is not None:
                done_files.append(abs_out_path)

            old_rrexpr = rrexpr_cache.pop(abs_out_path, None)
            if old_rrexpr is not None:
                mem.consumption -= old_rrexpr.approx_size() + len(abs_out_path)
            rrexpr_cache[abs_out_path] = rrexpr
            mem.consumption += rrexpr.approx_size() + len(abs_out_path)

        # flush seen cache
        while num_seen > 0 and \
              (num_seen > max_seen or mem.consumption > max_memory):
            abs_out_path, _ = seen_counter.pop()
            num_seen -= 1

            # if we are over the `--seen-number` not only we must forget
            # about older files, we must also run all operations on the paths
            # we are eliminating so that later deferredIO could pick up newly
            # created files and number them properly
            intent = deferred.pop(abs_out_path, None)
            if intent is None:
                continue
            run_intent(abs_out_path, intent)
            num_deferred -= 1

        if not final and \
           num_deferred <= max_deferred + max_batched and \
           mem.consumption <= max_memory:
            # we have enough resources to delay some more deferredIO, let's do
            # so, so that when we finally hit our resource limits, we would
            # execute max_batched or more deferred actions at once. this
            # improves IO performance by a lot
            max_deferred += max_batched

        # flush deferred
        while num_deferred > 0 and \
              (num_deferred > max_deferred or mem.consumption > max_memory):
            abs_out_path, intent = deferred.popitem(False)
            run_intent(abs_out_path, intent)
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

        # flush rrexpr_cache
        while num_cached > 0 and \
              (num_cached > max_cached or mem.consumption > max_memory):
            abs_out_path, source = rrexpr_cache.popitem(False)
            num_cached -= 1
            mem.consumption -= source.approx_size() + len(abs_out_path)

    def finish_updates() -> None:
        """Flush all of the queue."""
        flush_updates(True)
        assert mem.consumption == 0

    def load_defer(prev_rrexpr : ReqresExpr[DeferredSourceType] | None,
                   new_rrexpr : ReqresExpr[DeferredSourceType],
                   abs_out_path : _t.AnyStr) \
                   -> tuple[bool, ReqresExpr[DeferredSourceType] | None, DeferredOperation[ReqresExpr[DeferredSourceType], _t.AnyStr] | None]:
        if isinstance(new_rrexpr.source, FileSource) and new_rrexpr.source.path == abs_out_path:
            # hot evaluation path: moving, copying, hardlinking, symlinking, etc to itself
            # this is a noop
            return True, prev_rrexpr, None

        old_rrexpr : ReqresExpr[_t.Any]
        if prev_rrexpr is None:
            try:
                out_lstat = _os.lstat(abs_out_path)
            except FileNotFoundError:
                # target does not exists
                return True, new_rrexpr, defer(new_rrexpr, abs_out_path, False, allow_updates)
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
                        return True, new_rrexpr, defer(new_rrexpr, abs_out_path, True, allow_updates)
                    else:
                        if not allow_updates and not symlinking:
                            raise Failure("destination exists and is a symlink" + not_allowed)

                        # get symlink target and use it as abs_out_path, thus
                        # (SETSRC) below will re-create the original source
                        abs_out_path = _os.path.realpath(abs_out_path)
                elif not allow_updates and symlinking:
                    raise Failure("destination exists and is not a symlink" + not_allowed)
                else:
                    out_stat = out_lstat

            # (SETSRC)
            old_rrexpr = rrexpr_wrr_loadf(abs_out_path)
            old_rrexpr.sniff = cargs.sniff
        else:
            old_rrexpr = prev_rrexpr

        intent = defer(old_rrexpr, abs_out_path, False, allow_updates)
        permitted = intent.switch_source(new_rrexpr, moving)
        return permitted, intent.source, (intent if intent.source is not old_rrexpr else None)

    def emit(new_rrexpr : ReqresExpr[DeferredSourceType]) -> None:
        if want_stop: raise KeyboardInterrupt()

        new_rrexpr.items["num"] = 0
        def_out_path = output_format % new_rrexpr
        prev_rel_out_path = None
        while True:
            new_rrexpr.items["num"] = seen_counter.count(def_out_path)
            if isinstance(destination, str):
                rel_out_path = _os.path.join(destination, output_format % new_rrexpr)
            else:
                rel_out_path = _os.path.join(destination, _os.fsencode(output_format % new_rrexpr))
            abs_out_path : _t.AnyStr = _os.path.abspath(rel_out_path)

            old_rrexpr : ReqresExpr[DeferredSourceType] | None
            old_rrexpr = rrexpr_cache.pop(abs_out_path, None)
            if old_rrexpr is not None:
                mem.consumption -= old_rrexpr.approx_size() + len(abs_out_path)

            updated_rrexpr : ReqresExpr[DeferredSourceType] | None
            intent : DeferredOperation[ReqresExpr[DeferredSourceType], _t.AnyStr] | None
            intent = deferred.pop(abs_out_path, None)
            if intent is None:
                try:
                    permitted, updated_rrexpr, intent = load_defer(old_rrexpr, new_rrexpr, abs_out_path)
                except Failure as exc:
                    exc.elaborate(gettext(f"while {actioning} `%s` -> `%s`"),
                                  new_rrexpr.show_source(),
                                  fsdecode_maybe(abs_out_path))
                    raise exc

                if updated_rrexpr is not None:
                    updated_rrexpr.unload(True)
            else:
                mem.consumption -= intent.approx_size() + len(abs_out_path)
                permitted = intent.switch_source(new_rrexpr, moving)
                updated_rrexpr = intent.source

            del old_rrexpr

            if intent is not None:
                deferred[abs_out_path] = intent
                mem.consumption += intent.approx_size() + len(abs_out_path)

            if updated_rrexpr is not None:
                rrexpr_cache[abs_out_path] = updated_rrexpr
                mem.consumption += updated_rrexpr.approx_size() + len(abs_out_path)

            if not permitted:
                if prev_rel_out_path == rel_out_path:
                    exc2 = Failure(gettext("destination already exists") + variance_help)
                    exc2.elaborate(gettext(f"while {actioning} `%s` -> `%s`"),
                                   new_rrexpr.show_source(),
                                   fsdecode_maybe(abs_out_path))
                    raise exc2
                prev_rel_out_path = rel_out_path
                continue

            if intent is None:
                # noop
                if cargs.terminator is not None:
                    stdout.write(abs_out_path)
                    stdout.write_bytes(cargs.terminator)

            break

        if not cargs.lazy:
            flush_updates(False)

    return emit, finish_updates

def make_organize_emit(cargs : _t.Any, destination : _t.AnyStr, allow_updates : bool) \
        -> tuple[_t.Callable[[ReqresExpr[DeferredSourceType]], None],
                 _t.Callable[[], None]]:
    action_op : _t.Any
    action = cargs.action
    if allow_updates:
        actioning = "updating " + action
    else:
        actioning = action + "ing"
    moving = False
    copying = False
    symlinking = False
    check_data = True
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
        copying = True
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

    # becase we can't explicitly reuse the type variables bound by the whole function above
    DeferredSourceType2 = _t.TypeVar("DeferredSourceType2", bound=DeferredSource)
    AnyStr2 = _t.TypeVar("AnyStr2", str, bytes)

    class DeferredOrganize(DeferredFileWrite[ReqresExpr[DeferredSourceType2], AnyStr2], _t.Generic[DeferredSourceType2, AnyStr2]):
        def switch_source(self, new_rrexpr : ReqresExpr[DeferredSourceType2], force : bool = False) -> bool:
            old_rrexpr = self.source
            old_source = old_rrexpr.source
            new_source = new_rrexpr.source

            if not force:
                if not new_source.replaces(old_source) or \
                   new_source.same_as(old_source) or \
                   check_data and new_rrexpr.get_bytes() == old_rrexpr.get_bytes():
                    # noop
                    return True

            if not self.allow_updates:
                # updates are not allowed
                return False

            if old_rrexpr.stime > new_rrexpr.stime:
                # ours is newer
                return True

            # update
            self.source = new_rrexpr
            self.updated = True
            return True

        def run(self, dsync : DeferredSync | None = None) -> None:
            rrexpr = self.source
            source = rrexpr.source
            if isinstance(source, FileSource):
                # ensure we are not generating noops in load_defer
                assert source.path != self.destination

            try:
                dirname = _os.path.dirname(self.destination)
                _os.makedirs(dirname, exist_ok = True)
            except OSError as exc:
                handle_ENAMETOOLONG(exc, dirname)
                raise exc

            try:
                if isinstance(source, FileSource):
                    action_op(source.path, self.destination, self.overwrite or self.allow_updates, dsync = dsync)
                elif copying:
                    # fallback to DeferredFileWrite in this case
                    super().run(dsync)
                else:
                    raise Failure(gettext(f"can't {action} the source to the destination because the source is not stored as a separate WRR file; did you mean to run with `--copy` intead of `--{action}`?"))
            except FileExistsError:
                raise Failure(gettext(f"`%s` already exists"), self.destination)
            except OSError as exc:
                handle_ENAMETOOLONG(exc, self.destination)
                if exc.errno == _errno.EXDEV:
                    raise Failure(gettext(f"can't {action} across file systems"))
                raise exc

    return make_deferred_emit(cargs, destination, action, actioning, DeferredOrganize, allow_updates, moving, symlinking)

def cmd_organize(cargs : _t.Any) -> None:
    if cargs.walk_paths == "unset":
        cargs.walk_paths = None if not cargs.allow_updates else False
    if cargs.walk_fs == "unset":
        cargs.walk_fs = True if not cargs.allow_updates else False

    compile_filters(cargs)
    elaborate_output(cargs)
    handle_paths(cargs)

    emit : EmitFunc[ReqresExpr[FileSource]]
    if cargs.destination is not None:
        # destination is set explicitly
        emit, finish = make_organize_emit(cargs, _os.path.expanduser(cargs.destination), cargs.allow_updates)
        try:
            map_wrr_paths_extra(cargs, rrexpr_wrr_loadf, emit, cargs.paths) # type: ignore # type inference fail
        finally:
            finish()
    else:
        if cargs.allow_updates:
            raise Failure(gettext("`--latest` without `--to` is not allowed"))

        # each path is its own destination
        for exp_path in cargs.paths:
            try:
                path_stat = _os.stat(exp_path)
            except FileNotFoundError:
                raise Failure(gettext("`%s` does not exist"), exp_path)

            if not _stat.S_ISDIR(path_stat.st_mode):
                raise Failure(gettext("`%s` is not a directory but no `--to` is specified"), exp_path)

        for exp_path in cargs.paths:
            emit, finish = make_organize_emit(cargs, exp_path, False)
            try:
                map_wrr_paths_extra(cargs, rrexpr_wrr_loadf, emit, [exp_path]) # type: ignore # type inference fail
            finally:
                finish()

def cmd_import_generic(cargs : _t.Any,
                       rrexprs_loadf : _t.Callable[[str | bytes], _t.Iterator[ReqresExpr[DeferredSourceType]]]) -> None:
    compile_filters(cargs)
    elaborate_output(cargs)
    handle_paths(cargs)

    emit : EmitFunc[ReqresExpr[DeferredSourceType]]
    emit, finish = make_deferred_emit(cargs, cargs.destination, "import", "importing", DeferredFileWrite, cargs.allow_updates)

    def emit_many(rrexprs : _t.Iterator[ReqresExpr[DeferredSourceType]]) -> None:
        for rrexpr in rrexprs:
            if want_stop: raise KeyboardInterrupt()

            rrexpr.sniff = cargs.sniff
            if not filters_allow(cargs, rrexpr): return

            emit(rrexpr)

    global should_raise
    should_raise = False
    try:
        for exp_path in cargs.paths:
            load_map_orderly(rrexprs_loadf, emit_many, exp_path, ordering=cargs.walk_fs, errors=cargs.errors)
    finally:
        finish()

def cmd_import_bundle(cargs : _t.Any) -> None:
    cmd_import_generic(cargs, rrexprs_wrr_bundle_loadf)

def cmd_import_mitmproxy(cargs : _t.Any) -> None:
    from .mitmproxy import rrexprs_mitmproxy_loadf
    cmd_import_generic(cargs, rrexprs_mitmproxy_loadf)

def path_to_url(x : str) -> str:
    return x.replace("?", "%3F")

def cmd_export_mirror(cargs : _t.Any) -> None:
    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_expr[cargs.default_expr])]

    compile_filters(cargs)
    elaborate_output(cargs)
    handle_paths(cargs)
    elaborate_paths(cargs.boring)

    destination = _os.path.expanduser(cargs.destination)
    output_format = cargs.output_format
    max_depth : int = cargs.depth
    sniff = cargs.sniff
    allow_updates = cargs.allow_updates == True
    skip_existing = cargs.allow_updates == "partial"

    mem = Memory()
    seen_counter : SeenCounter[str] = SeenCounter(mem)

    max_memory_mib = cargs.max_memory * 1024 * 1024

    @_dc.dataclass
    class Indexed:
        rrexpr : ReqresExpr[_t.Any]
        _abs_out_path : str | None = _dc.field(default = None)

        def __post_init__(self) -> None:
            mem.consumption += 24 + self.rrexpr.approx_size()

        def __del__(self) -> None:
            mem.consumption -= 24 + self.rrexpr.approx_size() + \
                (len(self._abs_out_path) if self._abs_out_path is not None else 0)

        @property
        def abs_out_path(self) -> str:
            abs_out_path = self._abs_out_path
            if abs_out_path is not None:
                return abs_out_path

            rrexpr = self.rrexpr
            rrexpr.items["num"] = 0
            def_out_path = output_format % rrexpr
            rrexpr.items["num"] = seen_counter.count(def_out_path)
            rel_out_path = _os.path.join(destination, output_format % rrexpr)
            self._abs_out_path = abs_out_path = _os.path.abspath(rel_out_path)
            mem.consumption += len(abs_out_path)
            return abs_out_path

        def unload(self) -> None:
            rrexpr = self.rrexpr
            mem.consumption -= rrexpr.approx_size()
            rrexpr.unload()
            mem.consumption += rrexpr.approx_size()

    net_url_t : _t.TypeAlias = str
    path_t : _t.TypeAlias = str

    # `Indexed` objects migrate from disk to `index`, from `index` to `queue`
    # or `new_queue`, from `new_queue` to `queue`, and from `queue` to `done`.
    index : dict[net_url_t, Indexed] = dict()
    Queue = _c.OrderedDict[net_url_t, Indexed]
    queue : Queue = _c.OrderedDict()
    done : dict[net_url_t, path_t] = dict()

    @_dc.dataclass
    class N:
        n : int
    root_url : dict[str, N] = {}
    root_url_prefix : dict[str, N] = {}
    @_dc.dataclass
    class CN:
        cre : _re.Pattern[_t.Any]
        n : int
    root_url_re : dict[str, CN] = {}

    for url in cargs.root_url:
        net_url = parse_url(url).net_url
        root_url[net_url] = N(0)

    for url_prefix in cargs.root_url_prefix:
        net_url = parse_url(url_prefix).net_url
        root_url_prefix[net_url] = N(0)

    for url_re in cargs.root_url_re:
        cre = _re.compile(url_re)
        root_url_re[url_re] = CN(cre, 0)

    have_root_url = len(root_url) > 0
    have_root_url_prefix = len(root_url_prefix) > 0
    have_root_url_re = len(root_url_re) > 0

    def report_queued(net_url : str, pretty_net_url : str, level : int) -> None:
        if stdout.isatty:
            stdout.write_bytes(b"\033[33m")
        durl = net_url if pretty_net_url == net_url else f"{net_url} ({pretty_net_url})"
        ispace = " " * (2 * level)
        stdout.write_str_ln(ispace + gettext(f"queued %s") % (durl,))
        if stdout.isatty:
            stdout.write_bytes(b"\033[0m")
        stdout.flush()

    def collect(enqueue_all : bool) -> EmitFunc[ReqresExpr[DeferredSourceType]]:
        def emit(rrexpr : ReqresExpr[DeferredSourceType]) -> None:
            reqres = rrexpr.reqres
            response = reqres.response
            if reqres.request.method != "GET" or \
               response is None or \
               response.code != 200:
                return

            net_url = rrexpr.net_url
            iobj = index.get(net_url, None)

            if iobj is not None and iobj.rrexpr.stime > rrexpr.stime:
                # the indexed one is newer
                return

            index[net_url] = iobj = Indexed(rrexpr)

            if net_url in queue:
                queue[net_url] = iobj
            else:
                enqueue = enqueue_all
                pretty_net_url : str | None = None

                if not enqueue and have_root_url:
                    vu = root_url.get(net_url, None)
                    if vu is not None:
                        vu.n += 1
                        enqueue = True

                if not enqueue and have_root_url_prefix:
                    for pref, vp in root_url_prefix.items():
                        if not net_url.startswith(pref):
                            continue
                        vp.n += 1
                        enqueue = True
                        break

                if not enqueue and have_root_url_re:
                    pretty_net_url = rrexpr.pretty_net_url
                    for re, vr in root_url_re.items():
                        if not vr.cre.match(net_url) and not vr.cre.match(pretty_net_url):
                            continue
                        vr.n += 1
                        enqueue = True
                        break

                if enqueue:
                    queue[net_url] = iobj
                    report_queued(net_url, rrexpr.pretty_net_url if pretty_net_url is None else pretty_net_url, 1)

            if mem.consumption > max_memory_mib:
                iobj.unload()
        return emit

    if stdout.isatty:
        stdout.write_bytes(b"\033[32m")
    stdout.write_str_ln(gettext("loading input `PATH`s..."))
    if stdout.isatty:
        stdout.write_bytes(b"\033[0m")
    stdout.flush()

    queue_all = not have_root_url and not have_root_url_prefix and not have_root_url_re

    seen_paths : set[str] = set()
    map_wrr_paths(cargs, collect(queue_all), cargs.paths, seen_paths=seen_paths)
    map_wrr_paths(cargs, collect(False), cargs.boring, seen_paths=seen_paths)

    for url, vu in root_url.items():
        if vu.n == 0:
            issue(gettext("`--root-url` `%s` was not found among candidates loaded from given input `PATH`s"), url)

    for pref, vp in root_url_prefix.items():
        if vp.n == 0:
            issue(gettext("`--root-url-prefix` `%s` matched nothing among candidates loaded from given input `PATH`s"), url_prefix)

    for re, vr in root_url_re.items():
        if vr.n == 0:
            issue(gettext("`--root-url-re` `%s` matched nothing among candidates loaded from given input `PATH`s"), url_re)

    total = len(index)
    depth : int = 0

    class Stats:
        n = 0
        doc_n = 0

    def remap_url_fallback(stime : Epoch, expected_content_types : list[str], purl : ParsedURL) -> str:
        trrexpr = ReqresExpr(UnknownSource(), fallback_Reqres(purl, expected_content_types, stime, stime, stime))
        trrexpr.items["num"] = 0
        rel_out_path : str = _os.path.join(destination, output_format % trrexpr)
        return _os.path.abspath(rel_out_path)

    def render(net_url : str,
               iobj : Indexed,
               enqueue : bool,
               new_queue : Queue,
               level : int) -> None:
        try:
            del index[net_url]
        except KeyError:
            pass

        level0 = level == 0
        Stats.n += 1
        if level0:
            Stats.doc_n += 1

        rrexpr = iobj.rrexpr
        abs_out_path = iobj.abs_out_path
        source = rrexpr.source
        stime = rrexpr.stime
        done[net_url] = abs_out_path
        mem.consumption += 16 + len(abs_out_path)

        try:
            n = Stats.n
            doc_n = Stats.doc_n
            n100 = 100 * n
            n_total = n + len(new_queue) + len(queue)

            if stdout.isatty:
                if level0:
                    stdout.write_bytes(b"\033[32m")
                else:
                    stdout.write_bytes(b"\033[34m")
            ispace = " " * (2 * level)
            if level0:
                stdout.write_str_ln(gettext(f"exporting input #%d, %.2f%% of %d queued (%.2f%% of %d indexed), document #%d, depth %d") % (n, n100 / n_total, n_total, n100 / total, total, doc_n, depth))
            else:
                stdout.write_str_ln(ispace + gettext(f"exporting requisite input #%d, %.2f%% of %d queued (%.2f%% of %d indexed)") % (n, n100 / n_total, n_total, n100 / total, total))
            stdout.write_str_ln(ispace + gettext("URL %s") % (net_url,))
            if stdout.isatty:
                stdout.write_bytes(b"\033[0m")
            stdout.write_str_ln(ispace + gettext("src %s") % (source.show_source(),))
            stdout.write_str_ln(ispace + gettext("dst %s") % (abs_out_path,))
            stdout.flush()

            exists = _os.path.exists(abs_out_path)
            if skip_existing and exists:
                if stdout.isatty:
                    stdout.write_bytes(b"\033[33m")
                stdout.write_str_ln(gettext("destination exists, skipped!"))
                if stdout.isatty:
                    stdout.write_bytes(b"\033[0m")
                stdout.flush()
                return

            document_dir = _os.path.dirname(abs_out_path)
            known : set[str] = set() # for a better UI

            def remap_url(link_type : LinkType, fallbacks : list[str] | None, url : str) -> str | None:
                if want_stop: raise KeyboardInterrupt()

                try:
                    purl = parse_url(url)
                except URLParsingError:
                    ispace = " " * (2 * (level + 1))
                    issue(ispace + gettext("malformed URL `%s`"), url)
                    return get_void_url(link_type)

                unet_url = purl.net_url

                if purl.scheme not in Reqres_url_schemes:
                    if unet_url not in known:
                        ispace = " " * (2 * (level + 1))
                        issue(ispace + gettext("not remapping `%s`"), url)
                        known.add(unet_url)
                    return url

                try:
                    uabs_out_path = done[unet_url]
                except KeyError:
                    uobj = index.get(unet_url, None)
                    if uobj is None:
                        # unavailable, use fallback
                        uabs_out_path = None
                    else:
                        uabs_out_path = uobj.abs_out_path
                        if link_type == LinkType.REQ:
                            # this is a requisite
                            # unqueue it
                            try:
                                del new_queue[unet_url]
                            except KeyError: pass
                            try:
                                del queue[unet_url]
                            except KeyError: pass
                            # render it immediately
                            render(unet_url, uobj, enqueue, new_queue, level + 1)
                        elif unet_url in new_queue or unet_url in queue:
                            # nothing to do
                            pass
                        elif enqueue:
                            new_queue[unet_url] = uobj
                            report_queued(unet_url, purl.pretty_net_url, level + 1)
                        else:
                            # this will not be exported
                            uabs_out_path = None
                            # NB: Not setting `done[unet_url]` here because it
                            # might be a requisite for another page. In which
                            # case this page will void this `unet_url`
                            # unnecessarily, yes.

                        if mem.consumption > max_memory_mib:
                            uobj.unload()

                if uabs_out_path is None:
                    if fallbacks is not None:
                        uabs_out_path = remap_url_fallback(stime, fallbacks, purl)
                    else:
                        return None

                if uabs_out_path != abs_out_path or len(purl.ofm) == 0:
                    urel_url = path_to_url(_os.path.relpath(uabs_out_path, document_dir))
                else:
                    # this is a reference to an inter-page `id`
                    urel_url = ""

                return urel_url + purl.ofm + purl.fragment

            assert rrexpr is not None
            rrexpr.remap_url = remap_url

            data : bytes
            with TIOWrappedWriter(_io.BytesIO()) as f:
                print_exprs(rrexpr, cargs.exprs, cargs.separator, f)
                data = f.fobj.getvalue()

            if exists and file_content_equals(abs_out_path, data):
                # this is a noop overwrite, skip it
                return

            atomic_write(data, abs_out_path, allow_updates)
        except Failure as exc:
            if cargs.errors == "ignore":
                return
            exc.elaborate(gettext(f"while processing `%s`"), source.show_source())
            if cargs.errors != "fail":
                _logging.error("%s", str(exc))
                return
            raise CatastrophicFailure("%s", str(exc))
        except Exception:
            error(gettext("while processing `%s`"), source.show_source())
            raise

    while len(queue) > 0:
        if want_stop: raise KeyboardInterrupt()

        new_queue : Queue = _c.OrderedDict()
        enqueue = depth < max_depth

        while len(queue) > 0:
            if want_stop: raise KeyboardInterrupt()

            net_url, iobj = queue.popitem(False)
            render(net_url, iobj, enqueue, new_queue, 0)

        queue = new_queue
        depth += 1

def add_doc(fmt : argparse.BetterHelpFormatter) -> None:
    _ : _t.Callable[[str], str] = gettext

    fmt.add_text(_("# Examples"))

    fmt.start_section(_("Pretty-print all reqres in `../simple_server/pwebarc-dump` using an abridged (for ease of reading and rendering) verbose textual representation"))
    fmt.add_code(f"{__prog__} pprint ../simple_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Pipe raw response body from a given `WRR` file to stdout"))
    fmt.add_code(f'{__prog__} get ../simple_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_(f"Pipe response body scrubbed of dynamic content from a given `WRR` file to stdout"))
    fmt.add_code(f'{__prog__} get -e "response.body|eb|scrub response defaults" ../simple_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_("Get first 4 characters of a hex digest of sha256 hash computed on the URL without the fragment/hash part"))
    fmt.add_code(f'{__prog__} get -e "net_url|to_ascii|sha256|take_prefix 4" ../simple_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_("Pipe response body from a given `WRR` file to stdout, but less efficiently, by generating a temporary file and giving it to `cat`"))
    fmt.add_code(f"{__prog__} run cat ../simple_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_text(_(f"Thus `{__prog__} run` can be used to do almost anything you want, e.g."))
    fmt.add_code(f"{__prog__} run less ../simple_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_code(f"{__prog__} run -- sort -R ../simple_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_code(f"{__prog__} run -n 2 -- diff -u ../simple_server/pwebarc-dump/path/to/file-v1.wrr ../simple_server/pwebarc-dump/path/to/file-v2.wrr")
    fmt.end_section()

    fmt.start_section(_(f"List paths of all `WRR` files from `../simple_server/pwebarc-dump` that contain only complete `200 OK` responses with bodies larger than 1K"))
    fmt.add_code(f"""{__prog__} find --and "status|~= .200C" --and "response.body|len|> 1024" ../simple_server/pwebarc-dump""")
    fmt.end_section()

    fmt.start_section(_(f"Rename all `WRR` files in `../simple_server/pwebarc-dump/default` according to their metadata using `--output default` (see the `{__prog__} organize` section for its definition, the `default` format is designed to be human-readable while causing almost no collisions, thus making `num` substitution parameter to almost always stay equal to `0`, making things nice and deterministic)"))
    fmt.add_code(f"{__prog__} organize ../simple_server/pwebarc-dump/default")
    fmt.add_text(_("alternatively, just show what would be done"))
    fmt.add_code(f"{__prog__} organize --dry-run ../simple_server/pwebarc-dump/default")
    fmt.end_section()

    fmt.add_text(_("# Advanced examples"))

    fmt.start_section(_("Pretty-print all reqres in `../simple_server/pwebarc-dump` by dumping their whole structure into an abridged Pythonic Object Representation (repr)"))
    fmt.add_code(f"{__prog__} stream --expr . ../simple_server/pwebarc-dump")
    fmt.add_code(f"{__prog__} stream -e . ../simple_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Pretty-print all reqres in `../simple_server/pwebarc-dump` using the unabridged verbose textual representation"))
    fmt.add_code(f"{__prog__} pprint --unabridged ../simple_server/pwebarc-dump")
    fmt.add_code(f"{__prog__} pprint -u ../simple_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Pretty-print all reqres in `../simple_server/pwebarc-dump` by dumping their whole structure into the unabridged Pythonic Object Representation (repr) format"))
    fmt.add_code(f"{__prog__} stream --unabridged --expr . ../simple_server/pwebarc-dump")
    fmt.add_code(f"{__prog__} stream -ue . ../simple_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Produce a `JSON` list of `[<file path>, <time it finished loading in seconds since UNIX epoch>, <URL>]` tuples (one per reqres) and pipe it into `jq` for indented and colored output"))
    fmt.add_code(f"{__prog__} stream --format=json -ue fs_path -e finished_at -e request.url ../simple_server/pwebarc-dump | jq .")
    fmt.end_section()

    fmt.start_section(_("Similarly, but produce a `CBOR` output"))
    fmt.add_code(f"{__prog__} stream --format=cbor -ue fs_path -e finished_at -e request.url ../simple_server/pwebarc-dump | less")
    fmt.end_section()

    fmt.start_section(_("Concatenate all response bodies of all the requests in `../simple_server/pwebarc-dump`"))
    fmt.add_code(f'{__prog__} stream --format=raw --not-terminated -ue "response.body|eb" ../simple_server/pwebarc-dump | less')
    fmt.end_section()

    fmt.start_section(_("Print all unique visited URLs, one per line"))
    fmt.add_code(f"{__prog__} stream --format=raw --lf-terminated -ue request.url ../simple_server/pwebarc-dump | sort | uniq")
    fmt.end_section()

    fmt.start_section(_("Same idea, but using NUL bytes, with some post-processing, and two URLs per line"))
    fmt.add_code(f"{__prog__} stream --format=raw --zero-terminated -ue request.url ../simple_server/pwebarc-dump | sort -z | uniq -z | xargs -0 -n2 echo")
    fmt.end_section()

    fmt.add_text(_("## How to handle binary data"))

    fmt.add_text(_(f"Trying to use response bodies produced by `{__prog__} stream --format=json` is likely to result garbled data as `JSON` can't represent raw sequences of bytes, thus binary data will have to be encoded into UNICODE using replacement characters:"))
    fmt.add_code(f"{__prog__} stream --format=json -ue . ../simple_server/pwebarc-dump/path/to/file.wrr | jq .")
    fmt.add_text(_("The most generic solution to this is to use `--format=cbor` instead, which would produce a verbose `CBOR` representation equivalent to the one used by `--format=json` but with binary data preserved as-is:"))
    fmt.add_code(f"{__prog__} stream --format=cbor -ue . ../simple_server/pwebarc-dump/path/to/file.wrr | less")
    fmt.add_text(_("Or you could just dump raw response bodies separately:"))
    fmt.add_code(f"{__prog__} stream --format=raw -ue response.body ../simple_server/pwebarc-dump/path/to/file.wrr | less")
    fmt.add_code(f"{__prog__} get ../simple_server/pwebarc-dump/path/to/file.wrr | less")

class ArgumentParser(argparse.BetterArgumentParser):
    def error(self, message : str) -> _t.NoReturn:
        self.print_usage(_sys.stderr)
        die(2, "%s", message)

def main() -> None:
    _ : _t.Callable[[str], str] = gettext

    parser = ArgumentParser(
        prog=__prog__,
        description=_("A tool to display, search, programmatically extract values from, organize, manipulate, import, and export Web Request+Response (`WRR`) archive files produced by the `Hoardy-Web` Web Extension browser add-on.") + "\n\n" +
_("Terminology: a `reqres` (`Reqres` when a Python type) is an instance of a structure representing `HTTP` request+response pair with some additional metadata."),
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
        grp = cmd.add_argument_group(f"filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `{__prog__} get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s")
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

    def add_sniff(cmd : _t.Any, kind : str) -> None:
        oscrub = "this influeences generated file names because `filepath_parts` and `filepath_ext` depend on both the original file extension present in the URL and the detected `MIME` type of its content"
        wscrub = "higher values make the `scrub` function (which see) censor out more things when `-unknown`, `-styles`, or `-scripts` options are set; in particular, at the moment, with `--sniff-paranoid` and `-scripts` most plain text files will be censored out as potential `JavaScript`"
        if kind == "pprint":
            what = "this simply populates the `potentially` lists in the output in various ways"
        elif kind == "organize" or kind == "import":
            what = oscrub
        elif kind != "export":
            what = wscrub
        else:
            what = f"{oscrub}; also, {wscrub}"

        agrp = cmd.add_argument_group(_("`MIME` type sniffing; this controls the use of [the `mimesniff` algorithm](https://mimesniff.spec.whatwg.org/); for this sub-command " + what))
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--sniff-default", dest="sniff", action="store_const", const=SniffContentType.NONE, help=_("run `mimesniff` when the spec says it should be run; i.e. trust `Content-Type` `HTTP` headers most of the time; default"))
        grp.add_argument("--sniff-force", dest="sniff", action="store_const", const=SniffContentType.FORCE, help=_("run `mimesniff` regardless of what `Content-Type`  and `X-Content-Type-Options` `HTTP` headers say; i.e. for each reqres, run `mimesniff` algorithm on the `Content-Type` `HTTP` header and the actual contents of `(request|response).body` (depending on the first argument of `scrub`) to determine what the body actually contains, then interpret the data as intersection of what `Content-Type` and `mimesniff` claim it to be; e.g. if `Content-Type` says `text/plain` but `mimesniff` says `text/plain or text/javascript`, interpret it as `text/plain`"))
        grp.add_argument("--sniff-paranoid", dest="sniff", action="store_const", const=SniffContentType.PARANOID, help=_(f"do what `--sniff-force` does, but interpret the results in the most paranoid way possible; e.g. if `Content-Type` says `text/plain` but `mimesniff` says `text/plain or text/javascript`, interpret it as `text/plain or text/javascript`; which, for instance, will then make `scrub` with `-scripts` censor it out, since it can be interpreted as a script"))
        grp.set_defaults(sniff = SniffContentType.NONE)

    # pprint
    cmd = subparsers.add_parser("pprint", help=_("pretty-print given `WRR` files"),
                                description = _("""Pretty-print given `WRR` files to stdout."""))
    add_pure(cmd, "print")
    add_abridged(cmd)
    add_sniff(cmd, "pprint")
    add_paths(cmd)
    cmd.set_defaults(func=cmd_pprint)

    class AddExpr(argparse.Action):
        def __call__(self, parser : _t.Any, cfg : argparse.Namespace, value : _t.Any, option_string : _t.Optional[str] = None) -> None:
            cfg.exprs.append(compile_expr(value))

    fd_fileobj = {0: stdin, 1: stdout, 2: stderr}

    class AddExprFd(argparse.Action):
        def __call__(self, parser : _t.Any, cfg : argparse.Namespace, value : _t.Any, option_string : _t.Optional[str] = None) -> None:
            fileno = cfg.expr_fd
            try:
                fobj = fd_fileobj[fileno]
            except KeyError:
                fobj = TIOWrappedWriter(_os.fdopen(fileno, "wb"))
                fd_fileobj[fileno] = fobj

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

            def_expr = f"`{default_expr[kind]}`, which will dump the `HTTP` response body"
            agrp.add_argument("-e", "--expr", dest="mexprs", metavar="EXPR", action=AddExprFd, type=str, default = {}, help=_(f'an expression to compute; can be specified multiple times in which case computed outputs will be printed sequentially; see also "printing" options below') + \
                "; " + \
                _("the default depends on `--remap-*` options, without any them set it is %s") % (def_expr,) + "; " + \
                _("each `EXPR` describes a state-transformer (pipeline) which starts from value `None` and evaluates a script built from the following") + ":\n" + \
                "- " + _("constants and functions:") + "\n" + \
                "".join([f"  - `{name}`: {__(value[0])}\n" for name, value in ReqresExpr_atoms.items()]) + \
                "- " + _("reqres fields, these work the same way as constants above, i.e. they replace current value of `None` with field's value, if reqres is missing the field in question, which could happen for `response*` fields, the result is `None`:") + "\n" + \
                "".join([f"  - `{name}`: {__(value)}\n" for name, value in Reqres_fields.items()]) + \
                "- " + _("derived attributes:") + "\n" + \
                "".join([f"  - `{name}`: {__(value)}\n" for name, value in ReqresExpr_derived_attrs.items()]) + \
                "- " + _("a compound expression built by piping (`|`) the above, for example") + __(f""":
- `{default_expr["get"]}` (the default for `get` and `run`) will print raw `response.body` or an empty byte string, if there was no response;
- `{default_expr["get"]}|scrub response defaults` will take the above value, `scrub` it using default content scrubbing settings which will censor out all actions and references to page requisites;
- `response.complete` will print the value of `response.complete` or `None`, if there was no response;
- `response.complete|false` will print `response.complete` or `False`;
- `net_url|to_ascii|sha256` will print `sha256` hash of the URL that was actually sent over the network;
- `net_url|to_ascii|sha256|take_prefix 4` will print the first 4 characters of the above;
- `path_parts|take_prefix 3|pp_to_path` will print first 3 path components of the URL, minimally quoted to be used as a path;
- `query_ne_parts|take_prefix 3|qsl_to_path|abbrev 128` will print first 3 non-empty query parameters of the URL, abbreviated to 128 characters or less, minimally quoted to be used as a path;""", 2) + \
                "\n\nExample URL mappings:\n" + \
                "".join([f"  - `{name}`:\n" + atom_example(name, 4) + "\n" for name in atom_test])
            )
        else:
            if kind == "run":
                def_expr = f"`{default_expr[kind]}`, which will simply dump the `HTTP` response body"
            elif kind == "stream":
                def_expr = f"`{default_expr[kind]}`, which will simply dump the whole reqres structure"
            elif kind == "export":
                def_expr = f"`{default_expr['all']}`, which will export `scrub`bed versions of all files with all links and references remapped using fallback `--output` paths"
            else:
                assert False

            agrp.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action=AddExpr, type=str, default = [], help=_(f"an expression to compute, same expression format and semantics as `{__prog__} get --expr` (which see); can be specified multiple times") + \
                              "; " + \
                              _("the default depends on `--remap-*` options, without any them set it is %s") % (def_expr,))

        def alias(what : str) -> str:
            return _("set the default value for `--expr` to `%s`") % (default_expr[what],)

        agrp = cmd.add_argument_group("the default value of `--expr`")
        grp = agrp.add_mutually_exclusive_group()

        if kind != "export":
            grp.add_argument("--no-remap", dest="default_expr", action="store_const", const=kind, help=_("do not touch the default value of `--expr`, use the default value shown above; default"))

        grp.add_argument("--remap-id", dest="default_expr", action="store_const", const="id", help=alias("id") + _("; i.e. remap all URLs with an identity function; i.e. don't remap anything; results will NOT be self-contained"))
        grp.add_argument("--remap-void", dest="default_expr", action="store_const", const="void", help=alias("void") + _("; i.e. remap all URLs into `javascript:void(0)` and empty `data:` URLs; results will be self-contained"))

        if kind != "export":
            cmd.set_defaults(default_expr = kind)
        else:
            grp.add_argument("--remap-open", "-k", "--convert-links", dest="default_expr", action="store_const", const="open", help=alias("open") + _("; i.e. remap all URLs present in input `PATH`s and reachable from `--root-*`s in no more that `--depth` steps to their corresponding `--output` paths, remap all other URLs like `--remap-id` does; results almost certainly will NOT be self-contained"))
            grp.add_argument("--remap-closed", dest="default_expr", action="store_const", const="open", help=alias("closed") + _("; i.e. remap all URLs present in input `PATH`s and reachable from `--root-*`s in no more that `--depth` steps to their corresponding `--output` paths, remap all other URLs like `--remap-void` does; results will be self-contained"))
            grp.add_argument("--remap-semi", dest="default_expr", action="store_const", const="semi", help=alias("semi") + _("; i.e. remap all jump links like `--remap-open` does, remap action links and references to page requisites like `--remap-closed` does; this is a better version of `--remap-open` which keeps the `export`ed `mirror`s self-contained with respect to page requisites, i.e. generated pages can be opened in a web browser without it trying to access the Internet, but all navigations to missing and unreachable URLs will still point to the original URLs; results will be semi-self-contained"))
            grp.add_argument("--remap-all", dest="default_expr", action="store_const", const="all", help=alias("all") + _(f"""; i.e. remap all links and references like `--remap-closed` does, except, instead of voiding missing and unreachable URLs, replace them with fallback URLs whenever possble; results will be self-contained; default

`{__prog__} export mirror` uses `--output` paths of trivial `GET <URL> -> 200 OK` as fallbacks for `&(jumps|actions|reqs)` options of `scrub`.
This will remap links pointing to missing and unreachable URLs to missing files.
However, for simple `--output` formats (like the default `hupq`), those files can later be generated by running `{__prog__} export mirror` with `WRR` files containing those missing or unreachable URLs as inputs.
I.e. this behaviour allows you to add new data to an already `export`ed mirror without regenerating old files that reference newly added URLs.
I.e. this allows `{__prog__} export mirror` to be used incrementally.

Note however, that using fallbacks when the `--output` format depends on anything but the URL itself (e.g. if it mentions timestamps) will produce a mirror with unrecoverably broken links.
"""))
            cmd.set_defaults(default_expr = "all")

        if kind == "stream":
            add_terminator(cmd, "`--format=raw` output printing", "print `--format=raw` output values")
        elif kind != "export":
            add_separator(cmd)
        else:
            add_separator(cmd, "exporting", "export values", short = False)

    # get
    cmd = subparsers.add_parser("get", help=_("print values produced by computing given expressions on a given `WRR` file"),
                                description = _(f"""Compute output values by evaluating expressions `EXPR`s on a given reqres stored at `PATH`, then print them to stdout terminating each value as specified."""))

    add_expr(cmd, "get")
    add_sniff(cmd, "get")

    cmd.add_argument("path", metavar="PATH", type=str, help=_("input `WRR` file path"))
    cmd.set_defaults(func=cmd_get)

    # run
    cmd = subparsers.add_parser("run", help=_("spawn a process with generated temporary files produced by given expressions computed on given `WRR` files as arguments"),
                                description = _("""Compute output values by evaluating expressions `EXPR`s for each of `NUM` reqres stored at `PATH`s, dump the results into into newly generated temporary files terminating each value as specified, spawn a given `COMMAND` with given arguments `ARG`s and the resulting temporary file paths appended as the last `NUM` arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process."""))

    add_expr(cmd, "run")
    add_sniff(cmd, "run")

    cmd.add_argument("-n", "--num-args", metavar="NUM", type=int, default = 1, help=_("number of `PATH`s; default: `%(default)s`"))
    cmd.add_argument("command", metavar="COMMAND", type=str, help=_("command to spawn"))
    cmd.add_argument("args", metavar="ARG", nargs="*", type=str, help=_("additional arguments to give to the `COMMAND`"))
    cmd.add_argument("paths", metavar="PATH", nargs="+", type=str, help=_("input `WRR` file paths to be mapped into new temporary files"))
    cmd.set_defaults(func=cmd_run)

    # stream
    cmd = subparsers.add_parser("stream", help=_(f"produce a stream of structured lists containing values produced by computing given expressions on given `WRR` files, a generalized `{__prog__} get`"),
                                description = _("""Compute given expressions for each of given `WRR` files, encode them into a requested format, and print the result to stdout."""))
    add_pure(cmd, "print")
    add_abridged(cmd)
    cmd.add_argument("--format", choices=["py", "cbor", "json", "raw"], default="py", help=_("""generate output in:
- py: Pythonic Object Representation aka `repr`; default
- cbor: Concise Binary Object Representation aka `CBOR` (RFC8949)
- json: JavaScript Object Notation aka `JSON`; **binary data can't be represented, UNICODE replacement characters will be used**
- raw: concatenate raw values; termination is controlled by `*-terminated` options
"""))
    add_expr(cmd, "stream")
    add_sniff(cmd, "stream")
    add_paths(cmd)
    cmd.set_defaults(func=cmd_stream)

    # find
    cmd = subparsers.add_parser("find", help=_("print paths of `WRR` files matching specified criteria"),
                                description = _(f"""Print paths of `WRR` files matching specified criteria."""))
    add_pure(cmd, "print paths to")
    add_terminator(cmd, "found files printing", "print absolute paths of matching `WRR` files", allow_not=False)
    cmd.set_defaults(sniff = SniffContentType.NONE)
    add_paths(cmd)
    cmd.set_defaults(func=cmd_find)

    def add_organize_memory(cmd : _t.Any, max_deferred : int = 1024, max_batch : int = 128) -> None:
        agrp = cmd.add_argument_group("caching, deferring, and batching")
        agrp.add_argument("--seen-number", metavar = "INT", dest="max_seen", type=int, default=16384, help=_(f"""track at most this many distinct generated `--output` values; default: `%(default)s`;
making this larger improves disk performance at the cost of increased memory consumption;
setting it to zero will force force `{__prog__}` to constantly re-check existence of `--output` files and force `{__prog__}` to execute  all IO actions immediately, disregarding `--defer-number` setting"""))
        agrp.add_argument("--cache-number", metavar = "INT", dest="max_cached", type=int, default=8192, help=_(f"""cache `stat(2)` information about this many files in memory; default: `%(default)s`;
making this larger improves performance at the cost of increased memory consumption;
setting this to a too small number will likely force `{__prog__}` into repeatedly performing lots of `stat(2)` system calls on the same files;
setting this to a value smaller than `--defer-number` will not improve memory consumption very much since deferred IO actions also cache information about their own files
"""))
        agrp.add_argument("--defer-number", metavar = "INT", dest="max_deferred", type=int, default=max_deferred, help=_("""defer at most this many IO actions; default: `%(default)s`;
making this larger improves performance at the cost of increased memory consumption;
setting it to zero will force all IO actions to be applied immediately"""))
        agrp.add_argument("--batch-number", metavar = "INT", dest="max_batched", type=int, default=max_batch, help=_(f"""queue at most this many deferred IO actions to be applied together in a batch; this queue will only be used if all other resource constraints are met; default: `%(default)s`"""))
        agrp.add_argument("--max-memory", metavar = "INT", dest="max_memory", type=int, default=1024, help=_("""the caches, the deferred actions queue, and the batch queue, all taken together, must not take more than this much memory in MiB; default: `%(default)s`;
making this larger improves performance;
the actual maximum whole-program memory consumption is `O(<size of the largest reqres> + <--seen-number> + <sum of lengths of the last --seen-number generated --output paths> + <--cache-number> + <--defer-number> + <--batch-number> + <--max-memory>)`"""))
        agrp.add_argument("--lazy", action="store_true", help=_(f"""sets all of the above options to positive infinity;
most useful when doing `{__prog__} organize --symlink --latest --output flat` or similar, where the number of distinct generated `--output` values and the amount of other data `{__prog__}` needs to keep in memory is small, in which case it will force `{__prog__}` to compute the desired file system state first and then perform all disk writes in a single batch"""))

    def add_fileout(cmd : _t.Any, kind : str) -> None:
        agrp = cmd.add_argument_group("file outputs")

        if kind == "organize":
            agrp.add_argument("-t", "--to", dest="destination", metavar="DESTINATION", type=str, help=_("destination directory; when unset each source `PATH` must be a directory which will be treated as its own `DESTINATION`"))
            agrp.add_argument("-o", "--output", metavar="FORMAT", default="default", type=str, help=_("""format describing generated output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string:""") + "\n" + \
                         "- " + _("available aliases and corresponding %%-substitutions:") + "\n" + \
                         "".join([f"  - `{name}`{' ' * (12 - len(name))}: `{value.replace('%', '%%')}`" + ("; the default" if name == "default" else "") + "\n" + output_example(name, 8) + "\n" for name, value in output_alias.items()]) + \
                         "- " + _("available substitutions:") + "\n" + \
                         "  - " + _(f"all expressions of `{__prog__} get --expr` (which see)") + ";\n" + \
                         "  - `num`: " + _("number of times the resulting output path was encountered before; adding this parameter to your `--output` format will ensure all generated file names will be unique"))
        elif kind == "import" or kind == "export":
            if kind != "export":
                def_def = "default"
            else:
                def_def = "hupq"

            agrp.add_argument("-t", "--to", dest="destination", metavar="DESTINATION", type=str, required=True, help=_("destination directory"))
            agrp.add_argument("-o", "--output", metavar="FORMAT", default=def_def, type=str, help=_(f"""format describing generated output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string; same expression format as `{__prog__} organize --output` (which see); default: %(default)s"""))
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
the `dirname` of a source file and the `--to` target directories can be the same, in that case the source file will be renamed to use new `--output` name, though renames that attempt to swap files will still fail
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
    cmd = subparsers.add_parser("organize", help=_("programmatically rename/move/hardlink/symlink `WRR` files based on their contents"),
                                description = _(f"""Parse given `WRR` files into their respective reqres and then rename/move/hardlink/symlink each file to `DESTINATION` with the new path derived from each reqres' metadata.

Operations that could lead to accidental data loss are not permitted.
E.g. `{__prog__} organize --move` will not overwrite any files, which is why the default `--output` contains `%(num)d`."""))
    add_impure(cmd, "work on")

    agrp = cmd.add_argument_group("action")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--move", dest="action", action="store_const", const="move", help=_("move source files under `DESTINATION`; default"))
    grp.add_argument("--copy", dest="action", action="store_const", const="copy", help=_("copy source files to files under `DESTINATION`"))
    grp.add_argument("--hardlink", dest="action", action="store_const", const="hardlink", help=_("create hardlinks from source files to paths under `DESTINATION`"))
    grp.add_argument("--symlink", dest="action", action="store_const", const="symlink", help=_("create symlinks from source files to paths under `DESTINATION`"))
    cmd.set_defaults(action = "move")

    add_fileout(cmd, "organize")
    add_organize_memory(cmd)

    add_sniff(cmd, "organize")
    add_paths(cmd, "organize")
    cmd.set_defaults(func=cmd_organize)

    def add_import_args(cmd : _t.Any) -> None:
        add_impure(cmd, "import")
        add_fileout(cmd, "import")
        add_organize_memory(cmd, 0, 1024)
        add_sniff(cmd, "import")
        add_paths(cmd)

    # import
    supcmd = subparsers.add_parser("import", help=_("convert other `HTTP` archive formats into `WRR`"),
                                   description = _(f"""Use specified parser to parse data in each `INPUT` `PATH` into (a sequence of) reqres and then generate and place their `WRR` dumps into separate `WRR` files under `DESTINATION` with paths derived from their metadata.
In short, this is `{__prog__} organize --copy` for `INPUT` files that use different files formats."""))
    supsub = supcmd.add_subparsers(title="file formats")

    cmd = supsub.add_parser("bundle", help=_("convert `WRR` bundles into separate `WRR` files"),
                            description = _(f"""Parse each `INPUT` `PATH` as a `WRR` bundle (an optionally compressed sequence of `WRR` dumps) and then generate and place their `WRR` dumps into separate `WRR` files under `DESTINATION` with paths derived from their metadata."""))
    add_import_args(cmd)
    cmd.set_defaults(func=cmd_import_bundle)

    cmd = supsub.add_parser("mitmproxy", help=_("convert `mitmproxy` stream dumps into `WRR` files"),
                            description = _(f"""Parse each `INPUT` `PATH` as `mitmproxy` stream dump (by using `mitmproxy`'s own parser) into a sequence of reqres and then generate and place their `WRR` dumps into separate `WRR` files under `DESTINATION` with paths derived from their metadata."""))
    add_import_args(cmd)
    cmd.set_defaults(func=cmd_import_mitmproxy)

    def add_export_memory(cmd : _t.Any) -> None:
        agrp = cmd.add_argument_group("caching")
        agrp.add_argument("--max-memory", metavar = "INT", dest="max_memory", type=int, default=1024, help=_("""the caches, all taken together, must not take more than this much memory in MiB; default: `%(default)s`;
making this larger improves performance;
the actual maximum whole-program memory consumption is `O(<size of the largest reqres> + <numer of indexed files> + <sum of lengths of all their --output paths> + <--max-memory>)`"""))

    # export
    supcmd = subparsers.add_parser("export", help=_(f"convert `WRR` archives into other formats"),
                                   description = _(f"""Parse given `WRR` files into their respective reqres, convert to another file format, and then dump the result under `DESTINATION` with the new path derived from each reqres' metadata.
"""))
    supsub = supcmd.add_subparsers(title="file formats")

    cmd = supsub.add_parser("mirror", help=_("convert given `WRR` files into a local website mirror stored in interlinked plain files"),
                            description = _(f"""Parse given `WRR` files, filter out those that have no responses, transform and then dump their response bodies into separate files under `DESTINATION` with the new path derived from each reqres' metadata.
Essentially, this is a combination of `{__prog__} organize --copy` followed by in-place `{__prog__} get` which has the advanced URL remapping capabilities of `(*|/|&)(jumps|actions|reqs)` options available in its `scrub` function.

In short, this sub-command generates static offline website mirrors, producing results similar to those of `wget -mpk`.
"""))
    add_impure(cmd, "export")
    add_expr(cmd, "export")
    add_export_memory(cmd)

    add_sniff(cmd, "export")
    add_fileout(cmd, "export")

    everything_allowed = (_("; Punycode UTS46 IDNAs, plain UNICODE IDNAs, percent-encoded URL paths and components, and UNICODE URL paths and components, in arbitrary mixes and combinations are allowed; i.e., e.g. `%s` will be silently normalized into its Punycode UTS46 and percent-encoded version of `%s` which will then be matched against `net_url` of each reqres") % (example_url[-1], example_url[-2])).replace('%', '%%')

    agrp = cmd.add_argument_group("recursion roots; if none are specified, then all URLs available from input `PATH`s will be treated as roots (except for those given via `--boring`); all of these options can be specified multiple times in arbitrary combinations")
    agrp.add_argument("--root-url", dest="root_url", metavar="URL", action="append", type=str, default = [], help=_("a URL to be used as one of the roots for recursive export") + everything_allowed)
    agrp.add_argument("-r", "--root-url-prefix", "--root", dest="root_url_prefix", metavar="URL_PREFIX", action="append", type=str, default = [], help=_("a URL prefix for URLs that are to be used as roots for recursive export") + everything_allowed)
    agrp.add_argument("--root-url-re", dest="root_url_re", metavar="URL_RE", action="append", type=str, default = [], help=_("a regular expression matching URLs that are to be used as roots for recursive export; the regular expression will be matched against `net_url` and `pretty_net` of each reqres, so only Punycode UTS46 IDNAs with percent-encoded URL path and query components or plain UNICODE IDNAs with UNICODE URL paths and components are allowed, but regular expressions using mixes of differently encoded parts will fail to match anything"))

    agrp = cmd.add_argument_group("recursion depth")
    agrp.add_argument("-d", "--depth", metavar="DEPTH", type=int, default=0, help=_('maximum recursion depth level; the default is `%(default)s`, which means "`--root-*` documents and their requisite resources only"; setting this to `1` will also export one level of documents referenced via jump and action links, if those are being remapped to local files with `--remap-*`; higher values will mean even more recursion'))

    add_paths(cmd)

    cmd.add_argument("--boring", metavar="PATH", action="append", type=str, default = [], help=_("low-priority input `PATH`; boring `PATH`s will be processed after all `PATH`s specified as positional command-line arguments and those given via `--stdin0` and will not be queued as roots even when no `--root-*` options are specified"))

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
