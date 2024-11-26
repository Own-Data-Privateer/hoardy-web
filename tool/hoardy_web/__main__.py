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

import bisect as _bisect
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
import typing as _t

from gettext import gettext, ngettext

from kisstdlib import argparse
from kisstdlib.exceptions import *
from kisstdlib.io import *
from kisstdlib.io.stdio import *
from kisstdlib.logging import *

from .wrr import *
from .output import *
from .filter import *

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

def pred_linst(expr : str, func : LinstFunc, rrexpr : ReqresExpr[_t.Any]) -> bool:
    res = rrexpr.eval_func(func)
    if isinstance(res, bool):
        return res
    else:
        e = CatastrophicFailure(gettext("while evaluating `%s`: expected a value of type `bool`, got `%s`"), expr, repr(res))
        e.elaborate(gettext("while processing `%s`"), rrexpr.source.show_source())
        raise e

def mk_linst_filter(get_attr : _t.Callable[[FilterNameType], list[str]],
                    get_optname : _t.Callable[[FilterNameType], str],
                    name : FilterNameType,
                    yes : bool,
                    matches : PredicateMatchesType[str, LinstFunc, ReqresExpr[_t.Any]]) \
                    -> FilterType[ReqresExpr[_t.Any]]:
    compiled = mk_conditions(str_id, lambda x: linst_compile(x, linst_atom_or_env), get_attr(name))
    num = len(compiled)

    def allows(v : ReqresExpr[_t.Any]) -> bool:
        res = matches(pred_linst, compiled, v)
        return res if yes else not res

    def warn() -> None:
        warn_redundant(get_optname(name), yes, compiled)

    return num, allows, warn

def compile_filters(cargs : _t.Any, attr_prefix : str = "") -> FilterType[ReqresExpr[_t.Any]]:
    opt_prefix = attr_prefix.replace("_", "-")

    def get_attr(x : str) -> _t.Any:
        return getattr(cargs, attr_prefix + x)

    def get_optname(x : str) -> str:
        return f"--{opt_prefix}{x.replace('_', '-')}"

    filters : list[FilterType[ReqresExpr[_t.Any]]] = []

    def add_yn_epoch_filter(name : str, pred : _t.Callable[[str, Epoch, ReqresExpr[_t.Any]], bool]) -> None:
        add_yn_filter(filters, get_attr, get_optname, name,
                      mk_simple_filter, parse_Epoch, lambda c, v: matches_all(pred, c, v))

    def is_before(k : _t.Any, stime : Epoch, rrexpr : ReqresExpr[_t.Any]) -> bool:
        rrstime : Epoch = rrexpr.stime
        return rrstime < stime

    def is_after(k : _t.Any, stime : Epoch, rrexpr : ReqresExpr[_t.Any]) -> bool:
        rrstime : Epoch = rrexpr.stime
        return stime < rrstime

    add_yn_epoch_filter("before", is_before)
    add_yn_epoch_filter("after", is_after)

    def add_yn_field_filter(name : str, field : str | None = None) -> None:
        if field is None:
            field = name

        def get_inputs(rrexpr : ReqresExpr[_t.Any]) -> StrFilterInputType:
            value = rrexpr.get_value(field)
            l = [ value ] if value is not None else []
            return l, l

        add_yn_filter(filters, get_attr, get_optname, name, mk_str_filter, str_id, str_id, get_inputs)

    add_yn_field_filter("protocol")
    add_yn_field_filter("request_method", "request.method")
    add_yn_field_filter("status")

    def neturlify(url : str) -> str:
        return parse_url(url).net_url

    def add_yn_url_filter(name : str) -> None:
        def get_inputs(rrexpr : ReqresExpr[_t.Any]) -> StrFilterInputType:
            net_url = rrexpr.net_url
            lnet_url = [net_url]
            return lnet_url, lambda: [net_url, rrexpr.pretty_net_url]

        add_yn_filter(filters, get_attr, get_optname, name, mk_str_filter, neturlify, neturlify, get_inputs)

    add_yn_url_filter("url")

    def add_yn_headers_grep_filter(name : str, field : str,
                                   matches : PredicateMatchesType[str, PatternSB, IterSB]) -> None:
        def get_inputs(rrexpr : ReqresExpr[_t.Any]) -> IterSB:
            value = rrexpr.get_value(field)
            if value is not None:
                return get_raw_headers(value)
            return []

        add_yn_filter(filters, get_attr, get_optname, name, mk_grep_filter, cargs.ignore_case, matches, get_inputs)

    def add_yn_field_grep_filter(name : str, field : str,
                                 matches : PredicateMatchesType[str, PatternSB, IterSB]) -> None:
        def get_inputs(rrexpr : ReqresExpr[_t.Any]) -> list[str | bytes]:
            value = rrexpr.get_value(field)
            l = [ value ] if value is not None else []
            return l

        add_yn_filter(filters, get_attr, get_optname, name, mk_grep_filter, cargs.ignore_case, matches, get_inputs)

    def add_rr(side : str) -> None:
        add_yn_headers_grep_filter(f"{side}_headers_or_grep", f"{side}.headers", matches_any)
        add_yn_headers_grep_filter(f"{side}_headers_and_grep", f"{side}.headers", matches_all)
        add_yn_field_filter(f"{side}_mime")
        add_yn_field_grep_filter(f"{side}_body_or_grep", f"{side}.body", matches_any)
        add_yn_field_grep_filter(f"{side}_body_and_grep", f"{side}.body", matches_all)

    add_rr("request")
    add_rr("response")

    def add_yn_grep_filter(name : str, matches : PredicateMatchesType[str, PatternSB, IterSB]) -> None:
        def get_inputs(rrexpr : ReqresExpr[_t.Any]) -> list[str | bytes]:
            res : list[str | bytes] = [ rrexpr.raw_url, rrexpr.url, rrexpr.pretty_url ]
            reqres = rrexpr.reqres
            res += get_raw_headers(reqres.request.headers)
            res.append(reqres.request.body)
            if reqres.response is not None:
                res += get_raw_headers(reqres.response.headers)
                res.append(reqres.response.body)
            return res

        add_yn_filter(filters, get_attr, get_optname, name, mk_grep_filter, cargs.ignore_case, matches, get_inputs)

    add_yn_grep_filter("or_grep", matches_any)
    add_yn_grep_filter("and_grep", matches_all)

    filters.append(mk_linst_filter(get_attr, get_optname, "and", True, matches_all))
    filters.append(mk_linst_filter(get_attr, get_optname, "or", False, matches_any))

    return merge_non_empty_filters(filters)

def compile_expr(expr : str) -> tuple[str, LinstFunc]:
    return (expr, linst_compile(expr, ReqresExpr_lookup))

def elaborate_output(kind : str, aliases : dict[str, str], value : str) -> str:
    if value.startswith("format:"):
        return value[7:]
    else:
        try:
            return aliases[value]
        except KeyError:
            raise CatastrophicFailure(gettext('unknown `%s` alias "%s", prepend "format:" if you want it to be interpreted as a Pythonic %%-substutition'), kind, value)

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

            emit_func(data)
        except Failure as exc:
            if errors == "ignore":
                continue
            exc.elaborate(gettext("while processing `%s`"), path)
            if errors != "fail":
                _logging.error("%s", str(exc))
                continue
            raise exc

def map_wrr_paths(cargs : _t.Any,
                  loadf_func : LoadFFunc[_t.AnyStr, _t.Iterator[ReqresExpr[_t.Any]]],
                  filters_allow : _t.Callable[[ReqresExpr[_t.Any]], bool],
                  emit_func : EmitFunc[ReqresExpr[_t.Any]],
                  paths : list[_t.AnyStr],
                  **kwargs : _t.Any) -> None:
    def emit_many(rrexprs : _t.Iterator[ReqresExpr[_t.Any]]) -> None:
        for rrexpr in rrexprs:
            if want_stop: raise KeyboardInterrupt()

            rrexpr.sniff = cargs.sniff
            if not filters_allow(rrexpr):
                continue
            emit_func(rrexpr)

    global should_raise
    should_raise = False
    for exp_path in paths:
        load_map_orderly(loadf_func, emit_many, exp_path, ordering=cargs.walk_fs, errors=cargs.errors, **kwargs)

def dispatch_rrexprs_load() -> LoadFFunc[_t.AnyStr, _t.Iterator[ReqresExpr[_t.Any]]]:
    import_failed = []
    class Mutable:
        not_warned : bool = True

    have_mitmproxy = False
    try:
        from .mitmproxy import rrexprs_mitmproxy_loadf
    except ImportError as exc:
        import_failed.append(("mitmproxy", str_Exception(exc)))
    else:
        have_mitmproxy = True

    is_wrr : IncludeFilesFunc[_t.AnyStr] = with_extension_in([".wrr", b".wrr"])
    is_wrrb : IncludeFilesFunc[_t.AnyStr] = with_extension_in([".wrrb", b".wrrb"])

    def warn(path : _t.AnyStr, parser : str, exc : Exception) -> None:
        _logging.warn(gettext("while processing `%s`: failed to parse with `%s` parser: %s"), path, parser, str_Exception(exc))

    def rrexprs_load(path : _t.AnyStr) -> _t.Iterator[ReqresExpr[_t.Any]]:
        if is_wrr(path):
            try:
                yield rrexpr_wrr_loadf(path)
                return
            except Exception as exc:
                warn(path, "wrr", exc)
        elif is_wrrb(path):
            try:
                yield from rrexprs_wrr_some_loadf(path)
                return
            except Exception as exc:
                warn(path, "wrrb", exc)
        elif have_mitmproxy:
            try:
                yield from rrexprs_mitmproxy_loadf(path)
                return
            except Exception as exc:
                warn(path, "mitmproxy", exc)

        if Mutable.not_warned:
            Mutable.not_warned = False
            for m, e in import_failed:
                _logging.warn(gettext("failed to import `%s` parser: %s"), m, e)
        raise Failure(gettext("failed to find a suitable parser"))

    return rrexprs_load

def mk_rrexprs_load(cargs : _t.Any) -> LoadFFunc[_t.AnyStr, _t.Iterator[ReqresExpr[_t.Any]]]:
    loader = cargs.loader
    if loader is None:
        return dispatch_rrexprs_load()
    elif loader == "wrr":
        return rrexpr_wrr_loadf
    elif loader == "wrrb":
        return rrexprs_wrr_some_loadf
    elif loader == "mitmproxy":
        from .mitmproxy import rrexprs_mitmproxy_loadf
        return rrexprs_mitmproxy_loadf
    else:
        assert False

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
    handle_paths(cargs)

    def emit(rrexpr : ReqresExpr[DeferredSourceType]) -> None:
        wrr_pprint(stdout, rrexpr.reqres, rrexpr.source.show_source(), cargs.abridged, cargs.sniff)
        stdout.flush()

    _num, filters_allow, filters_warn = compile_filters(cargs)
    map_wrr_paths(cargs, mk_rrexprs_load(cargs), filters_allow, emit, cargs.paths)
    filters_warn()

def print_exprs(rrexpr : ReqresExpr[_t.Any], exprs : list[tuple[str, LinstFunc]],
                separator : bytes, fobj : MinimalIOWriter) -> None:
    not_first = False
    for expr, func in exprs:
        try:
            data = get_bytes(rrexpr.eval_func(func))
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

    _num, filters_allow, filters_warn = compile_filters(cargs)
    stream.start()
    try:
        map_wrr_paths(cargs, mk_rrexprs_load(cargs), filters_allow, emit, cargs.paths)
    finally:
        stream.finish()
    filters_warn()

def cmd_find(cargs : _t.Any) -> None:
    handle_paths(cargs)

    def emit(rrexpr : ReqresExpr[DeferredSourceType]) -> None:
        stdout.write(rrexpr.source.show_source())
        stdout.write_bytes(cargs.terminator)
        stdout.flush()

    _num, filters_allow, filters_warn = compile_filters(cargs)
    map_wrr_paths(cargs, mk_rrexprs_load(cargs), filters_allow, emit, cargs.paths)
    filters_warn()

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

ofdsd  = "%(syear)d/%(smonth)02d/%(sday)02d"
ofdms  = "%(shour)02d%(sminute)02d%(ssecond)02d%(stime_msq)03d"
ofdd  = f"%(syear)d-%(smonth)02d-%(sday)02d_{ofdms}"
ofpq   = "%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s"
ofpsq  = "%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s"
ofpnq  = "%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s"
ofpsnq = "%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s"
ofp_snq = "%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s"
ofh4 = "%(net_url|to_ascii|sha256|take_prefix 2|to_hex)s"

output_alias = {
    "default":       f"{ofdsd}/{ofdms}_%(qtime_ms)s_%(method)s_{ofh4}_%(status)s_%(hostname)s_%(num)d",
    "short":         f"{ofdsd}/%(stime_ms)d_%(qtime_ms)s_%(num)d",

    "surl":           "%(scheme)s/%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s",
    "surl_msn":       "%(scheme)s/%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_%(num)d",
    "surl_mstn":     f"%(scheme)s/%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_{ofdd}_%(num)d",

    "shupq":         f"%(scheme)s/%(hostname)s/{ofpq}%(filepath_ext)s",
    "shupq_n":       f"%(scheme)s/%(hostname)s/{ofpq}.%(num)d%(filepath_ext)s",
    "shupq_tn":      f"%(scheme)s/%(hostname)s/{ofpq}.{ofdd}_%(num)d%(filepath_ext)s",
    "shupq_msn":     f"%(scheme)s/%(hostname)s/{ofpsq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "shupq_mstn":    f"%(scheme)s/%(hostname)s/{ofpsq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",

    "shupnq":        f"%(scheme)s/%(hostname)s/{ofpnq}%(filepath_ext)s",
    "shupnq_n":      f"%(scheme)s/%(hostname)s/{ofpnq}.%(num)d%(filepath_ext)s",
    "shupnq_tn":     f"%(scheme)s/%(hostname)s/{ofpnq}.{ofdd}_%(num)d%(filepath_ext)s",
    "shupnq_msn":    f"%(scheme)s/%(hostname)s/{ofpsnq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "shupnq_mstn":   f"%(scheme)s/%(hostname)s/{ofpsnq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",
    "shupnq_mhs":    f"%(scheme)s/%(hostname)s/{ofpnq}.%(method)s_{ofh4}_%(status)s%(filepath_ext)s",
    "shupnq_mhsn":   f"%(scheme)s/%(hostname)s/{ofpsnq}.%(method)s_{ofh4}_%(status)s_%(num)d%(filepath_ext)s",
    "shupnq_mhstn":  f"%(scheme)s/%(hostname)s/{ofpsnq}.%(method)s_{ofh4}_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",

    "srhupq":        f"%(scheme)s/%(rhostname)s/{ofpq}%(filepath_ext)s",
    "srhupq_n":      f"%(scheme)s/%(rhostname)s/{ofpq}.%(num)d%(filepath_ext)s",
    "srhupq_tn":     f"%(scheme)s/%(rhostname)s/{ofpq}.{ofdd}_%(num)d%(filepath_ext)s",
    "srhupq_msn":    f"%(scheme)s/%(rhostname)s/{ofpsq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "srhupq_mstn":   f"%(scheme)s/%(rhostname)s/{ofpsq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",

    "srhupnq":       f"%(scheme)s/%(rhostname)s/{ofpnq}%(filepath_ext)s",
    "srhupnq_n":     f"%(scheme)s/%(rhostname)s/{ofpnq}.%(num)d%(filepath_ext)s",
    "srhupnq_tn":    f"%(scheme)s/%(rhostname)s/{ofpnq}.{ofdd}_%(num)d%(filepath_ext)s",
    "srhupnq_msn":   f"%(scheme)s/%(rhostname)s/{ofpsnq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "srhupnq_mstn":  f"%(scheme)s/%(rhostname)s/{ofpsnq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",
    "srhupnq_mhs":   f"%(scheme)s/%(rhostname)s/{ofpnq}.%(method)s_{ofh4}_%(status)s%(filepath_ext)s",
    "srhupnq_mhsn":  f"%(scheme)s/%(rhostname)s/{ofpsnq}.%(method)s_{ofh4}_%(status)s_%(num)d%(filepath_ext)s",
    "srhupnq_mhstn": f"%(scheme)s/%(rhostname)s/{ofpsnq}.%(method)s_{ofh4}_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",

    "url":            "%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s",
    "url_msn":        "%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_%(num)d",
    "url_mstn":      f"%(netloc)s/%(mq_npath)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_{ofdd}_%(num)d",

    "hupq":          f"%(hostname)s/{ofpq}%(filepath_ext)s",
    "hupq_n":        f"%(hostname)s/{ofpq}.%(num)d%(filepath_ext)s",
    "hupq_tn":       f"%(hostname)s/{ofpq}.{ofdd}_%(num)d%(filepath_ext)s",
    "hupq_msn":      f"%(hostname)s/{ofpsq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "hupq_mstn":     f"%(hostname)s/{ofpsq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",

    "hupnq":         f"%(hostname)s/{ofpnq}%(filepath_ext)s",
    "hupnq_n":       f"%(hostname)s/{ofpnq}.%(num)d%(filepath_ext)s",
    "hupnq_tn":      f"%(hostname)s/{ofpnq}.{ofdd}_%(num)d%(filepath_ext)s",
    "hupnq_msn":     f"%(hostname)s/{ofpsnq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "hupnq_mstn":    f"%(hostname)s/{ofpsnq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",
    "hupnq_mhs":     f"%(hostname)s/{ofpnq}.%(method)s_{ofh4}_%(status)s%(filepath_ext)s",
    "hupnq_mhsn":    f"%(hostname)s/{ofpsnq}.%(method)s_{ofh4}_%(status)s_%(num)d%(filepath_ext)s",
    "hupnq_mhstn":   f"%(hostname)s/{ofpsnq}.%(method)s_{ofh4}_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",

    "rhupq":         f"%(rhostname)s/{ofpq}%(filepath_ext)s",
    "rhupq_n":       f"%(rhostname)s/{ofpq}.%(num)d%(filepath_ext)s",
    "rhupq_tn":      f"%(rhostname)s/{ofpq}.{ofdd}_%(num)d%(filepath_ext)s",
    "rhupq_msn":     f"%(rhostname)s/{ofpsq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "rhupq_mstn":    f"%(rhostname)s/{ofpsq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",

    "rhupnq":        f"%(rhostname)s/{ofpnq}%(filepath_ext)s",
    "rhupnq_n":      f"%(rhostname)s/{ofpnq}.%(num)d%(filepath_ext)s",
    "rhupnq_tn":     f"%(rhostname)s/{ofpnq}.{ofdd}_%(num)d%(filepath_ext)s",
    "rhupnq_msn":    f"%(rhostname)s/{ofpsnq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "rhupnq_mstn":   f"%(rhostname)s/{ofpsnq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",
    "rhupnq_mhs":    f"%(rhostname)s/{ofpnq}.%(method)s_{ofh4}_%(status)s%(filepath_ext)s",
    "rhupnq_mhsn":   f"%(rhostname)s/{ofpsnq}.%(method)s_{ofh4}_%(status)s_%(num)d%(filepath_ext)s",
    "rhupnq_mhstn":  f"%(rhostname)s/{ofpsnq}.%(method)s_{ofh4}_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",

    "flat":          f"%(hostname)s/{ofp_snq}%(filepath_ext)s",
    "flat_n":        f"%(hostname)s/{ofp_snq}.%(num)d%(filepath_ext)s",
    "flat_tn":       f"%(hostname)s/{ofp_snq}.{ofdd}_%(num)d%(filepath_ext)s",
    "flat_ms":       f"%(hostname)s/{ofp_snq}.%(method)s_%(status)s%(filepath_ext)s",
    "flat_msn":      f"%(hostname)s/{ofp_snq}.%(method)s_%(status)s_%(num)d%(filepath_ext)s",
    "flat_mstn":     f"%(hostname)s/{ofp_snq}.%(method)s_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",
    "flat_mhs":      f"%(hostname)s/{ofp_snq}.%(method)s_{ofh4}_%(status)s%(filepath_ext)s",
    "flat_mhsn":     f"%(hostname)s/{ofp_snq}.%(method)s_{ofh4}_%(status)s_%(num)d%(filepath_ext)s",
    "flat_mhstn":    f"%(hostname)s/{ofp_snq}.%(method)s_{ofh4}_%(status)s_{ofdd}_%(num)d%(filepath_ext)s",
}

def output_example(name : str, indent : int) -> str:
    def gen(url : str) -> str:
        x = ReqresExpr(UnknownSource(), trivial_Reqres(parse_url(url)))
        x.values["num"] = 0
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
            x.values["num"] = 0
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
surl_mstn:    https/example.org/__GET_C200C_1970-01-01_001640000_0
surl_mstn:    ==
surl_mstn:    https/example.org/index.html__GET_C200C_1970-01-01_001640000_0
surl_mstn:    https/example.org/media__GET_C200C_1970-01-01_001640000_0
surl_mstn:    ==
surl_mstn:    https/example.org/view?one=1&two=2&three&three=3__GET_C200C_1970-01-01_001640000_0
surl_mstn:    https/königsgäßchen.example.org/index.html__GET_C200C_1970-01-01_001640000_0
surl_mstn:    https/ジャジェメント.ですの.example.org/испытание/is__GET_C200C_1970-01-01_001640000_0
surl_mstn:    ==
surl_mstn:    ==
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
shupq_tn:     https/example.org/index.1970-01-01_001640000_0.htm
shupq_tn:     ==
shupq_tn:     https/example.org/index.1970-01-01_001640000_0.html
shupq_tn:     https/example.org/media/index.1970-01-01_001640000_0.htm
shupq_tn:     ==
shupq_tn:     https/example.org/view/index?one=1&two=2&three&three=3.1970-01-01_001640000_0.htm
shupq_tn:     https/königsgäßchen.example.org/index.1970-01-01_001640000_0.html
shupq_tn:     https/ジャジェメント.ですの.example.org/испытание/is/index.1970-01-01_001640000_0.htm
shupq_tn:     ==
shupq_tn:     ==
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
shupq_mstn:   https/example.org/index.GET_C200C_1970-01-01_001640000_0.htm
shupq_mstn:   ==
shupq_mstn:   https/example.org/index.GET_C200C_1970-01-01_001640000_0.html
shupq_mstn:   https/example.org/media/index.GET_C200C_1970-01-01_001640000_0.htm
shupq_mstn:   ==
shupq_mstn:   https/example.org/view/index?one=1&two=2&three&three=3.GET_C200C_1970-01-01_001640000_0.htm
shupq_mstn:   https/königsgäßchen.example.org/index.GET_C200C_1970-01-01_001640000_0.html
shupq_mstn:   https/ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_1970-01-01_001640000_0.htm
shupq_mstn:   ==
shupq_mstn:   ==
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
shupnq_tn:    https/example.org/index.1970-01-01_001640000_0.htm
shupnq_tn:    ==
shupnq_tn:    https/example.org/index.1970-01-01_001640000_0.html
shupnq_tn:    https/example.org/media/index.1970-01-01_001640000_0.htm
shupnq_tn:    ==
shupnq_tn:    https/example.org/view/index?one=1&two=2&three=3.1970-01-01_001640000_0.htm
shupnq_tn:    https/königsgäßchen.example.org/index.1970-01-01_001640000_0.html
shupnq_tn:    https/ジャジェメント.ですの.example.org/испытание/is/index.1970-01-01_001640000_0.htm
shupnq_tn:    ==
shupnq_tn:    ==
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
shupnq_mstn:  https/example.org/index.GET_C200C_1970-01-01_001640000_0.htm
shupnq_mstn:  ==
shupnq_mstn:  https/example.org/index.GET_C200C_1970-01-01_001640000_0.html
shupnq_mstn:  https/example.org/media/index.GET_C200C_1970-01-01_001640000_0.htm
shupnq_mstn:  ==
shupnq_mstn:  https/example.org/view/index?one=1&two=2&three=3.GET_C200C_1970-01-01_001640000_0.htm
shupnq_mstn:  https/königsgäßchen.example.org/index.GET_C200C_1970-01-01_001640000_0.html
shupnq_mstn:  https/ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_1970-01-01_001640000_0.htm
shupnq_mstn:  ==
shupnq_mstn:  ==
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
shupnq_mhstn: https/example.org/index.GET_8198_C200C_1970-01-01_001640000_0.htm
shupnq_mhstn: ==
shupnq_mhstn: https/example.org/index.GET_f0dc_C200C_1970-01-01_001640000_0.html
shupnq_mhstn: https/example.org/media/index.GET_086d_C200C_1970-01-01_001640000_0.htm
shupnq_mhstn: https/example.org/media/index.GET_3fbb_C200C_1970-01-01_001640000_0.htm
shupnq_mhstn: https/example.org/view/index?one=1&two=2&three=3.GET_5658_C200C_1970-01-01_001640000_0.htm
shupnq_mhstn: https/königsgäßchen.example.org/index.GET_4f11_C200C_1970-01-01_001640000_0.html
shupnq_mhstn: https/ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C_1970-01-01_001640000_0.htm
shupnq_mhstn: ==
shupnq_mhstn: ==
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
srhupq_tn:    https/org.example/index.1970-01-01_001640000_0.htm
srhupq_tn:    ==
srhupq_tn:    https/org.example/index.1970-01-01_001640000_0.html
srhupq_tn:    https/org.example/media/index.1970-01-01_001640000_0.htm
srhupq_tn:    ==
srhupq_tn:    https/org.example/view/index?one=1&two=2&three&three=3.1970-01-01_001640000_0.htm
srhupq_tn:    https/org.example.königsgäßchen/index.1970-01-01_001640000_0.html
srhupq_tn:    https/org.example.ですの.ジャジェメント/испытание/is/index.1970-01-01_001640000_0.htm
srhupq_tn:    ==
srhupq_tn:    ==
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
srhupq_mstn:  https/org.example/index.GET_C200C_1970-01-01_001640000_0.htm
srhupq_mstn:  ==
srhupq_mstn:  https/org.example/index.GET_C200C_1970-01-01_001640000_0.html
srhupq_mstn:  https/org.example/media/index.GET_C200C_1970-01-01_001640000_0.htm
srhupq_mstn:  ==
srhupq_mstn:  https/org.example/view/index?one=1&two=2&three&three=3.GET_C200C_1970-01-01_001640000_0.htm
srhupq_mstn:  https/org.example.königsgäßchen/index.GET_C200C_1970-01-01_001640000_0.html
srhupq_mstn:  https/org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_1970-01-01_001640000_0.htm
srhupq_mstn:  ==
srhupq_mstn:  ==
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
srhupnq_tn:   https/org.example/index.1970-01-01_001640000_0.htm
srhupnq_tn:   ==
srhupnq_tn:   https/org.example/index.1970-01-01_001640000_0.html
srhupnq_tn:   https/org.example/media/index.1970-01-01_001640000_0.htm
srhupnq_tn:   ==
srhupnq_tn:   https/org.example/view/index?one=1&two=2&three=3.1970-01-01_001640000_0.htm
srhupnq_tn:   https/org.example.königsgäßchen/index.1970-01-01_001640000_0.html
srhupnq_tn:   https/org.example.ですの.ジャジェメント/испытание/is/index.1970-01-01_001640000_0.htm
srhupnq_tn:   ==
srhupnq_tn:   ==
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
srhupnq_mstn: https/org.example/index.GET_C200C_1970-01-01_001640000_0.htm
srhupnq_mstn: ==
srhupnq_mstn: https/org.example/index.GET_C200C_1970-01-01_001640000_0.html
srhupnq_mstn: https/org.example/media/index.GET_C200C_1970-01-01_001640000_0.htm
srhupnq_mstn: ==
srhupnq_mstn: https/org.example/view/index?one=1&two=2&three=3.GET_C200C_1970-01-01_001640000_0.htm
srhupnq_mstn: https/org.example.königsgäßchen/index.GET_C200C_1970-01-01_001640000_0.html
srhupnq_mstn: https/org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_1970-01-01_001640000_0.htm
srhupnq_mstn: ==
srhupnq_mstn: ==
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
srhupnq_mhstn: https/org.example/index.GET_8198_C200C_1970-01-01_001640000_0.htm
srhupnq_mhstn: ==
srhupnq_mhstn: https/org.example/index.GET_f0dc_C200C_1970-01-01_001640000_0.html
srhupnq_mhstn: https/org.example/media/index.GET_086d_C200C_1970-01-01_001640000_0.htm
srhupnq_mhstn: https/org.example/media/index.GET_3fbb_C200C_1970-01-01_001640000_0.htm
srhupnq_mhstn: https/org.example/view/index?one=1&two=2&three=3.GET_5658_C200C_1970-01-01_001640000_0.htm
srhupnq_mhstn: https/org.example.königsgäßchen/index.GET_4f11_C200C_1970-01-01_001640000_0.html
srhupnq_mhstn: https/org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C_1970-01-01_001640000_0.htm
srhupnq_mhstn: ==
srhupnq_mhstn: ==
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
url_mstn:     example.org/__GET_C200C_1970-01-01_001640000_0
url_mstn:     ==
url_mstn:     example.org/index.html__GET_C200C_1970-01-01_001640000_0
url_mstn:     example.org/media__GET_C200C_1970-01-01_001640000_0
url_mstn:     ==
url_mstn:     example.org/view?one=1&two=2&three&three=3__GET_C200C_1970-01-01_001640000_0
url_mstn:     königsgäßchen.example.org/index.html__GET_C200C_1970-01-01_001640000_0
url_mstn:     ジャジェメント.ですの.example.org/испытание/is__GET_C200C_1970-01-01_001640000_0
url_mstn:     ==
url_mstn:     ==
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
hupq_tn:      example.org/index.1970-01-01_001640000_0.htm
hupq_tn:      ==
hupq_tn:      example.org/index.1970-01-01_001640000_0.html
hupq_tn:      example.org/media/index.1970-01-01_001640000_0.htm
hupq_tn:      ==
hupq_tn:      example.org/view/index?one=1&two=2&three&three=3.1970-01-01_001640000_0.htm
hupq_tn:      königsgäßchen.example.org/index.1970-01-01_001640000_0.html
hupq_tn:      ジャジェメント.ですの.example.org/испытание/is/index.1970-01-01_001640000_0.htm
hupq_tn:      ==
hupq_tn:      ==
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
hupq_mstn:    example.org/index.GET_C200C_1970-01-01_001640000_0.htm
hupq_mstn:    ==
hupq_mstn:    example.org/index.GET_C200C_1970-01-01_001640000_0.html
hupq_mstn:    example.org/media/index.GET_C200C_1970-01-01_001640000_0.htm
hupq_mstn:    ==
hupq_mstn:    example.org/view/index?one=1&two=2&three&three=3.GET_C200C_1970-01-01_001640000_0.htm
hupq_mstn:    königsgäßchen.example.org/index.GET_C200C_1970-01-01_001640000_0.html
hupq_mstn:    ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_1970-01-01_001640000_0.htm
hupq_mstn:    ==
hupq_mstn:    ==
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
hupnq_tn:     example.org/index.1970-01-01_001640000_0.htm
hupnq_tn:     ==
hupnq_tn:     example.org/index.1970-01-01_001640000_0.html
hupnq_tn:     example.org/media/index.1970-01-01_001640000_0.htm
hupnq_tn:     ==
hupnq_tn:     example.org/view/index?one=1&two=2&three=3.1970-01-01_001640000_0.htm
hupnq_tn:     königsgäßchen.example.org/index.1970-01-01_001640000_0.html
hupnq_tn:     ジャジェメント.ですの.example.org/испытание/is/index.1970-01-01_001640000_0.htm
hupnq_tn:     ==
hupnq_tn:     ==
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
hupnq_mstn:   example.org/index.GET_C200C_1970-01-01_001640000_0.htm
hupnq_mstn:   ==
hupnq_mstn:   example.org/index.GET_C200C_1970-01-01_001640000_0.html
hupnq_mstn:   example.org/media/index.GET_C200C_1970-01-01_001640000_0.htm
hupnq_mstn:   ==
hupnq_mstn:   example.org/view/index?one=1&two=2&three=3.GET_C200C_1970-01-01_001640000_0.htm
hupnq_mstn:   königsgäßchen.example.org/index.GET_C200C_1970-01-01_001640000_0.html
hupnq_mstn:   ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_1970-01-01_001640000_0.htm
hupnq_mstn:   ==
hupnq_mstn:   ==
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
hupnq_mhstn:  example.org/index.GET_8198_C200C_1970-01-01_001640000_0.htm
hupnq_mhstn:  ==
hupnq_mhstn:  example.org/index.GET_f0dc_C200C_1970-01-01_001640000_0.html
hupnq_mhstn:  example.org/media/index.GET_086d_C200C_1970-01-01_001640000_0.htm
hupnq_mhstn:  example.org/media/index.GET_3fbb_C200C_1970-01-01_001640000_0.htm
hupnq_mhstn:  example.org/view/index?one=1&two=2&three=3.GET_5658_C200C_1970-01-01_001640000_0.htm
hupnq_mhstn:  königsgäßchen.example.org/index.GET_4f11_C200C_1970-01-01_001640000_0.html
hupnq_mhstn:  ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C_1970-01-01_001640000_0.htm
hupnq_mhstn:  ==
hupnq_mhstn:  ==
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
rhupq_tn:     org.example/index.1970-01-01_001640000_0.htm
rhupq_tn:     ==
rhupq_tn:     org.example/index.1970-01-01_001640000_0.html
rhupq_tn:     org.example/media/index.1970-01-01_001640000_0.htm
rhupq_tn:     ==
rhupq_tn:     org.example/view/index?one=1&two=2&three&three=3.1970-01-01_001640000_0.htm
rhupq_tn:     org.example.königsgäßchen/index.1970-01-01_001640000_0.html
rhupq_tn:     org.example.ですの.ジャジェメント/испытание/is/index.1970-01-01_001640000_0.htm
rhupq_tn:     ==
rhupq_tn:     ==
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
rhupq_mstn:   org.example/index.GET_C200C_1970-01-01_001640000_0.htm
rhupq_mstn:   ==
rhupq_mstn:   org.example/index.GET_C200C_1970-01-01_001640000_0.html
rhupq_mstn:   org.example/media/index.GET_C200C_1970-01-01_001640000_0.htm
rhupq_mstn:   ==
rhupq_mstn:   org.example/view/index?one=1&two=2&three&three=3.GET_C200C_1970-01-01_001640000_0.htm
rhupq_mstn:   org.example.königsgäßchen/index.GET_C200C_1970-01-01_001640000_0.html
rhupq_mstn:   org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_1970-01-01_001640000_0.htm
rhupq_mstn:   ==
rhupq_mstn:   ==
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
rhupnq_tn:    org.example/index.1970-01-01_001640000_0.htm
rhupnq_tn:    ==
rhupnq_tn:    org.example/index.1970-01-01_001640000_0.html
rhupnq_tn:    org.example/media/index.1970-01-01_001640000_0.htm
rhupnq_tn:    ==
rhupnq_tn:    org.example/view/index?one=1&two=2&three=3.1970-01-01_001640000_0.htm
rhupnq_tn:    org.example.königsgäßchen/index.1970-01-01_001640000_0.html
rhupnq_tn:    org.example.ですの.ジャジェメント/испытание/is/index.1970-01-01_001640000_0.htm
rhupnq_tn:    ==
rhupnq_tn:    ==
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
rhupnq_mstn:  org.example/index.GET_C200C_1970-01-01_001640000_0.htm
rhupnq_mstn:  ==
rhupnq_mstn:  org.example/index.GET_C200C_1970-01-01_001640000_0.html
rhupnq_mstn:  org.example/media/index.GET_C200C_1970-01-01_001640000_0.htm
rhupnq_mstn:  ==
rhupnq_mstn:  org.example/view/index?one=1&two=2&three=3.GET_C200C_1970-01-01_001640000_0.htm
rhupnq_mstn:  org.example.königsgäßchen/index.GET_C200C_1970-01-01_001640000_0.html
rhupnq_mstn:  org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_1970-01-01_001640000_0.htm
rhupnq_mstn:  ==
rhupnq_mstn:  ==
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
rhupnq_mhstn: org.example/index.GET_8198_C200C_1970-01-01_001640000_0.htm
rhupnq_mhstn: ==
rhupnq_mhstn: org.example/index.GET_f0dc_C200C_1970-01-01_001640000_0.html
rhupnq_mhstn: org.example/media/index.GET_086d_C200C_1970-01-01_001640000_0.htm
rhupnq_mhstn: org.example/media/index.GET_3fbb_C200C_1970-01-01_001640000_0.htm
rhupnq_mhstn: org.example/view/index?one=1&two=2&three=3.GET_5658_C200C_1970-01-01_001640000_0.htm
rhupnq_mhstn: org.example.königsgäßchen/index.GET_4f11_C200C_1970-01-01_001640000_0.html
rhupnq_mhstn: org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C_1970-01-01_001640000_0.htm
rhupnq_mhstn: ==
rhupnq_mhstn: ==
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
flat_tn:      example.org/index.1970-01-01_001640000_0.htm
flat_tn:      ==
flat_tn:      example.org/index.1970-01-01_001640000_0.html
flat_tn:      example.org/media__index.1970-01-01_001640000_0.htm
flat_tn:      ==
flat_tn:      example.org/view__index?one=1&two=2&three=3.1970-01-01_001640000_0.htm
flat_tn:      königsgäßchen.example.org/index.1970-01-01_001640000_0.html
flat_tn:      ジャジェメント.ですの.example.org/испытание__is__index.1970-01-01_001640000_0.htm
flat_tn:      ==
flat_tn:      ==
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
flat_mstn:    example.org/index.GET_C200C_1970-01-01_001640000_0.htm
flat_mstn:    ==
flat_mstn:    example.org/index.GET_C200C_1970-01-01_001640000_0.html
flat_mstn:    example.org/media__index.GET_C200C_1970-01-01_001640000_0.htm
flat_mstn:    ==
flat_mstn:    example.org/view__index?one=1&two=2&three=3.GET_C200C_1970-01-01_001640000_0.htm
flat_mstn:    königsgäßchen.example.org/index.GET_C200C_1970-01-01_001640000_0.html
flat_mstn:    ジャジェメント.ですの.example.org/испытание__is__index.GET_C200C_1970-01-01_001640000_0.htm
flat_mstn:    ==
flat_mstn:    ==
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
flat_mhstn:   example.org/index.GET_8198_C200C_1970-01-01_001640000_0.htm
flat_mhstn:   ==
flat_mhstn:   example.org/index.GET_f0dc_C200C_1970-01-01_001640000_0.html
flat_mhstn:   example.org/media__index.GET_086d_C200C_1970-01-01_001640000_0.htm
flat_mhstn:   example.org/media__index.GET_3fbb_C200C_1970-01-01_001640000_0.htm
flat_mhstn:   example.org/view__index?one=1&two=2&three=3.GET_5658_C200C_1970-01-01_001640000_0.htm
flat_mhstn:   königsgäßchen.example.org/index.GET_4f11_C200C_1970-01-01_001640000_0.html
flat_mhstn:   ジャジェメント.ですの.example.org/испытание__is__index.GET_c4ae_C200C_1970-01-01_001640000_0.htm
flat_mhstn:   ==
flat_mhstn:   ==
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
                       output_format : _t.AnyStr,
                       action : str,
                       actioning : str,
                       defer : _t.Callable[[ReqresExpr[DeferredSourceType], _t.AnyStr, bool, bool],
                                           DeferredOperation[ReqresExpr[DeferredSourceType], _t.AnyStr]],
                       allow_updates : bool,
                       moving : bool = False,
                       symlinking : bool = False) \
        -> tuple[_t.Callable[[ReqresExpr[DeferredSourceType]], None],
                 _t.Callable[[], None]]:
    terminator = cargs.terminator if cargs.dry_run is not None else None

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
        if terminator is not None:
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
                stdout.write_bytes(terminator)

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
        new_source = new_rrexpr.source
        if isinstance(new_source, FileSource) and new_source.path == abs_out_path:
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
                        abs_in_path = _os.path.realpath(abs_out_path)

                        if isinstance(new_source, FileSource) and new_source.path == abs_out_path:
                            # similarly to the above
                            return True, prev_rrexpr, None
                elif not allow_updates and symlinking:
                    raise Failure("destination exists and is not a symlink" + not_allowed)
                else:
                    out_stat = out_lstat
                    abs_in_path = abs_out_path

            # (SETSRC)
            old_rrexpr = rrexpr_wrr_loadf(abs_in_path, out_stat)
            old_rrexpr.sniff = cargs.sniff
        else:
            old_rrexpr = prev_rrexpr

        intent = defer(old_rrexpr, abs_out_path, False, allow_updates)
        permitted = intent.switch_source(new_rrexpr, moving)
        return permitted, intent.source, (intent if intent.source is not old_rrexpr else None)

    def emit(new_rrexpr : ReqresExpr[DeferredSourceType]) -> None:
        if want_stop: raise KeyboardInterrupt()

        new_rrexpr.values["num"] = 0
        def_out_path = output_format % new_rrexpr
        prev_rel_out_path = None
        while True:
            new_rrexpr.values["num"] = seen_counter.count(def_out_path)
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
                    updated_rrexpr.unload()
            else:
                mem.consumption -= intent.approx_size() + len(abs_out_path)
                permitted = intent.switch_source(new_rrexpr, moving) # (switchSource)
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
                if terminator is not None:
                    stdout.write(abs_out_path)
                    stdout.write_bytes(terminator)

            break

        if not cargs.lazy:
            flush_updates(False)

    return emit, finish_updates

def make_organize_emit(cargs : _t.Any, destination : _t.AnyStr, output_format : _t.AnyStr, allow_updates : bool) \
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
            if isinstance(source, FileSource) and source.path == self.destination:
                # noop, this could happen after (switchSource)
                return

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

    return make_deferred_emit(cargs, destination, output_format, action, actioning, DeferredOrganize, allow_updates, moving, symlinking)

def cmd_organize(cargs : _t.Any) -> None:
    if cargs.walk_paths == "unset":
        cargs.walk_paths = None if not cargs.allow_updates else False
    if cargs.walk_fs == "unset":
        cargs.walk_fs = True if not cargs.allow_updates else False

    output_format = elaborate_output("--output", output_alias, cargs.output) + ".wrr"
    handle_paths(cargs)

    rrexprs_load = mk_rrexprs_load(cargs)
    _num, filters_allow, filters_warn = compile_filters(cargs)

    emit : EmitFunc[ReqresExpr[FileSource]]
    if cargs.destination is not None:
        # destination is set explicitly
        emit, finish = make_organize_emit(cargs, _os.path.expanduser(cargs.destination), output_format, cargs.allow_updates)
        try:
            map_wrr_paths(cargs, rrexprs_load, filters_allow, emit, cargs.paths)
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
            emit, finish = make_organize_emit(cargs, exp_path, output_format, False)
            try:
                map_wrr_paths(cargs, rrexprs_load, filters_allow, emit, [exp_path])
            finally:
                finish()

    filters_warn()

def cmd_import_generic(cargs : _t.Any,
                       rrexprs_loadf : _t.Callable[[str | bytes], _t.Iterator[ReqresExpr[DeferredSourceType]]]) -> None:
    output_format = elaborate_output("--output", output_alias, cargs.output) + ".wrr"
    handle_paths(cargs)

    _num, filters_allow, filters_warn = compile_filters(cargs)

    emit : EmitFunc[ReqresExpr[DeferredSourceType]]
    emit, finish = make_deferred_emit(cargs, cargs.destination, output_format, "import", "importing", DeferredFileWrite, cargs.allow_updates)
    try:
        map_wrr_paths(cargs, rrexprs_loadf, filters_allow, emit, cargs.paths)
    finally:
        finish()

    filters_warn()

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

    handle_paths(cargs)
    elaborate_paths(cargs.boring)

    destination = _os.path.expanduser(cargs.destination)
    output_format = elaborate_output("--output", output_alias, cargs.output)

    max_depth : int = cargs.depth
    sniff = cargs.sniff
    allow_updates = cargs.allow_updates == True
    skip_existing = cargs.allow_updates == "partial"

    mem = Memory()
    seen_counter : SeenCounter[str] = SeenCounter(mem)

    max_memory_mib = cargs.max_memory * 1024 * 1024

    @_dc.dataclass
    class Indexed:
        stime : Epoch
        rrexpr : ReqresExpr[_t.Any]
        _abs_out_path : str | None = _dc.field(default = None)

        def __post_init__(self) -> None:
            mem.consumption += 32 + self.rrexpr.approx_size()

        def __del__(self) -> None:
            mem.consumption -= 32 + self.rrexpr.approx_size() + \
                (len(self._abs_out_path) if self._abs_out_path is not None else 0)

        @property
        def abs_out_path(self) -> str:
            abs_out_path = self._abs_out_path
            if abs_out_path is not None:
                return abs_out_path

            rrexpr = self.rrexpr
            rrexpr.values["num"] = 0
            def_out_path = output_format % rrexpr
            rrexpr.values["num"] = seen_counter.count(def_out_path)
            rel_out_path = _os.path.join(destination, output_format % rrexpr)
            self._abs_out_path = abs_out_path = _os.path.abspath(rel_out_path)
            mem.consumption += len(abs_out_path)
            return abs_out_path

        def unload(self) -> None:
            rrexpr = self.rrexpr
            mem.consumption -= rrexpr.approx_size()
            rrexpr.unload()
            mem.consumption += rrexpr.approx_size()

    NetURLType : _t.TypeAlias = str
    PathType : _t.TypeAlias = str
    PageIDType = tuple[Epoch, NetURLType]
    NetURLOrPageIDType = NetURLType | PageIDType

    # `Indexed` objects migrate from `index` to `queue` or `new_queue`, from
    # `new_queue` to `queue`.
    index : _c.defaultdict[NetURLType, list[Indexed]] = _c.defaultdict(list)
    Queue = _c.OrderedDict[NetURLOrPageIDType, Indexed]
    queue : Queue = _c.OrderedDict()
    done : set[PageIDType] = set()

    class Stats:
        indexed = 0
        n = 0
        doc_n = 0

    multiples : bool
    which : bool | Epoch | None
    multiples, which = cargs.mode

    def is_replaced_by(oobj : Indexed, nobj : Indexed) -> bool:
        if isinstance(which, bool):
            if not which:
                return oobj.stime > nobj.stime
            else:
                return oobj.stime <= nobj.stime
        elif which is not None:
            return abs(which - nobj.stime) < abs(which - oobj.stime)
        else:
            return False

    def from_index(stime : Epoch, net_url : NetURLType, precise : bool) -> Indexed | None:
        iobjs = index.get(net_url, None)
        if iobjs is None:
            # unavailable
            return None

        ilen = len(iobjs)
        if ilen == 1 or not multiples:
            return iobjs[0]
        elif which is not None and not precise:
            if isinstance(which, bool):
                if not which:
                    # `--oldest*`
                    return iobjs[0]
                else:
                    # `--latest*`
                    return iobjs[-1]
            else:
                # `--nearest-*`
                stime = which

        pos = _bisect.bisect_right(iobjs, stime, key=lambda x: x.stime)
        if pos == 0:
            return iobjs[0]
        elif pos >= ilen:
            return iobjs[-1]

        iprev = iobjs[pos - 1]
        inext = iobjs[pos]
        if abs(stime - iprev.stime) < abs(stime - inext.stime):
            return iprev
        else:
            return inext

    def report_queued(stime : Epoch, net_url : NetURLType, pretty_net_url : NetURLType, source : DeferredSourceType, level : int, old_stime : Epoch | None = None) -> None:
        if stdout.isatty:
            stdout.write_bytes(b"\033[33m")
        durl = net_url if pretty_net_url == net_url else f"{net_url} ({pretty_net_url})"
        ispace = " " * (2 * level)
        if old_stime is None:
            stdout.write_str_ln(ispace + gettext(f"queued [%s] %s from %s") % (stime.format(), durl, source.show_source()))
        else:
            stdout.write_str_ln(ispace + gettext(f"requeued [%s] -> [%s] %s from %s") % (old_stime.format(), stime.format(), durl, source.show_source()))
        if stdout.isatty:
            stdout.write_bytes(b"\033[0m")
        stdout.flush()

    root_filters_num, root_filters_allow, root_filters_warn = compile_filters(cargs, "root_")
    have_root_filters = root_filters_num > 0

    def collect(enqueue_all : bool) -> EmitFunc[ReqresExpr[DeferredSourceType]]:
        def emit(rrexpr : ReqresExpr[DeferredSourceType]) -> None:
            reqres = rrexpr.reqres
            response = reqres.response
            if reqres.request.method not in ["GET", "DOM"] or \
               response is None or \
               response.code != 200:
                return

            stime = rrexpr.stime
            net_url = rrexpr.net_url

            nobj = Indexed(stime, rrexpr)

            iobjs = index.get(net_url, None)
            if iobjs is None:
                # first time seeing this `net_url`
                index[net_url] = [nobj]
            elif not multiples:
                if is_replaced_by(iobjs[0], nobj):
                    iobjs[0] = nobj
            else:
                pos = _bisect.bisect_right(iobjs, stime, key=lambda x: x.stime)
                # NB: technically, this is O(N), but in reality this is usually O(1)
                # for us, since most inserts are to the end of the list
                iobjs.insert(pos, nobj)
                Stats.indexed += 1

            unqueued = True
            page_id = (stime, net_url)
            for pid in [net_url, page_id]:
                qobj = queue.get(pid, None)
                if qobj is not None:
                    if is_replaced_by(qobj, nobj):
                        queue[pid] = nobj
                        report_queued(stime, net_url, rrexpr.pretty_net_url, rrexpr.source, 1, qobj.stime)
                    unqueued = False

            if unqueued:
                if enqueue_all or have_root_filters and root_filters_allow(rrexpr):
                    if multiples and which is None:
                        # `--all`
                        pid = page_id
                    else:
                        pid = net_url
                    queue[pid] = nobj
                    report_queued(stime, net_url, rrexpr.pretty_net_url, rrexpr.source, 1)
                    unqueued = False

            if unqueued or mem.consumption > max_memory_mib:
                nobj.unload()
        return emit

    if stdout.isatty:
        stdout.write_bytes(b"\033[32m")
    stdout.write_str_ln(gettext("loading input `PATH`s..."))
    if stdout.isatty:
        stdout.write_bytes(b"\033[0m")
    stdout.flush()

    rrexprs_load = mk_rrexprs_load(cargs)
    _num, filters_allow, filters_warn = compile_filters(cargs)

    seen_paths : set[PathType] = set()
    map_wrr_paths(cargs, rrexprs_load, filters_allow, collect(not have_root_filters), cargs.paths, seen_paths=seen_paths)
    map_wrr_paths(cargs, rrexprs_load, filters_allow, collect(False), cargs.boring, seen_paths=seen_paths)

    if multiples:
        total = Stats.indexed
    else:
        total = len(index)

    depth : int = 0

    def remap_url_fallback(stime : Epoch, expected_content_types : list[str], purl : ParsedURL) -> PathType:
        trrexpr = ReqresExpr(UnknownSource(), fallback_Reqres(purl, expected_content_types, stime, stime, stime))
        trrexpr.values["num"] = 0
        rel_out_path : PathType = _os.path.join(destination, output_format % trrexpr)
        return _os.path.abspath(rel_out_path)

    def render(stime : Epoch,
               net_url : NetURLType,
               rrexpr : ReqresExpr[DeferredSourceType],
               abs_out_path : PathType,
               enqueue : bool,
               new_queue : Queue,
               level : int) -> None:
        done.add((stime, net_url))

        source = rrexpr.source

        level0 = level == 0
        Stats.n += 1
        if level0:
            Stats.doc_n += 1
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
        stdout.write_str_ln(ispace + gettext("stime [%s]") % (stime.format(),))
        stdout.write_str_ln(ispace + gettext("net_url %s") % (net_url,))
        stdout.write_str_ln(ispace + gettext("src %s") % (source.show_source(),))
        if stdout.isatty:
            stdout.write_bytes(b"\033[0m")
        stdout.flush()

        try:
            exists = _os.path.exists(abs_out_path)
            if skip_existing and exists:
                if stdout.isatty:
                    stdout.write_bytes(b"\033[33m")
                stdout.write_str_ln(ispace + gettext("destination exists, skipped!"))
                if stdout.isatty:
                    stdout.write_bytes(b"\033[0m")
                stdout.write_str_ln(ispace + gettext("dst %s") % (abs_out_path,))
                stdout.flush()
                return

            document_dir = _os.path.dirname(abs_out_path)
            remap_cache : dict[tuple[str, bool], str] = dict()

            def remap_url(link_type : LinkType, fallbacks : list[str] | None, url : NetURLType) -> NetURLType | None:
                if want_stop: raise KeyboardInterrupt()

                is_requisite = link_type == LinkType.REQ
                cache_id = (url, is_requisite)
                try:
                    return remap_cache[cache_id]
                except KeyError:
                    pass

                try:
                    purl = parse_url(url)
                except URLParsingError:
                    ispace = " " * (2 * (level + 1))
                    issue(ispace + gettext("malformed URL `%s`"), url)
                    remap_cache[cache_id] = res = get_void_url(link_type)
                    return res

                unet_url = purl.net_url

                if unet_url == net_url:
                    # this is a reference to an inter-page `id`
                    remap_cache[cache_id] = res = purl.ofm + purl.fragment
                    return res
                elif purl.scheme not in Reqres_url_schemes:
                    ispace = " " * (2 * (level + 1))
                    issue(ispace + gettext("not remapping `%s`"), url)
                    remap_cache[cache_id] = url
                    return url

                uobj = from_index(stime, unet_url, is_requisite)
                if uobj is None:
                    # unavailable
                    uabs_out_path = None
                else:
                    ustime = uobj.stime
                    upage_id = (ustime, unet_url)
                    uabs_out_path = uobj.abs_out_path

                    if upage_id in done:
                        # nothing to do
                        # NB: will be unloaded already
                        pass
                    elif is_requisite:
                        # unqueue it
                        for q in [new_queue, queue]:
                            try:
                                del q[upage_id]
                            except KeyError: pass
                            try:
                                del q[unet_url]
                            except KeyError: pass

                        # render it immediately
                        render(ustime, unet_url, uobj.rrexpr, uabs_out_path, enqueue, new_queue, level + 1)
                        uobj.unload()
                    elif upage_id in new_queue or upage_id in queue or \
                         unet_url in new_queue or unet_url in queue:
                        # nothing to do
                        if mem.consumption > max_memory_mib:
                            uobj.unload()
                    elif enqueue:
                        new_queue[upage_id] = uobj
                        report_queued(ustime, unet_url, purl.pretty_net_url, uobj.rrexpr.source, level + 1)
                        if mem.consumption > max_memory_mib:
                            uobj.unload()
                    else:
                        # this will not be exported
                        uabs_out_path = None
                        uobj.unload()
                        # NB: Not setting `uobj._abs_out_path = None` here
                        # because it might be a requisite for another
                        # page. In which case, when not running with
                        # `--remap-all`, this page will void this
                        # `unet_url` unnecessarily, yes.

                if uabs_out_path is None:
                    if fallbacks is not None:
                        uabs_out_path = remap_url_fallback(stime, fallbacks, purl)
                    else:
                        return None

                urel_url = path_to_url(_os.path.relpath(uabs_out_path, document_dir))
                remap_cache[cache_id] = res = urel_url + purl.ofm + purl.fragment
                return res

            rrexpr.remap_url = remap_url

            data : bytes
            with TIOWrappedWriter(_io.BytesIO()) as f:
                print_exprs(rrexpr, cargs.exprs, cargs.separator, f)
                data = f.fobj.getvalue()

            if exists and file_content_equals(abs_out_path, data):
                # this is a noop overwrite, skip it
                return

            atomic_write(data, abs_out_path, allow_updates)
            stdout.write_str_ln(ispace + gettext("dst %s") % (abs_out_path,))
            stdout.flush()
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

            pid, iobj = queue.popitem(False)
            if isinstance(pid, NetURLType):
                net_url = pid
            else:
                net_url = pid[1]
            render(iobj.stime, net_url, iobj.rrexpr, iobj.abs_out_path, enqueue, new_queue, 0)
            iobj.unload()

        queue = new_queue
        depth += 1

    filters_warn()
    root_filters_warn()

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

    fmt.start_section(_("Get first 2 bytes (4 characters) of a hex digest of sha256 hash computed on the URL without the fragment/hash part"))
    fmt.add_code(f'{__prog__} get -e "net_url|to_ascii|sha256|take_prefix 2|to_hex" ../simple_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_("Pipe response body from a given `WRR` file to stdout, but less efficiently, by generating a temporary file and giving it to `cat`"))
    fmt.add_code(f"{__prog__} run cat ../simple_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_text(_(f"Thus `{__prog__} run` can be used to do almost anything you want, e.g."))
    fmt.add_code(f"{__prog__} run less ../simple_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_code(f"{__prog__} run -- sort -R ../simple_server/pwebarc-dump/path/to/file.wrr")
    fmt.add_code(f"{__prog__} run -n 2 -- diff -u ../simple_server/pwebarc-dump/path/to/file-v1.wrr ../simple_server/pwebarc-dump/path/to/file-v2.wrr")
    fmt.end_section()

    fmt.start_section(_(f"""List paths of all `WRR` files from `../simple_server/pwebarc-dump` that contain complete `200 OK` responses with `text/html` bodies larger than 1K"""))
    fmt.add_code(f"""{__prog__} find --status-re .200C --response-mime text/html --and "response.body|len|> 1024" ../simple_server/pwebarc-dump""")
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
_("Glossary: a `reqres` (`Reqres` when a Python type) is an instance of a structure representing `HTTP` request+response pair with some additional metadata."),
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

    date_spec = _("; the `DATE` can be specified either as a number of seconds since UNIX epoch using `@<number>` format where `<number>` can be a floating point, or using one of the following formats:`YYYY-mm-DD HH:MM:SS[.NN*] (+|-)HHMM`, `YYYY-mm-DD HH:MM:SS[.NN*]`, `YYYY-mm-DD HH:MM:SS`, `YYYY-mm-DD HH:MM`, `YYYY-mm-DD`, `YYYY-mm`, `YYYY`; if no `(+|-)HHMM` part is specified, the `DATE` is assumed to be in local time; if other parts are unspecified they are inherited from `<year>-01-01 00:00:00.0`")
    date_spec_id = _("; the `DATE` format is the same as above")
    fullmatch_re = _("; this option matches the given regular expression against the whole input value; to match against any part of the input value, use `.*<re>.*` or `^.*<re>.*$`")
    ie_whitelist = _("; in short, this option defines a whitelisted element rule")
    ie_blacklist = _("; in short, this option defines a blacklisted element rule")

    def add_filter_options(cmd : _t.Any) -> None:
        agrp = cmd.add_argument_group("filtering options")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument(f"--ignore-case", dest="ignore_case", action="store_const", const=True, help=_(f"when filtering with `--*grep*`, match case-insensitively"))
        grp.add_argument(f"--case-sensitive", dest="ignore_case", action="store_const", const=False, help=_(f"when filtering with `--*grep*`, match case-sensitively"))
        grp.add_argument(f"--smart-case", dest="ignore_case", action="store_const", const=None, help=_(f"when filtering with `--*grep*`, match case-insensitively if there are no uppercase letters in the corresponding `*PATTERN*` option argument and case-sensitively otherwise; default"))

    def add_filters(cmd : _t.Any, do_what : str, root : bool = False) -> None:
        if not root:
            intro = gettext("input filters; if none are specified, then all reqres from input `PATH`s will be taken")
            opt_prefix = ""
            attr_prefix = ""
            root_short = []
        else:
            intro = gettext("recursion root filters; if none are specified, then all URLs available from input `PATH`s will be treated as roots (except for those given via `--boring`)")
            opt_prefix = "root-"
            attr_prefix = "root_"
            root_short = ["--root", "-r"]

        agrp = cmd.add_argument_group(intro + gettext(f"""; can be specified multiple times in arbitrary combinations; the resulting logical expression that will be checked is `all_of(before) and all_of(not_before) and all_of(after) and all_of(not_after) and any_of(protocol) and not any_of(not_protcol) and any_of(request_method) and not any_of(not_request_method) ... and any_of(grep) and not any_of(not_grep) and all_of(and_grep) and not all_of(not_and_grep) and all_of(ands) and any_of(ors)`"""))

        def add_time_filter(opt : str, what : str, sub : str) -> None:
            agrp.add_argument(f"--{opt_prefix}{opt}", metavar="DATE", action="append", type=str, default = [], help=_(f"{do_what} its `stime` is {what} than this") + sub)

        add_time_filter("before", "smaller", date_spec)
        add_time_filter("not-before", "larger or equal", date_spec_id)
        add_time_filter("after", "larger", date_spec_id)
        add_time_filter("not-after", "smaller or equal", date_spec_id)

        def map_opts(suffix : str, *opts : str) -> list[str]:
            return list(map(lambda opt: f"--{opt_prefix}{opt}{suffix}", opts))

        def add_str_filter(opt : str, yes : bool,
                           what : str, what_p : str, what_re : str,
                           *,
                           short : list[str] = [],
                           abs_short : list[str] = [], abs_short_p : list[str] = [], abs_short_re : list[str] = [],
                           sub : str = "", sub_p : str = "", sub_re : str = "") -> None:
            metavar = opt.upper().replace("-", "_")
            if yes:
                one_of, is_equal_to, is_a_prefix, matches, wb = "one of", "is equal to", "is a prefix", "matches", ie_whitelist
            else:
                one_of, is_equal_to, is_a_prefix, matches, wb = "none of", "are equal to", "are a prefix", "match", ie_blacklist

            agrp.add_argument(*map_opts("", opt, *short), *abs_short, metavar=metavar, action="append", type=str, default = [], help=_(f"{do_what} {one_of} the given `{metavar}` option arguments {is_equal_to} its {what}") + sub + wb)
            agrp.add_argument(*map_opts("-prefix", opt, *short), *abs_short_p, metavar=f"{metavar}_PREFIX", action="append", type=str, default = [], help=_(f"{do_what} {one_of} the given `{metavar}_PREFIX` option arguments {is_a_prefix} of its {what_p}") + sub_p + wb)
            agrp.add_argument(*map_opts("-re", opt, *short), *abs_short_re, metavar=f"{metavar}_RE", action="append", type=str, default = [], help=_(f"{do_what} {one_of} the given `{metavar}_RE` regular expressions {matches} its {what_re}") + sub_re + wb)

        def add_yn_str_filter(opt : str, *args : _t.Any, **kwargs : _t.Any) -> None:
            add_str_filter(opt, True, *args, **kwargs)
            kwargs["short"] = map(lambda opt: "not-" + opt, kwargs.get("short", []))
            add_str_filter("not-" + opt, False, *args, **kwargs)

        def add_field_filter(opt : str, field : str, *args : _t.Any, **kwargs : _t.Any) -> None:
            what = f"`{field}` (of `{__prog__} get --expr`, which see)"
            kwargs["sub_re"] = kwargs["sub_re"] + " " + fullmatch_re if "sub_re" in kwargs else fullmatch_re
            add_yn_str_filter(opt, what, what, what, *args, **kwargs)

        add_field_filter("protocol", "protocol")
        add_field_filter("request-method", "request.method", short = ["method"])
        add_field_filter("status", "status")

        mixed_url_allowed = (_("; Punycode UTS46 IDNAs, plain UNICODE IDNAs, percent-encoded URL components, and UNICODE URL components in arbitrary mixes and combinations are allowed; e.g. `%s` will be silently normalized into its Punycode UTS46 and percent-encoded version of `%s`, which will then be matched against") % (example_url[-1], example_url[-2])).replace('%', '%%')
        similarly_allowed = _("; similarly to the previous option, arbitrary mixes of URL encodinds are allowed")
        unmixed_reurl_allowed = _("; only Punycode UTS46 IDNAs with percent-encoded URL components or plain UNICODE IDNAs with UNICODE URL components are allowed; regular expressions that use mixes of differently encoded parts will fail to match properly")
        same_allowed = _("; option argument format and caveats are idential to the `not-`less option above")

        def add_url_filter(opt : str, field : str, yes : bool, **kwargs : _t.Any) -> None:
            what = f"`{field}` (of `{__prog__} get --expr`, which see)"
            add_str_filter(opt, yes,
                           what, what,
                           f"`{field}` or `pretty_{field}` (of `{__prog__} get --expr`, which see)",
                           sub = mixed_url_allowed if yes else same_allowed,
                           sub_p = similarly_allowed if yes else same_allowed,
                           sub_re = unmixed_reurl_allowed + fullmatch_re if yes else same_allowed,
                           **kwargs)

        add_url_filter("url", "net_url", True, abs_short_p = root_short)
        add_url_filter("not-url", "net_url", False)

        def add_grep_filter(opt : str, metavar : str,
                            what: str, what_re : str,
                            short : list[str] = [], short_re : list[str] = [],
                            sub : str = "", sub_re : str = "") -> None:
            agrp.add_argument(*map_opts("", opt, *short), metavar=metavar, action="append", type=str, default = [], help=_(f"{do_what} {what}") + sub)
            agrp.add_argument(*map_opts("-re", opt, *short), metavar=f"{metavar}_RE", action="append", type=str, default = [], help=_(f"{do_what} {what_re}") + sub_re)

        grep_headers = _("; each `HTTP` header of `*.headers` is matched as a single `<header_name>: <header_value>` value")
        grep_binary =  _("; at the moment, binary values are matched against given option arguments by encoding the latter into `UTF-8` first, which means that `*.headers` and `*.body` values that use encodings other than `UTF-8` are not guaranteed to match properly")
        def add_greps(prefix : str, opt : str, multi : bool, what : str, what_id : str, sub : str, sub_id : str) -> None:
            if not multi:
                mall, many, msome, mel = "", "", "", ""
            else:
                mall = "at least one of the elements of "
                many = "any of the elements of "
                msome = "some element of "
                mel = "the elements of "

            add_grep_filter(f"{prefix}or-{opt}", "OR_PATTERN",
                            f"at least one of the given `OR_PATTERN` option arguments is a substring of {mall}{what}",
                            f"at least one of the given `OR_PATTERN_RE` regular expressions matches a substring of {mall}{what_id}",
                            short = [f"{prefix}{opt}"],
                            sub = sub + ie_whitelist, sub_re = sub_id + ie_whitelist)
            add_grep_filter(f"not-{prefix}or-{opt}", "NOT_OR_PATTERN",
                            f"none of the given `NOT_OR_PATTERN` option arguments are substrings of {many}{what_id}",
                            f"none of the given `NOT_OR_PATTERN_RE` regular expressions match any substrings of {many}{what_id}",
                            short = [f"not-{prefix}{opt}"],
                            sub = sub_id + ie_blacklist, sub_re = sub_id + ie_blacklist)

            add_grep_filter(f"{prefix}and-{opt}", "AND_PATTERN",
                            f"each of the given `AND_PATTERN` option arguments is a substring of {msome}{what_id}",
                            f"each of the given `AND_PATTERN_RE` regular expressions matches a substring of {msome}{what_id}",
                            sub = sub_id, sub_re = sub_id)
            add_grep_filter(f"not-{prefix}and-{opt}", "NOT_AND_PATTERN",
                            f"one or more of the given `NOT_AND_PATTERN` option arguments is not a substring of {mel}{what_id}",
                            f"one or more of the given `NOT_AND_PATTERN_RE` regular expressions fails to match any substrings of {mel}{what_id}",
                            sub = sub_id, sub_re = sub_id)

        example_mime = list(canonical_mime_of.items())[0]
        mixed_mime_allowed = _("; both canonical and non-canonical MIME types are allowed; e.g., giving `%s` or `%s` will produce the same predicate") % (example_mime[0], example_mime[1])
        unmixed_pmime_allowed = _("; given prefixes will only ever be matched against canonicalized MIME types")
        unmixed_remime_allowed = _("; given regular expressions will only ever be matched against canonicalized MIME types")

        def add_mime_filter(opt : str, side : str, yes : bool) -> None:
            what = f"`{side}_mime` (of `{__prog__} get --expr`, which see)"
            add_str_filter(opt, yes,
                           what, what, what,
                           sub = mixed_mime_allowed if yes else same_allowed,
                           sub_p = unmixed_pmime_allowed if yes else same_allowed,
                           sub_re = unmixed_remime_allowed + fullmatch_re if yes else same_allowed)

        def add_rr_filter(side : str) -> None:
            add_greps(f"{side}-headers-", "grep", True,
                      f"the list containing all `{side}.headers` (of `{__prog__} get --expr`, which see)",
                      "the above list",
                      grep_headers + grep_binary, _("; matching caveats are the same as above"))

            add_greps(f"{side}-body-", "grep", False,
                      f"`{side}.body` (of `{__prog__} get --expr`, which see)",
                      f"`{side}.body`",
                      grep_binary, _("; matching caveats are the same as above"))

            add_mime_filter(f"{side}-mime", side, True)
            add_mime_filter(f"not-{side}-mime", side, False)

        add_rr_filter("request")
        add_rr_filter("response")

        add_greps("", "grep", True,
                  f"the list containing `raw_url`, `url`, `pretty_url`, all `request.headers`, `request.body`, all `response.headers`, and `response.body` (of `{__prog__} get --expr`, which see)",
                  "the above list",
                  grep_headers + grep_binary, _("; matching caveats are the same as above"))

        agrp.add_argument(f"--{opt_prefix}and", metavar="EXPR", action="append", type=str, default = [],
                         help=_(f"{do_what} all of the given expressions of the same format as `{__prog__} get --expr` (which see) evaluate to `true`"))
        agrp.add_argument(f"--{opt_prefix}or", metavar="EXPR", action="append", type=str, default = [],
                         help=_(f"{do_what} some of the given expressions of the same format as `{__prog__} get --expr` (which see) evaluate to `true`"))

    def add_pure(cmd : _t.Any) -> None:
        cmd.add_argument("-q", "--quiet", action="store_true", help=_("don't print end-of-program warnings to stderr"))

    def add_impure(cmd : _t.Any) -> None:
        grp = cmd.add_mutually_exclusive_group()
        grp.add_argument("--dry-run", action="store_true", help=_("perform a trial run without actually performing any changes"))
        grp.add_argument("-q", "--quiet", action="store_true", help=_("don't log computed updates and don't print end-of-program warnings to stderr"))

    def add_common(cmd : _t.Any, kind : str, filter_what : str) -> None:
        add_errors(cmd)
        add_paths(cmd, kind)
        add_sniff(cmd, kind)
        add_filter_options(cmd)
        add_filters(cmd, filter_what)

    def add_abridged(cmd : _t.Any) -> None:
        grp = cmd.add_mutually_exclusive_group()
        grp.add_argument("-u", "--unabridged", dest="abridged", action="store_false", help=_("print all data in full"))
        grp.add_argument("--abridged", action="store_true", help=_("shorten long strings for brevity, useful when you want to visually scan through batch data dumps; default"))
        cmd.set_defaults(abridged = True)

    def add_termsep(cmd : _t.Any, name : str, what : str = "printing of `--expr` values", whatval : str = "print `--expr` values", allow_not : bool = True, allow_none : bool = False, short : bool = True) -> None:
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

    def add_paths(cmd : _t.Any, kind : str) -> None:
        def_paths : bool | str | None
        def_walk : bool | str | None
        if kind == "organize":
            def_def = "; " + _("default when `--no-overwrites`")
            def_sup = "; " + _("default when `--latest`")
            def_paths = "unset"
            def_walk = "unset"
        else:
            def_def = "; " + _("default")
            def_sup = ""
            def_paths = None
            def_walk = True

        agrp = cmd.add_argument_group("path ordering")
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

        agrp = cmd.add_argument_group("input loading")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--load-any", dest="loader", action="store_const", const=None, help=_("for each given input `PATH`, decide which loader to use based on its file extension; default"))
        grp.add_argument("--load-wrr", dest="loader", action="store_const", const="wrr", help=_("load all inputs using the single-`WRR` per-file loader"))
        grp.add_argument("--load-wrrb", dest="loader", action="store_const", const="wrr", help=_("load all inputs using the `WRR` bundle loader, this will load separate `WRR` files as single-`WRR` bundles too"))
        grp.add_argument("--load-mitmproxy", dest="loader", action="store_const", const="mitmproxy", help=_("load inputs using the `mitmproxy` dump loader"))
        grp.set_defaults(loader = None)

        agrp.add_argument("--stdin0", action="store_true", help=_("read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments"))

        if kind == "export mirror":
            agrp.add_argument("--boring", metavar="PATH", action="append", type=str, default = [], help=_("low-priority input `PATH`; boring `PATH`s will be processed after all `PATH`s specified as positional command-line arguments and those given via `--stdin0` and will not be queued as roots even when no `--root-*` options are specified"))

        agrp.add_argument("paths", metavar="PATH", nargs="*", type=str, help=_("inputs, can be a mix of files and directories (which will be traversed recursively)"))

    def add_sniff(cmd : _t.Any, kind : str) -> None:
        oscrub = f"this influeences generated file names because `filepath_parts` and `filepath_ext` of `{__prog__} get --expr` (which see) depend on both the original file extension present in the URL and the detected `MIME` type of its content"
        wscrub = "higher values make the `scrub` function (which see) censor out more things when `-unknown`, `-styles`, or `-scripts` options are set; in particular, at the moment, with `--sniff-paranoid` and `-scripts` most plain text files will be censored out as potential `JavaScript`"
        if kind == "pprint":
            what = "this simply populates the `potentially` lists in the output in various ways"
        elif kind == "organize" or kind == "import":
            what = oscrub
        elif kind != "export mirror":
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
    add_pure(cmd)
    add_common(cmd, "pprint", "pretty-print reqres when")
    add_abridged(cmd)
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
            agrp.add_argument("-e", "--expr", dest="mexprs", metavar="EXPR", action=AddExprFd, type=str, default = {}, help=_(f'an expression to compute; can be specified multiple times in which case computed outputs will be printed sequentially (see also "printing" options below); the default depends on `--remap-*` options below') + \
                _("; each `EXPR` describes a state-transformer (pipeline) which starts from value `None` and evaluates a script built from the following") + ":\n" + \
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
- `net_url|to_ascii|sha256|to_hex` will print a hexadecimal representation of the `sha256` hash of the URL that was actually sent over the network;
- `net_url|to_ascii|sha256|take_prefix 2|to_hex` will print the first 2 bytes (4 characters) of the above;
- `path_parts|take_prefix 3|pp_to_path` will print first 3 path components of the URL, minimally quoted to be used as a path;
- `query_ne_parts|take_prefix 3|qsl_to_path|abbrev 128` will print first 3 non-empty query parameters of the URL, abbreviated to 128 characters or less, minimally quoted to be used as a path;""", 2) + \
                "\n\nExample URL mappings:\n" + \
                "".join([f"  - `{name}`:\n" + atom_example(name, 4) + "\n" for name in atom_test])
            )
        else:
            agrp.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action=AddExpr, type=str, default = [], help=_(f"an expression to compute, same expression format and semantics as `{__prog__} get --expr` (which see); can be specified multiple times; the default depends on `--remap-*` options below"))

        if kind == "stream":
            add_terminator(cmd, "`--format=raw` `--expr` printing", "print `--format=raw` `--expr` output values")
        elif kind != "export mirror":
            add_separator(cmd)
        else:
            add_separator(cmd, "exporting of `--expr`", "export `--expr` values", short = False)

        def alias(what : str) -> str:
            return _("set the default value of `--expr` to `%s`") % (default_expr[what],)

        agrp = cmd.add_argument_group("default value of `--expr`")
        grp = agrp.add_mutually_exclusive_group()

        if kind != "export mirror":
            grp.add_argument("--no-remap", dest="default_expr", action="store_const", const=kind, help=alias(kind) + _("; i.e. produce the raw response body; default"))

        grp.add_argument("--remap-id", dest="default_expr", action="store_const", const="id", help=alias("id") + _("; i.e. remap all URLs of response body with an identity function (which, as a whole, is NOT an identity function, it will transform all relative URLs into absolute ones) and will censor out all dynamic content (e.g. `JavaScript`); results will NOT be self-contained"))
        grp.add_argument("--remap-void", dest="default_expr", action="store_const", const="void", help=alias("void") + _("; i.e. remap all URLs of response body into `javascript:void(0)` and empty `data:` URLs and censor out all dynamic content; results will be self-contained"))

        if kind != "export mirror":
            cmd.set_defaults(default_expr = kind)
        else:
            grp.add_argument("--remap-open", "-k", "--convert-links", dest="default_expr", action="store_const", const="open", help=alias("open") + _("; i.e. remap all URLs of response body present in input `PATH`s and reachable from `--root-*`s in no more that `--depth` steps to their corresponding `--output` paths, remap all other URLs like `--remap-id` does, and censor out all dynamic content; results almost certainly will NOT be self-contained"))
            grp.add_argument("--remap-closed", dest="default_expr", action="store_const", const="open", help=alias("closed") + _("; i.e. remap all URLs of response body present in input `PATH`s and reachable from `--root-*`s in no more that `--depth` steps to their corresponding `--output` paths, remap all other URLs like `--remap-void` does, and censor out all dynamic content; results will be self-contained"))
            grp.add_argument("--remap-semi", dest="default_expr", action="store_const", const="semi", help=alias("semi") + _("; i.e. remap all jump links of response body like `--remap-open` does, remap action links and references to page requisites like `--remap-closed` does, and censor out all dynamic content; this is a better version of `--remap-open` which keeps the `export`ed `mirror`s self-contained with respect to page requisites, i.e. generated pages can be opened in a web browser without it trying to access the Internet, but all navigations to missing and unreachable URLs will still point to the original URLs; results will be semi-self-contained"))
            grp.add_argument("--remap-all", dest="default_expr", action="store_const", const="all", help=alias("all") + _(f"""; i.e. remap all links and references of response body like `--remap-closed` does, except, instead of voiding missing and unreachable URLs, replace them with fallback URLs whenever possble, and censor out all dynamic content; results will be self-contained; default

`{__prog__} export mirror` uses `--output` paths of trivial `GET <URL> -> 200 OK` as fallbacks for `&(jumps|actions|reqs)` options of `scrub`.
This will remap links pointing to missing and unreachable URLs to missing files.
However, for simple `--output` formats (like the default `hupq`), those files can later be generated by running `{__prog__} export mirror` with `WRR` files containing those missing or unreachable URLs as inputs.
I.e. this behaviour allows you to add new data to an already `export`ed mirror without regenerating old files that reference newly added URLs.
I.e. this allows `{__prog__} export mirror` to be used incrementally.

Note however, that using fallbacks when the `--output` format depends on anything but the URL itself (e.g. if it mentions timestamps) will produce a mirror with unrecoverably broken links.
"""))
            cmd.set_defaults(default_expr = "all")

    # get
    cmd = subparsers.add_parser("get", help=_("print values produced by computing given expressions on a given `WRR` file"),
                                description = _(f"""Compute output values by evaluating expressions `EXPR`s on a given reqres stored at `PATH`, then print them to stdout terminating each value as specified."""))

    add_sniff(cmd, "get")
    add_expr(cmd, "get")

    cmd.add_argument("path", metavar="PATH", type=str, help=_("input `WRR` file path"))
    cmd.set_defaults(func=cmd_get)

    # run
    cmd = subparsers.add_parser("run", help=_("spawn a process with generated temporary files produced by given expressions computed on given `WRR` files as arguments"),
                                description = _("""Compute output values by evaluating expressions `EXPR`s for each of `NUM` reqres stored at `PATH`s, dump the results into into newly generated temporary files terminating each value as specified, spawn a given `COMMAND` with given arguments `ARG`s and the resulting temporary file paths appended as the last `NUM` arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process."""))

    add_sniff(cmd, "run")
    add_expr(cmd, "run")

    cmd.add_argument("-n", "--num-args", metavar="NUM", type=int, default = 1, help=_("number of `PATH`s; default: `%(default)s`"))
    cmd.add_argument("command", metavar="COMMAND", type=str, help=_("command to spawn"))
    cmd.add_argument("args", metavar="ARG", nargs="*", type=str, help=_("additional arguments to give to the `COMMAND`"))
    cmd.add_argument("paths", metavar="PATH", nargs="+", type=str, help=_("input `WRR` file paths to be mapped into new temporary files"))
    cmd.set_defaults(func=cmd_run)

    # stream
    cmd = subparsers.add_parser("stream", help=_(f"produce a stream of structured lists containing values produced by computing given expressions on given `WRR` files, a generalized `{__prog__} get`"),
                                description = _("""Compute given expressions for each of given `WRR` files, encode them into a requested format, and print the result to stdout."""))
    add_pure(cmd)
    add_common(cmd, "stream", "stream-print reqres when")
    add_abridged(cmd)
    cmd.add_argument("--format", choices=["py", "cbor", "json", "raw"], default="py", help=_("""generate output in:
- py: Pythonic Object Representation aka `repr`; default
- cbor: Concise Binary Object Representation aka `CBOR` (RFC8949)
- json: JavaScript Object Notation aka `JSON`; **binary data can't be represented, UNICODE replacement characters will be used**
- raw: concatenate raw values; termination is controlled by `*-terminated` options
"""))
    add_expr(cmd, "stream")
    cmd.set_defaults(func=cmd_stream)

    # find
    cmd = subparsers.add_parser("find", help=_("print paths of `WRR` files matching specified criteria"),
                                description = _(f"""Print paths of `WRR` files matching specified criteria."""))
    add_pure(cmd)
    add_common(cmd, "find", "print path of reqres when")
    add_terminator(cmd, "found files printing", "print absolute paths of matching `WRR` files", allow_not=False)
    cmd.set_defaults(sniff = SniffContentType.NONE)
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
        elif kind == "import" or kind == "export mirror":
            if kind != "export mirror":
                def_def = "default"
            else:
                def_def = "hupq_n"

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
        elif kind == "export mirror":
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
    add_organize_memory(cmd)
    add_impure(cmd)
    add_common(cmd, "organize", "organize reqres when")

    agrp = cmd.add_argument_group("action")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--move", dest="action", action="store_const", const="move", help=_("move source files under `DESTINATION`; default"))
    grp.add_argument("--copy", dest="action", action="store_const", const="copy", help=_("copy source files to files under `DESTINATION`"))
    grp.add_argument("--hardlink", dest="action", action="store_const", const="hardlink", help=_("create hardlinks from source files to paths under `DESTINATION`"))
    grp.add_argument("--symlink", dest="action", action="store_const", const="symlink", help=_("create symlinks from source files to paths under `DESTINATION`"))
    cmd.set_defaults(action = "move")

    add_fileout(cmd, "organize")

    cmd.set_defaults(func=cmd_organize)

    def add_import_args(cmd : _t.Any) -> None:
        add_organize_memory(cmd, 0, 1024)
        add_impure(cmd)
        add_common(cmd, "import", "import reqres when")
        add_fileout(cmd, "import")

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
    add_export_memory(cmd)
    add_impure(cmd)
    add_common(cmd, "export mirror", "consider reqres for export when")
    add_expr(cmd, "export mirror")

    agrp = cmd.add_argument_group("what gets exported")
    grp = agrp.add_mutually_exclusive_group()

    def which(x : str) -> str:
        return _(f"for each URL, export {x}")

    oldest = which("its oldest available version")
    near = which("an available version that is closest to the given `DATE` value")
    latest = which("its latest available version")
    hybrid = _(", except, for each URL that is a requisite resource, export a version that is time-closest to the referencing document")
    hybrid_long = hybrid + _("; i.e., this will make each exported page refer to requisites (images, media, `CSS`, fonts, etc) that were archived around the time the page itself was archived, even if those requisite resources changed in time; this produces results that are as close to the original web page as possible at the cost of much more memory to `export`")
    hybrid_short = hybrid +  _("; see `--oldest-hybrid` above for more info")

    class EmitNear(argparse.Action):
        def __call__(self, parser : _t.Any, cfg : argparse.Namespace, value : _t.Any, option_string : _t.Optional[str] = None) -> None:
            setattr(cfg, self.dest, self.const(parse_Epoch(value)))

    grp.add_argument("--oldest", dest="mode", action="store_const", const=(False, False), help=oldest)
    grp.add_argument("--oldest-hybrid", dest="mode", action="store_const", const=(True, False), help=oldest + hybrid_long)
    grp.add_argument("--nearest", dest="mode", metavar="DATE", action=EmitNear, const=lambda x: (False, x), help=near + date_spec)
    grp.add_argument("--nearest-hybrid", dest="mode", metavar="DATE", action=EmitNear, const=lambda x: (True, x), help=near + hybrid_short + date_spec_id)
    grp.add_argument("--latest", dest="mode", action="store_const", const=(False, True), help=latest + _("; default"))
    grp.add_argument("--latest-hybrid", dest="mode", action="store_const", const=(True, True), help=latest + hybrid_short)
    grp.add_argument("--all", dest="mode", action="store_const", const=(True, None), help=_("export all available versions of all available URLs; this is likely to take a lot of time and eat a lot of memory!"))
    cmd.set_defaults(mode=(False, True)) # `--latest`

    add_fileout(cmd, "export mirror")

    add_filters(cmd, "take reqres as export root when", True)

    agrp = cmd.add_argument_group("recursion depth")
    agrp.add_argument("-d", "--depth", metavar="DEPTH", type=int, default=0, help=_('maximum recursion depth level; the default is `0`, which means "`--root-*` documents and their requisite resources only"; setting this to `1` will also export one level of documents referenced via jump and action links, if those are being remapped to local files with `--remap-*`; higher values will mean even more recursion'))

    cmd.set_defaults(func=cmd_export_mirror)

    cargs = parser.parse_args(_sys.argv[1:])

    if cargs.help:
        if cargs.markdown:
            parser.set_formatter_class(argparse.MarkdownBetterHelpFormatter)
            print(parser.format_help(8192))
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
        stderr.write_str(str_Exception(exc))
        errorcnt.errors += 1

    stdout.flush()
    stderr.flush()

    if errorcnt.warnings > 0:
        stderr.write_str_ln(ngettext("There was %d warning!", "There were %d warnings!", errorcnt.warnings) % (errorcnt.warnings,))
    if errorcnt.errors > 0:
        stderr.write_str_ln(ngettext("There was %d error!", "There were %d errors!", errorcnt.errors) % (errorcnt.errors,))
        _sys.exit(1)
    _sys.exit(0)

if __name__ == "__main__":
    main()
