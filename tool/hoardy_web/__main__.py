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

"""`main()`."""

import collections as _c
import dataclasses as _dc
import errno as _errno
import hashlib as _hashlib
import io as _io
import json as _json
import logging as _logging
import os as _os
import os.path as _op
import re as _re
import shutil as _shutil
import signal as _signal
import stat as _stat
import subprocess as _subprocess
import sys as _sys
import tempfile as _tempfile
import typing as _t
import urllib.parse as _up

from gettext import gettext

from kisstdlib import *
from kisstdlib import argparse_ext as argparse
from kisstdlib.fs import *
from kisstdlib.io import *
from kisstdlib.parsing import run_parser

from .filter import *
from .wrr import *
from .output import *

__prog__ = "hoardy-web"


def pred_linst(expr: str, func: LinstFunc, rrexpr: ReqresExpr[_t.Any]) -> bool:
    res = rrexpr.eval_func(func)
    if isinstance(res, bool):
        return res
    raise CatastrophicFailure(
        "while evaluating `%s`: expected a value of type `bool`, got `%s`",
        expr,
        repr(res),
    ).elaborate("while processing `%s`", rrexpr.source.show_source())


def make_linst_filter(
    get_attr: _t.Callable[[FilterNameType], list[str]],
    get_optname: _t.Callable[[FilterNameType], str],
    name: FilterNameType,
    yes: bool,
    matches: PredicateMatchesType[str, LinstFunc, ReqresExpr[_t.Any]],
) -> FilterType[ReqresExpr[_t.Any]]:
    compiled = make_conditions(
        str_id, lambda x: linst_compile(x, linst_atom_or_env), get_attr(name)
    )
    num = len(compiled)

    def allows(v: ReqresExpr[_t.Any]) -> bool:
        res = matches(pred_linst, compiled, v)
        return res if yes else not res

    def warn() -> None:
        warn_redundant(get_optname(name), yes, compiled)

    return num, allows, warn


def compile_filters(cargs: _t.Any, attr_prefix: str = "") -> FilterType[ReqresExpr[_t.Any]]:
    opt_prefix = attr_prefix.replace("_", "-")

    def get_attr(x: str) -> _t.Any:
        return getattr(cargs, attr_prefix + x)

    def get_optname(x: str) -> str:
        return f"--{opt_prefix}{x.replace('_', '-')}"

    filters: list[FilterType[ReqresExpr[_t.Any]]] = []

    def add_yn_timestamp_filter(
        name: str, pred: _t.Callable[[str, TimeStamp, ReqresExpr[_t.Any]], bool]
    ) -> None:
        add_yn_filter(filters, get_attr, get_optname, name, make_simple_filter, timestamp, lambda c, v: matches_all(pred, c, v))  # fmt: skip

    def is_before(_k: _t.Any, stime: TimeStamp, rrexpr: ReqresExpr[_t.Any]) -> bool:
        rrstime: TimeStamp = rrexpr.stime
        return rrstime < stime

    def is_after(_k: _t.Any, stime: TimeStamp, rrexpr: ReqresExpr[_t.Any]) -> bool:
        rrstime: TimeStamp = rrexpr.stime
        return stime < rrstime

    add_yn_timestamp_filter("before", is_before)
    add_yn_timestamp_filter("after", is_after)

    def add_yn_field_filter(name: str, field: str | None = None) -> None:
        if field is None:
            field = name

        def get_inputs(rrexpr: ReqresExpr[_t.Any]) -> StrFilterInputType:
            value = rrexpr.get_value(field)
            l = [value] if value is not None else []
            return l, l

        add_yn_filter(filters, get_attr, get_optname, name, make_str_filter, str_id, str_id, get_inputs)  # fmt: skip

    add_yn_field_filter("protocol")
    add_yn_field_filter("request_method", "request.method")
    add_yn_field_filter("status")

    def neturlify(url: str) -> str:
        return parse_url(url).net_url

    def add_yn_url_filter(name: str) -> None:
        def get_inputs(rrexpr: ReqresExpr[_t.Any]) -> StrFilterInputType:
            net_url = rrexpr.net_url
            lnet_url = [net_url]
            return lnet_url, lambda: [net_url, rrexpr.pretty_net_url]

        add_yn_filter(filters, get_attr, get_optname, name, make_str_filter, neturlify, neturlify, get_inputs)  # fmt: skip

    add_yn_url_filter("url")

    def add_yn_headers_grep_filter(
        name: str, field: str, matches: PredicateMatchesType[str, PatternSB, IterSB]
    ) -> None:
        def get_inputs(rrexpr: ReqresExpr[_t.Any]) -> IterSB:
            value = rrexpr.get_value(field)
            if value is not None:
                return get_raw_headers_bytes(value)
            return []

        add_yn_filter(filters, get_attr, get_optname, name, make_grep_filter, cargs.ignore_case, matches, get_inputs)  # fmt: skip

    def add_yn_field_grep_filter(
        name: str, field: str, matches: PredicateMatchesType[str, PatternSB, IterSB]
    ) -> None:
        def get_inputs(rrexpr: ReqresExpr[_t.Any]) -> list[str | bytes]:
            value = rrexpr.get_value(field)
            l = [value] if value is not None else []
            return l

        add_yn_filter(filters, get_attr, get_optname, name, make_grep_filter, cargs.ignore_case, matches, get_inputs)  # fmt: skip

    def add_rr(side: str) -> None:
        add_yn_headers_grep_filter(f"{side}_headers_or_grep", f"{side}.headers", matches_any)
        add_yn_headers_grep_filter(f"{side}_headers_and_grep", f"{side}.headers", matches_all)
        add_yn_field_filter(f"{side}_mime")
        add_yn_field_grep_filter(f"{side}_body_or_grep", f"{side}.body", matches_any)
        add_yn_field_grep_filter(f"{side}_body_and_grep", f"{side}.body", matches_all)

    add_rr("request")
    add_rr("response")

    def add_yn_grep_filter(
        name: str, matches: PredicateMatchesType[str, PatternSB, IterSB]
    ) -> None:
        def get_inputs(rrexpr: ReqresExpr[_t.Any]) -> list[str | bytes]:
            res: list[str | bytes] = [rrexpr.raw_url, rrexpr.url, rrexpr.pretty_url]
            reqres = rrexpr.reqres
            res += get_raw_headers_bytes(reqres.request.headers)
            res.append(reqres.request.body)
            if reqres.response is not None:
                res += get_raw_headers_bytes(reqres.response.headers)
                res.append(reqres.response.body)
            return res

        add_yn_filter(filters, get_attr, get_optname, name, make_grep_filter, cargs.ignore_case, matches, get_inputs)  # fmt: skip

    add_yn_grep_filter("or_grep", matches_any)
    add_yn_grep_filter("and_grep", matches_all)

    filters.append(make_linst_filter(get_attr, get_optname, "and", True, matches_all))
    filters.append(make_linst_filter(get_attr, get_optname, "or", False, matches_any))

    return merge_non_empty_filters(filters)


def compile_expr(expr: str) -> tuple[str, LinstFunc]:
    return (expr, linst_compile(expr, ReqresExpr_lookup))


def elaborate_output(kind: str, aliases: dict[str, str], value: str) -> str:
    try:
        return aliases[value]
    except KeyError:
        pass

    if value.startswith("format:"):
        return value[7:]

    raise CatastrophicFailure(
        'unknown `%s` alias "%s", prepend "format:" if you want it to be interpreted as a Pythonic %%-substutition',
        kind,
        value,
    )


def elaborate_paths(paths: list[str | bytes]) -> None:
    for i, p in enumerate(paths):
        paths[i] = _op.abspath(_op.expanduser(p))


def handle_paths(cargs: _t.Any) -> None:
    if cargs.stdin0:
        paths = stdin.read_all_bytes().split(b"\0")
        last_path = paths.pop()
        if last_path != b"":
            raise Failure("`--stdin0` input format error")
        cargs.paths += paths

    elaborate_paths(cargs.paths)

    if cargs.walk_paths != WalkOrder.NONE:
        cargs.paths.sort(reverse=cargs.walk_paths == WalkOrder.REVERSE)


def handle_ENAMETOOLONG(exc: OSError, name: str | bytes) -> None:
    if exc.errno == _errno.ENAMETOOLONG:
        raise Failure(
            "target file system rejects `%s` as too long: either one of the path components is longer than the maximum allowed file name on the target file system or the whole thing is longer than kernel MAX_PATH",
            fsdecode(name),
        ) from exc


def select_on_error(how: str) -> _t.Callable[[Failure], None]:
    if how == "ignore":
        return noop
    if how == "skip":
        return log_exception_error
    if how == "fail":

        def reraise(exc: Failure, *args: _t.Any, **kwargs: _t.Any) -> None:
            raise CatastrophicFailure(exc) from exc

        return reraise
    assert False


type LoadFFunc[LoadPath, LoadResult] = _t.Callable[[LoadPath], LoadResult]
type EmitFunc[LoadResult] = _t.Callable[[LoadResult], None]


def load_and_emit[AnyStr: (
    str,
    bytes,
), Result](
    load_func: LoadFFunc[AnyStr, Result],
    emit_func: EmitFunc[Result],
    dir_or_file_path: AnyStr,
    *,
    seen_paths: set[AnyStr] | None = None,
    follow_symlinks: bool = True,
    order: WalkOrder = WalkOrder.REVERSE,
    errors: str = "fail",
) -> None:
    on_error = select_on_error(errors)

    if seen_paths is not None:
        abs_dir_or_file_path = _op.abspath(dir_or_file_path)
        if abs_dir_or_file_path in seen_paths:
            return
        seen_paths.add(abs_dir_or_file_path)

    for path, _, _ in iter_subtree(
        dir_or_file_path,
        include_files=with_extension_not_in([".part", b".part"]),
        include_directories=False,
        order=order,
        follow_symlinks=follow_symlinks,
        handle_error=None if errors == "fail" else _logging.error,
    ):
        raise_first_delayed_signal()

        abs_path = _op.abspath(path)
        try:
            if follow_symlinks:
                abs_path = _op.realpath(abs_path)
            elif _op.islink(abs_path):
                raise Failure("input file is a symlink, but symlink inputs are forbidden")

            if (
                seen_paths is not None
                # do not skip top-level paths added above
                and abs_path != abs_dir_or_file_path
            ):
                if abs_path in seen_paths:
                    continue
                seen_paths.add(abs_path)

            try:
                data = load_func(abs_path)
            except OSError as exc:
                raise Failure("failed to open `%s`", fsdecode(path)) from exc

            emit_func(data)
        except Failure as exc:
            on_error(exc.elaborate("while processing `%s`", fsdecode(path)))


def load_and_emit_many[AnyStr: (
    str,
    bytes,
)](
    cargs: _t.Any,
    loadf_func: LoadFFunc[AnyStr, _t.Iterator[ReqresExpr[_t.Any]]],
    filters_allow: _t.Callable[[ReqresExpr[_t.Any]], bool],
    emit_func: EmitFunc[ReqresExpr[_t.Any]],
    paths: list[AnyStr],
    **kwargs: _t.Any,
) -> None:
    def emit_many(rrexprs: _t.Iterator[ReqresExpr[_t.Any]]) -> None:
        for rrexpr in rrexprs:
            raise_first_delayed_signal()

            rrexpr.sniff = cargs.sniff
            if not filters_allow(rrexpr):
                continue
            emit_func(rrexpr)

    for exp_path in paths:
        load_and_emit(
            loadf_func, emit_many, exp_path, order=cargs.walk_fs, errors=cargs.errors, **kwargs
        )


def dispatch_rrexpr_load[AnyStr: (
    str,
    bytes,
)](on_error: _t.Callable[[Failure], None]) -> LoadFFunc[AnyStr, _t.Iterator[ReqresExpr[_t.Any]]]:
    import_failed = []
    have_mitmproxy = False
    try:
        from .mitmproxy import rrexpr_mitmproxy_loadf
    except ImportError as exc:
        import_failed.append(("mitmproxy", get_traceback(exc)))
    else:
        have_mitmproxy = True

    is_wrr: IncludeFilesFunc[AnyStr] = with_extension_in([".wrr", b".wrr"])
    is_wrrb: IncludeFilesFunc[AnyStr] = with_extension_in([".wrrb", b".wrrb"])

    def rrexpr_load(path: AnyStr) -> _t.Iterator[ReqresExpr[_t.Any]]:
        if is_wrr(path):
            yield from rrexpr_wrr_loadf(path, 1, 1, on_error)
        elif is_wrrb(path):
            yield from rrexpr_wrr_loadf(path, 1, None, on_error)
        elif have_mitmproxy:
            yield from rrexpr_mitmproxy_loadf(path, on_error)
        else:
            if import_failed:
                for m, e in import_failed:
                    _logging.warning(gettext("failed to import `%s` parser: %s"), m, e)
                import_failed.clear()
            on_error(Failure("failed to find a suitable parser"))

    return rrexpr_load


def select_rrexpr_loadf[AnyStr: (
    str,
    bytes,
)](cargs: _t.Any) -> LoadFFunc[AnyStr, _t.Iterator[ReqresExpr[_t.Any]]]:
    on_error = select_on_error(cargs.errors)
    loader = cargs.loader
    if loader is None:
        return dispatch_rrexpr_load(on_error)
    if loader == "wrr":
        return lambda path: rrexpr_wrr_loadf(path, 1, 1, on_error)
    if loader == "wrrb":
        return lambda path: rrexpr_wrr_loadf(path, 1, None, on_error)
    if loader == "mitmproxy":
        from .mitmproxy import rrexpr_mitmproxy_loadf

        return lambda path: rrexpr_mitmproxy_loadf(path, on_error)
    assert False


def get_bytes(value: _t.Any) -> bytes:
    if value is None or isinstance(value, (bool, int, float, TimeStamp)):
        value = str(value)

    if isinstance(value, str):
        return value.encode(_sys.getdefaultencoding())
    if isinstance(value, bytes):
        return value

    raise Failure("don't know how to print an expression of type `%s`", type(value).__name__)


def cmd_pprint(cargs: _t.Any) -> None:
    def emit[Source: DeferredSource](rrexpr: ReqresExpr[Source]) -> None:
        wrr_pprint(stdout, rrexpr.reqres, rrexpr.source.show_source(), cargs.abridged, cargs.sniff)
        stdout.flush()

    _num, filters_allow, filters_warn = compile_filters(cargs)
    handle_paths(cargs)
    load_and_emit_many(cargs, select_rrexpr_loadf(cargs), filters_allow, emit, cargs.paths)
    filters_warn()


def print_exprs(
    rrexpr: ReqresExpr[_t.Any],
    exprs: list[tuple[str, LinstFunc]],
    separator: bytes,
    fobj: MinimalIOWriter,
) -> None:
    not_first = False
    for expr, func in exprs:
        try:
            data = get_bytes(rrexpr.eval_func(func))
        except CatastrophicFailure as exc:
            raise exc.elaborate("while evaluating `%s`", expr)

        if not_first:
            fobj.write_bytes(separator)
        not_first = True

        fobj.write_bytes(data)


default_expr_values = {
    "dot": ".",
    "raw_qbody": "request.body|eb",
    "raw_sbody": "response.body|eb",
    "id": "response.body|eb|scrub response +all_refs",
    "void": "response.body|eb|scrub response -all_refs",
    "open": "response.body|eb|scrub response *all_refs",
    "closed": "response.body|eb|scrub response /all_refs",
    "all": "response.body|eb|scrub response &all_refs",
    "semi": "response.body|eb|scrub response *jumps,/actions,/reqs",
}
default_input_status_re = ".(200|30[012378])C"
default_root_status_re = ".[23]00C"


def default_expr(kind: str, what: str) -> str:
    if kind != "serve" or what == "dot" or what.startswith("raw_"):
        return default_expr_values[what]
    return default_expr_values[what] + ",-inline_headers"


def cmd_get(cargs: _t.Any) -> None:
    if len(cargs.mexprs) == 0:
        cargs.mexprs = {stdout: [compile_expr(default_expr("get", cargs.default_expr))]}

    exp_path = _op.expanduser(cargs.path)
    rrexpr = first(rrexpr_wrr_loadf(exp_path, 1, 1))
    rrexpr.sniff = cargs.sniff

    for fobj, exprs in cargs.mexprs.items():
        print_exprs(rrexpr, exprs, cargs.separator, fobj)
        fobj.flush()


def cmd_run(cargs: _t.Any) -> None:
    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_expr("run", cargs.default_expr))]

    if cargs.num_args < 1:
        raise Failure("`run` subcommand requires at least one PATH")
    if cargs.num_args - 1 > len(cargs.args):
        raise Failure("not enough arguments to satisfy `--num-args`")

    # move (num_args - 1) arguments from args to paths
    ntail = len(cargs.args) + 1 - cargs.num_args
    args = cargs.args[:ntail]
    cargs.paths = cargs.args[ntail:] + cargs.paths

    elaborate_paths(cargs.paths)

    tmp_paths = []
    try:
        for exp_path in cargs.paths:
            rrexpr = first(rrexpr_wrr_loadf(exp_path, 1, 1))
            rrexpr.sniff = cargs.sniff

            # TODO: extension guessing
            fileno, tmp_path = _tempfile.mkstemp(prefix="hoardy_wrr_run_", suffix=".tmp")
            tmp_paths.append(tmp_path)

            with TIOWrappedWriter(_os.fdopen(fileno, "wb")) as f:
                print_exprs(rrexpr, cargs.exprs, cargs.separator, f)

        with _subprocess.Popen([cargs.command] + args + tmp_paths) as proc:
            _sys.exit(proc.wait())
    finally:
        for path in tmp_paths:
            _os.unlink(path)


def get_StreamEncoder(cargs: _t.Any) -> StreamEncoder:
    stream: StreamEncoder
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


def cmd_stream(cargs: _t.Any) -> None:
    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_expr("stream", cargs.default_expr))]

    stream = get_StreamEncoder(cargs)

    def emit[Source: DeferredSource](rrexpr: ReqresExpr[Source]) -> None:
        values: list[_t.Any] = []
        for expr, func in cargs.exprs:
            try:
                values.append(rrexpr.eval_func(func))
            except CatastrophicFailure as exc:
                raise exc.elaborate("while evaluating `%s`", expr)
        stream.emit(rrexpr.source.show_source(), cargs.exprs, values)

    _num, filters_allow, filters_warn = compile_filters(cargs)

    handle_paths(cargs)
    stream.start()
    try:
        load_and_emit_many(cargs, select_rrexpr_loadf(cargs), filters_allow, emit, cargs.paths)
    finally:
        stream.finish()

    filters_warn()


def cmd_find(cargs: _t.Any) -> None:
    terminator = cargs.terminator

    def emit[Source: DeferredSource](rrexpr: ReqresExpr[Source]) -> None:
        stdout.write(rrexpr.source.show_source())
        stdout.write_bytes(terminator)
        stdout.flush()

    _num, filters_allow, filters_warn = compile_filters(cargs)

    handle_paths(cargs)
    load_and_emit_many(cargs, select_rrexpr_loadf(cargs), filters_allow, emit, cargs.paths)

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


def make_example(gen: _t.Callable[[str], str], indent: int) -> str:
    rev: dict[str, list[str]] = {}
    for url in example_url:
        current = gen(url)
        try:
            l = rev[current]
        except KeyError:
            l = []
            rev[current] = l
        l.append(url)

    res = []
    for map_to, urls in rev.items():
        res.append(
            " " * indent + "- " + ", ".join(map(lambda x: f"`{x}`", urls)) + " -> `" + map_to + "`"
        )

    return "\n".join(res).replace("%", "%%")


atom_test = [
    "raw_url",
    "net_url",
    "pretty_url",
    "pretty_nurl",
]


def atom_example(name: str, indent: int) -> str:
    return make_example(lambda url: getattr(parse_url(url), name), indent)


# fmt: off
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
    "fallback":      f"{ofdsd}/{ofdms}_%(qtime_ms)s_%(num)d",
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

content_output_alias = {
    "default": "_content/sha256/%(content_sha256|take_prefix 1|to_hex)s/%(content_sha256|to_hex)s%(filepath_ext)s"
}
# fmt: on


def output_example(name: str, indent: int) -> str:
    def gen(url: str) -> str:
        x = ReqresExpr(UnknownSource(), trivial_Reqres(parse_url(url)))
        x.values["num"] = 0
        return output_alias[name] % x

    return make_example(gen, indent)


def test_outputs_aliases() -> None:
    def mk(url: str) -> ReqresExpr[UnknownSource]:
        return ReqresExpr(UnknownSource(), trivial_Reqres(parse_url(url)))

    res = []
    prev = ""
    for name, alias in output_alias.items():
        for url in example_url:
            x = mk(url)
            x.values["num"] = 0
            prefix = name + ":" + " " * (12 - len(name)) + " "
            current = alias % x
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
fallback:     1970/01/01/001640000_0_0
fallback:     ==
fallback:     ==
fallback:     ==
fallback:     ==
fallback:     ==
fallback:     ==
fallback:     ==
fallback:     ==
fallback:     ==
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
surl:         https/example.org/media/
surl:         https/example.org/view?one=1&two=2&three=&three=3
surl:         https/königsgäßchen.example.org/index.html
surl:         https/ジャジェメント.ですの.example.org/испытание/is/
surl:         ==
surl:         ==
surl_msn:     https/example.org/__GET_C200C_0
surl_msn:     ==
surl_msn:     https/example.org/index.html__GET_C200C_0
surl_msn:     https/example.org/media__GET_C200C_0
surl_msn:     https/example.org/media/__GET_C200C_0
surl_msn:     https/example.org/view?one=1&two=2&three=&three=3__GET_C200C_0
surl_msn:     https/königsgäßchen.example.org/index.html__GET_C200C_0
surl_msn:     https/ジャジェメント.ですの.example.org/испытание/is/__GET_C200C_0
surl_msn:     ==
surl_msn:     ==
surl_mstn:    https/example.org/__GET_C200C_1970-01-01_001640000_0
surl_mstn:    ==
surl_mstn:    https/example.org/index.html__GET_C200C_1970-01-01_001640000_0
surl_mstn:    https/example.org/media__GET_C200C_1970-01-01_001640000_0
surl_mstn:    https/example.org/media/__GET_C200C_1970-01-01_001640000_0
surl_mstn:    https/example.org/view?one=1&two=2&three=&three=3__GET_C200C_1970-01-01_001640000_0
surl_mstn:    https/königsgäßchen.example.org/index.html__GET_C200C_1970-01-01_001640000_0
surl_mstn:    https/ジャジェメント.ですの.example.org/испытание/is/__GET_C200C_1970-01-01_001640000_0
surl_mstn:    ==
surl_mstn:    ==
shupq:        https/example.org/index.htm
shupq:        ==
shupq:        https/example.org/index.html
shupq:        https/example.org/media/index.htm
shupq:        ==
shupq:        https/example.org/view/index?one=1&two=2&three=&three=3.htm
shupq:        https/königsgäßchen.example.org/index.html
shupq:        https/ジャジェメント.ですの.example.org/испытание/is/index.htm
shupq:        ==
shupq:        ==
shupq_n:      https/example.org/index.0.htm
shupq_n:      ==
shupq_n:      https/example.org/index.0.html
shupq_n:      https/example.org/media/index.0.htm
shupq_n:      ==
shupq_n:      https/example.org/view/index?one=1&two=2&three=&three=3.0.htm
shupq_n:      https/königsgäßchen.example.org/index.0.html
shupq_n:      https/ジャジェメント.ですの.example.org/испытание/is/index.0.htm
shupq_n:      ==
shupq_n:      ==
shupq_tn:     https/example.org/index.1970-01-01_001640000_0.htm
shupq_tn:     ==
shupq_tn:     https/example.org/index.1970-01-01_001640000_0.html
shupq_tn:     https/example.org/media/index.1970-01-01_001640000_0.htm
shupq_tn:     ==
shupq_tn:     https/example.org/view/index?one=1&two=2&three=&three=3.1970-01-01_001640000_0.htm
shupq_tn:     https/königsgäßchen.example.org/index.1970-01-01_001640000_0.html
shupq_tn:     https/ジャジェメント.ですの.example.org/испытание/is/index.1970-01-01_001640000_0.htm
shupq_tn:     ==
shupq_tn:     ==
shupq_msn:    https/example.org/index.GET_C200C_0.htm
shupq_msn:    ==
shupq_msn:    https/example.org/index.GET_C200C_0.html
shupq_msn:    https/example.org/media/index.GET_C200C_0.htm
shupq_msn:    ==
shupq_msn:    https/example.org/view/index?one=1&two=2&three=&three=3.GET_C200C_0.htm
shupq_msn:    https/königsgäßchen.example.org/index.GET_C200C_0.html
shupq_msn:    https/ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm
shupq_msn:    ==
shupq_msn:    ==
shupq_mstn:   https/example.org/index.GET_C200C_1970-01-01_001640000_0.htm
shupq_mstn:   ==
shupq_mstn:   https/example.org/index.GET_C200C_1970-01-01_001640000_0.html
shupq_mstn:   https/example.org/media/index.GET_C200C_1970-01-01_001640000_0.htm
shupq_mstn:   ==
shupq_mstn:   https/example.org/view/index?one=1&two=2&three=&three=3.GET_C200C_1970-01-01_001640000_0.htm
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
srhupq:       https/org.example/view/index?one=1&two=2&three=&three=3.htm
srhupq:       https/org.example.königsgäßchen/index.html
srhupq:       https/org.example.ですの.ジャジェメント/испытание/is/index.htm
srhupq:       ==
srhupq:       ==
srhupq_n:     https/org.example/index.0.htm
srhupq_n:     ==
srhupq_n:     https/org.example/index.0.html
srhupq_n:     https/org.example/media/index.0.htm
srhupq_n:     ==
srhupq_n:     https/org.example/view/index?one=1&two=2&three=&three=3.0.htm
srhupq_n:     https/org.example.königsgäßchen/index.0.html
srhupq_n:     https/org.example.ですの.ジャジェメント/испытание/is/index.0.htm
srhupq_n:     ==
srhupq_n:     ==
srhupq_tn:    https/org.example/index.1970-01-01_001640000_0.htm
srhupq_tn:    ==
srhupq_tn:    https/org.example/index.1970-01-01_001640000_0.html
srhupq_tn:    https/org.example/media/index.1970-01-01_001640000_0.htm
srhupq_tn:    ==
srhupq_tn:    https/org.example/view/index?one=1&two=2&three=&three=3.1970-01-01_001640000_0.htm
srhupq_tn:    https/org.example.königsgäßchen/index.1970-01-01_001640000_0.html
srhupq_tn:    https/org.example.ですの.ジャジェメント/испытание/is/index.1970-01-01_001640000_0.htm
srhupq_tn:    ==
srhupq_tn:    ==
srhupq_msn:   https/org.example/index.GET_C200C_0.htm
srhupq_msn:   ==
srhupq_msn:   https/org.example/index.GET_C200C_0.html
srhupq_msn:   https/org.example/media/index.GET_C200C_0.htm
srhupq_msn:   ==
srhupq_msn:   https/org.example/view/index?one=1&two=2&three=&three=3.GET_C200C_0.htm
srhupq_msn:   https/org.example.königsgäßchen/index.GET_C200C_0.html
srhupq_msn:   https/org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm
srhupq_msn:   ==
srhupq_msn:   ==
srhupq_mstn:  https/org.example/index.GET_C200C_1970-01-01_001640000_0.htm
srhupq_mstn:  ==
srhupq_mstn:  https/org.example/index.GET_C200C_1970-01-01_001640000_0.html
srhupq_mstn:  https/org.example/media/index.GET_C200C_1970-01-01_001640000_0.htm
srhupq_mstn:  ==
srhupq_mstn:  https/org.example/view/index?one=1&two=2&three=&three=3.GET_C200C_1970-01-01_001640000_0.htm
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
url:          example.org/media/
url:          example.org/view?one=1&two=2&three=&three=3
url:          königsgäßchen.example.org/index.html
url:          ジャジェメント.ですの.example.org/испытание/is/
url:          ==
url:          ==
url_msn:      example.org/__GET_C200C_0
url_msn:      ==
url_msn:      example.org/index.html__GET_C200C_0
url_msn:      example.org/media__GET_C200C_0
url_msn:      example.org/media/__GET_C200C_0
url_msn:      example.org/view?one=1&two=2&three=&three=3__GET_C200C_0
url_msn:      königsgäßchen.example.org/index.html__GET_C200C_0
url_msn:      ジャジェメント.ですの.example.org/испытание/is/__GET_C200C_0
url_msn:      ==
url_msn:      ==
url_mstn:     example.org/__GET_C200C_1970-01-01_001640000_0
url_mstn:     ==
url_mstn:     example.org/index.html__GET_C200C_1970-01-01_001640000_0
url_mstn:     example.org/media__GET_C200C_1970-01-01_001640000_0
url_mstn:     example.org/media/__GET_C200C_1970-01-01_001640000_0
url_mstn:     example.org/view?one=1&two=2&three=&three=3__GET_C200C_1970-01-01_001640000_0
url_mstn:     königsgäßchen.example.org/index.html__GET_C200C_1970-01-01_001640000_0
url_mstn:     ジャジェメント.ですの.example.org/испытание/is/__GET_C200C_1970-01-01_001640000_0
url_mstn:     ==
url_mstn:     ==
hupq:         example.org/index.htm
hupq:         ==
hupq:         example.org/index.html
hupq:         example.org/media/index.htm
hupq:         ==
hupq:         example.org/view/index?one=1&two=2&three=&three=3.htm
hupq:         königsgäßchen.example.org/index.html
hupq:         ジャジェメント.ですの.example.org/испытание/is/index.htm
hupq:         ==
hupq:         ==
hupq_n:       example.org/index.0.htm
hupq_n:       ==
hupq_n:       example.org/index.0.html
hupq_n:       example.org/media/index.0.htm
hupq_n:       ==
hupq_n:       example.org/view/index?one=1&two=2&three=&three=3.0.htm
hupq_n:       königsgäßchen.example.org/index.0.html
hupq_n:       ジャジェメント.ですの.example.org/испытание/is/index.0.htm
hupq_n:       ==
hupq_n:       ==
hupq_tn:      example.org/index.1970-01-01_001640000_0.htm
hupq_tn:      ==
hupq_tn:      example.org/index.1970-01-01_001640000_0.html
hupq_tn:      example.org/media/index.1970-01-01_001640000_0.htm
hupq_tn:      ==
hupq_tn:      example.org/view/index?one=1&two=2&three=&three=3.1970-01-01_001640000_0.htm
hupq_tn:      königsgäßchen.example.org/index.1970-01-01_001640000_0.html
hupq_tn:      ジャジェメント.ですの.example.org/испытание/is/index.1970-01-01_001640000_0.htm
hupq_tn:      ==
hupq_tn:      ==
hupq_msn:     example.org/index.GET_C200C_0.htm
hupq_msn:     ==
hupq_msn:     example.org/index.GET_C200C_0.html
hupq_msn:     example.org/media/index.GET_C200C_0.htm
hupq_msn:     ==
hupq_msn:     example.org/view/index?one=1&two=2&three=&three=3.GET_C200C_0.htm
hupq_msn:     königsgäßchen.example.org/index.GET_C200C_0.html
hupq_msn:     ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm
hupq_msn:     ==
hupq_msn:     ==
hupq_mstn:    example.org/index.GET_C200C_1970-01-01_001640000_0.htm
hupq_mstn:    ==
hupq_mstn:    example.org/index.GET_C200C_1970-01-01_001640000_0.html
hupq_mstn:    example.org/media/index.GET_C200C_1970-01-01_001640000_0.htm
hupq_mstn:    ==
hupq_mstn:    example.org/view/index?one=1&two=2&three=&three=3.GET_C200C_1970-01-01_001640000_0.htm
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
rhupq:        org.example/view/index?one=1&two=2&three=&three=3.htm
rhupq:        org.example.königsgäßchen/index.html
rhupq:        org.example.ですの.ジャジェメント/испытание/is/index.htm
rhupq:        ==
rhupq:        ==
rhupq_n:      org.example/index.0.htm
rhupq_n:      ==
rhupq_n:      org.example/index.0.html
rhupq_n:      org.example/media/index.0.htm
rhupq_n:      ==
rhupq_n:      org.example/view/index?one=1&two=2&three=&three=3.0.htm
rhupq_n:      org.example.königsgäßchen/index.0.html
rhupq_n:      org.example.ですの.ジャジェメント/испытание/is/index.0.htm
rhupq_n:      ==
rhupq_n:      ==
rhupq_tn:     org.example/index.1970-01-01_001640000_0.htm
rhupq_tn:     ==
rhupq_tn:     org.example/index.1970-01-01_001640000_0.html
rhupq_tn:     org.example/media/index.1970-01-01_001640000_0.htm
rhupq_tn:     ==
rhupq_tn:     org.example/view/index?one=1&two=2&three=&three=3.1970-01-01_001640000_0.htm
rhupq_tn:     org.example.königsgäßchen/index.1970-01-01_001640000_0.html
rhupq_tn:     org.example.ですの.ジャジェメント/испытание/is/index.1970-01-01_001640000_0.htm
rhupq_tn:     ==
rhupq_tn:     ==
rhupq_msn:    org.example/index.GET_C200C_0.htm
rhupq_msn:    ==
rhupq_msn:    org.example/index.GET_C200C_0.html
rhupq_msn:    org.example/media/index.GET_C200C_0.htm
rhupq_msn:    ==
rhupq_msn:    org.example/view/index?one=1&two=2&three=&three=3.GET_C200C_0.htm
rhupq_msn:    org.example.königsgäßchen/index.GET_C200C_0.html
rhupq_msn:    org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm
rhupq_msn:    ==
rhupq_msn:    ==
rhupq_mstn:   org.example/index.GET_C200C_1970-01-01_001640000_0.htm
rhupq_mstn:   ==
rhupq_mstn:   org.example/index.GET_C200C_1970-01-01_001640000_0.html
rhupq_mstn:   org.example/media/index.GET_C200C_1970-01-01_001640000_0.htm
rhupq_mstn:   ==
rhupq_mstn:   org.example/view/index?one=1&two=2&three=&three=3.GET_C200C_1970-01-01_001640000_0.htm
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

    # print("\n" + "\n".join(res))

    pl = pristine.strip().split("\n")
    assert len(pl) == len(res)

    for i, b in enumerate(res):
        a = pl[i]
        if a != b:
            raise CatastrophicFailure("expected `%s`, got `%s`", a, b)


not_allowed = "; this is not allowed to prevent accidental data loss"
variance_help = (
    "; your `--output` format fails to provide enough variance to solve this problem automatically (did your forget to place a `%(num)d` substitution in there?)"
    + not_allowed
)


def make_cached_emit[Source: DeferredSource, AnyStr: (
    str,
    bytes,
)](
    cargs: _t.Any,
    action: str,
    actioning: str,
    action_op: _t.Callable[
        [DeferredSource, Reqres, AnyStr, bool | _os.stat_result, bool | Deferred[AnyStr]], None
    ],
    destination: AnyStr,
    output_format: AnyStr,
    remove: bool,
    symlink: bool,
    ideal: TimeStamp | None,
    # `allow_updates is None` means `--keep-duplicates`
    allow_updates: bool | None,
) -> tuple[_t.Callable[[ReqresExpr[Source]], None], _t.Callable[[], None]]:
    """Wrap `action_op` with optional caching, operation deferring, stdio reporting, etc."""

    if remove and not cargs.fsync and not cargs.force:
        raise Failure(
            "this combination of options could loose some your data; run this command with `--please-destroy-my-data` option if you really want to do this"
        )

    on_error = select_on_error(cargs.errors)

    dry_run: bool = cargs.dry_run
    quiet: bool = cargs.quiet
    print_inputs = print_outputs = cargs.print is True
    print_remap = cargs.print == "remap"
    if cargs.print == "inputs":
        print_inputs = True
    if cargs.print == "outputs":
        print_outputs = True
    terminator: bytes = cargs.terminator
    lazy: bool = cargs.lazy if cargs.lazy is not None else dry_run
    defer: bool = cargs.defer

    actioning_new = gettext(actioning)
    removing_dup = gettext("removing duplicate")
    if dry_run:
        actioning_new = gettext("dry-run: (not)") + " " + actioning_new
        removing_dup = gettext("dry-run: (not)") + " " + removing_dup
    actioning_over = actioning_new + " " + gettext("(overwrite)")

    ftype: int = _stat.S_IFLNK if symlink else _stat.S_IFREG

    class Mutable:
        updated: int = 0

    updated_files: list[AnyStr] = []

    RemoveFileSource = tuple[WRRFileSource, bool]
    remove_files: list[RemoveFileSource] = []

    max_cache: int = cargs.cache
    max_batch = cargs.batch
    max_memory: int = cargs.memory * 1024 * 1024

    sync: bool | Deferred[AnyStr]
    if cargs.fsync and max_batch > 0:
        sync = Deferred(False)
        flush_sync = sync.flush
    else:
        sync = cargs.fsync
        flush_sync = noop

    # a `list` of sources that need to be removed after this operation gets synced to disk
    ToRemove = list[tuple[DeferredSource, bool]] | None

    def queue_to_remove(path: AnyStr, to_remove: ToRemove) -> None:
        if to_remove is not None:
            for el in to_remove:
                src, _report = el
                if isinstance(src, WRRFileSource):
                    remove_files.append(_t.cast(RemoveFileSource, el))
                else:
                    mem.consumption -= src.approx_size()
                    issue = Failure("don't know to remove the source, keeping it as-is").elaborate(
                        f"while {actioning} `%s` -> `%s`",
                        src.show_source(),
                        fsdecode(path),
                    )
                    log_exception_warning(issue)

    # a `bool` or `os.stat_result` of the file that should be overwritten
    Overwrite = bool | _os.stat_result

    def run_action(
        source: DeferredSource,
        reqres: Reqres,
        path: AnyStr,
        overwrite: Overwrite,
        to_remove: ToRemove,
    ) -> None:
        """Run `action_op`, handling errors and logging/reporting things as needed."""

        if not quiet:
            stderr.write_str(actioning_new if overwrite is False else actioning_over)
            stderr.write_str(": `")
            stderr.write(source.show_source())
            stderr.write_str("` -> `")
            stderr.write(path)
            stderr.write_str_ln("`")
            stderr.flush()

        try:
            try:
                if not dry_run:
                    action_op(source, reqres, path, overwrite, sync)
            except FileExistsError as exc:
                raise Failure("destination changed between accesses") from exc
            except OSError as exc:
                handle_ENAMETOOLONG(exc, path)
                if exc.errno == _errno.EXDEV:
                    raise Failure(f"can't {action} across file systems") from exc
                raise
        except Failure as exc:
            on_error(
                exc.elaborate(
                    f"while {actioning} `%s` -> `%s`", source.show_source(), fsdecode(path)
                )
            )
        else:
            Mutable.updated += 1

            if print_outputs:
                updated_files.append(path)
                mem.consumption += len(path)

            queue_to_remove(path, to_remove)

    # `fs_path -!> dirty?, source, reqres, overwrite?, to_remove | None`
    # where `None` means "ignore this path"
    cache: OrderedDict[
        AnyStr,
        tuple[bool, DeferredSource, Reqres, Overwrite, ToRemove] | None,
    ] = OrderedDict()

    def want_flush() -> bool:
        return len(cache) > max_cache or mem.consumption > max_memory

    def flush(final: bool) -> None:
        """Flush `cache` and `sync` to disk."""

        if want_flush() or final:
            while len(cache) > 0:
                path, el = cache.popitem(False)

                if el is None:
                    mem.consumption -= len(path)
                    continue

                dirty, source, reqres, overwrite, to_remove = el
                mem.consumption -= len(path) + source.approx_size() + reqres.approx_size()

                if dirty:
                    run_action(source, reqres, path, overwrite, to_remove)
                else:
                    queue_to_remove(path, to_remove)

                if want_flush() or final:
                    continue
                break

        if Mutable.updated + len(remove_files) > max_batch or mem.consumption > max_memory or final:
            flush_sync()

            Mutable.updated = 0

            if print_outputs:
                for path in updated_files:
                    mem.consumption -= len(path)
                    stdout.write(path)
                    stdout.write_bytes(terminator)
                stdout.flush()
                updated_files.clear()

            if remove_files:
                for src, report in remove_files:
                    mem.consumption -= src.approx_size()
                    epath = src.path

                    if not quiet and report:
                        stderr.write_str(removing_dup)
                        stderr.write_str(": `")
                        stderr.write(epath)
                        stderr.write_str_ln("`")
                        stderr.flush()

                    if not dry_run:
                        try:
                            unlink_file(fsreencode(epath, destination), src.stat, sync=sync)
                        except (FileExistsError, FileNotFoundError):
                            issue = Failure("`%s` changed between accesses", fsdecode(epath))
                            log_exception_warning(issue)

                flush_sync()

                if print_inputs:
                    for src, _report in remove_files:
                        epath = src.path
                        stdout.write(epath)
                        stdout.write_bytes(terminator)
                    stdout.flush()

                remove_files.clear()

    def emit(new_rrexpr: ReqresExpr[Source]) -> None:
        raise_first_delayed_signal()

        new_source = new_rrexpr.source
        new_reqres = new_rrexpr.reqres

        new_rrexpr.values["num"] = 0
        prev_rel_out_path = None
        while True:
            if isinstance(destination, str):
                rel_out_path = _op.join(destination, output_format % new_rrexpr)
            else:
                rel_out_path = _op.join(destination, _os.fsencode(output_format % new_rrexpr))

            # when `output_format` contains no `num`, `raise` the following `Failure` after all the
            # `continue` statements below
            if prev_rel_out_path == rel_out_path:
                raise Failure("destination already exists" + variance_help)
            prev_rel_out_path = rel_out_path

            abs_out_path: AnyStr = _op.abspath(rel_out_path)

            new_path: str | bytes | None = new_source.get_path()
            if new_path is not None and equal_path(new_path, abs_out_path):
                # moving, copying, hardlinking, symlinking, etc to the same path
                #
                # NB: this is a hot evaluation path of `organize --to src src` and similar
                # subcommands, which is why we do this check early instead of delegating this to
                # (sameSourceOrData) block
                if print_remap:
                    stdout.write(abs_out_path)
                    stdout.write_bytes(terminator)
                    stdout.flush()
                return

            new_rrexpr.values["num"] += 1

            def elaborate[F: CatastrophicFailure](failure: F) -> F:
                return failure.elaborate(
                    f"while {actioning} `%s` -> `%s`",
                    new_source.show_source(),
                    fsdecode(abs_out_path),
                )

            out_stat: _os.stat_result
            have_old: bool = False
            old_source: DeferredSource
            old_reqres: Reqres
            dirty: bool = False
            to_remove: ToRemove = None
            can_overwrite: bool = bool(allow_updates)
            overwrite: Overwrite

            try:
                # load `abs_out_path` from the cache or from disk
                try:
                    old = cache[abs_out_path]
                except KeyError:
                    try:
                        out_stat = _os.lstat(abs_out_path)
                    except FileNotFoundError:
                        can_overwrite = overwrite = False
                    except OSError as exc:
                        handle_ENAMETOOLONG(exc, abs_out_path)
                        raise
                    else:
                        if allow_updates is None:
                            continue

                        out_ftype = _stat.S_IFMT(out_stat.st_mode)
                        if out_ftype != ftype:
                            issue = Failure(
                                "destination exists but has wrong file type: expected `%s`, got `%s`; re-trying with a different `num`",
                                describe_file_type(ftype),
                                describe_file_type(out_ftype),
                            )
                            log_exception_warning(elaborate(issue))
                            continue

                        is_symlink = _stat.S_ISLNK(out_stat.st_mode)
                        real_out_path = _op.realpath(abs_out_path) if is_symlink else abs_out_path

                        try:
                            with open(real_out_path, "rb") as f:
                                if is_symlink:
                                    real_stat = _os.fstat(f.fileno())
                                    old_source = WRRFileSource(real_out_path, real_stat)
                                else:
                                    old_source = WRRFileSource(abs_out_path, out_stat)
                                old_reqres = first(wrr_load(f, 1, 1))[1]
                        except FileNotFoundError:
                            issue = Failure(
                                "destination is a broken symlink; treating it as a non-existent file"
                            )
                            log_exception_warning(elaborate(issue))
                            # allow for this path only
                            can_overwrite = True
                            overwrite = out_stat
                        except OSError as exc:
                            handle_ENAMETOOLONG(exc, abs_out_path)
                            raise
                        except Failure as exc:
                            log_exception_warning(elaborate(exc))
                            # start ignoring this path
                            cache[abs_out_path] = None
                            mem.consumption += len(abs_out_path)
                            continue
                        else:
                            overwrite = out_stat if can_overwrite else False
                            cache[abs_out_path] = dirty, old_source, old_reqres, overwrite, to_remove  # fmt: skip
                            mem.consumption += len(abs_out_path) + old_source.approx_size() + old_reqres.approx_size()  # fmt: skip
                            have_old = True
                else:
                    if allow_updates is None:
                        continue

                    cache.move_to_end(abs_out_path)
                    if old is None:
                        # ignored path
                        return
                    dirty, old_source, old_reqres, overwrite, to_remove = old
                    have_old = True

                # try to update it with `new_rrexpr`

                is_noop = False

                if have_old:
                    if new_source == old_source or new_reqres == old_reqres:
                        # (sameSourceOrData) Turn repeated operation with the same source, e.g.:
                        #   `__prog__ organize --to dest src src`
                        # or with duplicated data, e.g.:
                        #   `__prog__ organize --to dest src copy-of-src`
                        # into noops.
                        is_noop = True
                    elif ideal is not None:
                        old_rrexpr = ReqresExpr(old_source, old_reqres)
                        new_rrexpr = ReqresExpr(new_source, new_reqres)
                        if is_closer(ideal, old_rrexpr.stime, new_rrexpr.stime):
                            # Ignore worse `--nearest`, `--oldest`, and `--latest` versions.
                            is_noop = True
                    elif not can_overwrite:
                        continue

                if print_remap:
                    stdout.write(abs_out_path)
                    stdout.write_bytes(terminator)
                    stdout.flush()

                if remove:
                    # mark `new_source` for removal
                    if to_remove is None:
                        to_remove = []
                    # NB: setting `report = is_noop` so that only the noop-related removals would be
                    # reported separately, the others reported as part of "{actioning} `%s` -> `%s`"
                    to_remove.append((new_source, is_noop))
                    mem.consumption += new_source.approx_size()

                if is_noop:
                    if not dirty:
                        # improve efficiently by queuing removals eagerly in this case
                        queue_to_remove(abs_out_path, to_remove)
                        to_remove = None
                    cache[abs_out_path] = dirty, old_source, old_reqres, overwrite, to_remove
                    break

                # perform this update or defer it into the cache
                dirty = True

                if not defer:
                    # NB: using `can_overwrite` instead of `overwrite` here to save on `os.stat`,
                    # since it would be equal to `out_stat` anyway
                    run_action(new_source, new_reqres, abs_out_path, can_overwrite, to_remove)
                    dirty = False
                    to_remove = None

                cache[abs_out_path] = dirty, new_source, new_reqres, overwrite, to_remove
                if have_old:
                    mem.consumption -= len(abs_out_path) + old_source.approx_size() + old_reqres.approx_size()  # fmt: skip
                mem.consumption += len(abs_out_path) + new_source.approx_size() + new_reqres.approx_size()  # fmt: skip

                break
            except CatastrophicFailure as exc:
                raise elaborate(exc)  # pylint: disable=raise-missing-from

        if not lazy:
            flush(False)

    def finish() -> None:
        flush(True)
        if mem.consumption != 0:
            _logging.warning("BUG: leaked %d bytes of RAM", mem.consumption)

    return emit, finish


def make_organize_emit[Source: DeferredSource, AnyStr: (
    str,
    bytes,
)](
    cargs: _t.Any,
    destination: AnyStr,
    output_format: AnyStr,
    ideal: TimeStamp | None,
    allow_updates: bool | None,
) -> tuple[_t.Callable[[ReqresExpr[Source]], None], _t.Callable[[], None]]:
    action = cargs.action
    actioning = action + "ing"

    subaction_op: _t.Any
    remove = False
    copy = False
    symlink = False

    if action == "move":
        actioning = "moving"
        subaction_op = link_or_clone_file
        remove = True
    elif action == "copy":
        subaction_op = clone_file
        copy = True
    elif action == "hardlink":
        subaction_op = link_file
    elif action == "symlink":
        subaction_op = symlink_file
        symlink = True
    else:
        assert False

    def action_op(
        source: DeferredSource,
        reqres: Reqres,
        path: AnyStr,
        overwrite: bool | _os.stat_result,
        sync: bool | Deferred[AnyStr],
    ) -> None:
        if isinstance(source, WRRFileSource):
            subaction_op(source.path, path, allow_overwrites=overwrite, sync=sync)
        elif copy:
            write_file(wrr_dumps(reqres), path, allow_overwrites=overwrite, sync=sync)
        else:
            raise Failure(
                f"can't {action} the source to the destination because the source is not stored as a separate WRR file; did you mean to run with `--copy` intead of `--{action}`?"
            )

    return make_cached_emit(
        cargs,
        action,
        actioning,
        action_op,
        destination,
        output_format,
        remove,
        symlink,
        ideal,
        allow_updates,
    )


def cmd_organize(cargs: _t.Any) -> None:
    ideal: TimeStamp | None = cargs.mode[1]

    allow_updates_is_safe = cargs.action == "symlink" and ideal is not None
    allow_updates: bool | None | Missing = cargs.allow_updates
    if isinstance(allow_updates, Missing):
        allow_updates = allow_updates_is_safe

    if allow_updates and not allow_updates_is_safe and not cargs.force:
        raise Failure(
            "this combination of options will loose and/or destroy some your data; run this command with `--please-destroy-my-data` option if you really want to do this"
        )

    if cargs.walk_paths is None:
        cargs.walk_paths = WalkOrder.REVERSE if ideal == anytime.end else WalkOrder.NONE
    if cargs.walk_fs is None:
        cargs.walk_fs = WalkOrder.REVERSE if ideal == anytime.end else WalkOrder.SORT

    follow_symlinks = cargs.action != "move"

    output_format = elaborate_output("--output", output_alias, cargs.output) + ".wrr"
    _num, filters_allow, filters_warn = compile_filters(cargs)

    rrexpr_loadf = select_rrexpr_loadf(cargs)
    handle_paths(cargs)
    emit: EmitFunc[ReqresExpr[_t.Any]]
    if cargs.destination is not None:
        # destination is set explicitly
        emit, finish = make_organize_emit(
            cargs, _op.expanduser(cargs.destination), output_format, ideal, allow_updates
        )
        try:
            load_and_emit_many(
                cargs,
                rrexpr_loadf,
                filters_allow,
                emit,
                cargs.paths,
                follow_symlinks=follow_symlinks,
            )
        finally:
            finish()
    elif cargs.possible_destinations is not None:
        # `--to-one-of`
        for i, dirname in enumerate(cargs.possible_destinations):
            cargs.possible_destinations[i] = dirname = _op.abspath(_op.expanduser(dirname))
            try:
                path_stat = _os.stat(dirname)
            except FileNotFoundError as exc:
                raise Failure("`%s` does not exist", fsdecode(dirname)) from exc
            if not _stat.S_ISDIR(path_stat.st_mode):
                raise Failure("`%s` is not a directory", fsdecode(dirname))

        groups: _c.defaultdict[str, list[str]] = _c.defaultdict(list)

        for path in cargs.paths:
            path = fsdecode(path)

            # find best-matching `--to-one-of` argument
            best_match = 0
            best_dirname = None
            for dirname in cargs.possible_destinations:
                try:
                    match = len(_op.commonpath((dirname, path)))
                except ValueError:
                    match = 0
                if match > best_match:
                    best_match = match
                    best_dirname = dirname

            if best_dirname is None:
                raise Failure("`%s` has no corresponding `--to-one-of` ancestors", fsdecode(path))

            # record the decision
            groups[best_dirname].append(path)

        for dirname, paths in groups.items():
            emit, finish = make_organize_emit(cargs, dirname, output_format, ideal, False)
            try:
                load_and_emit_many(
                    cargs,
                    rrexpr_loadf,
                    filters_allow,
                    emit,
                    paths,
                    follow_symlinks=follow_symlinks,
                )
            finally:
                finish()
    elif allow_updates:
        raise Failure("`--to` or `--to-one-of` is required when running with `--overwrite`")
    else:
        # each path is its own destination
        for exp_path in cargs.paths:
            try:
                path_stat = _os.stat(exp_path)
            except FileNotFoundError as exc:
                raise Failure("`%s` does not exist", fsdecode(exp_path)) from exc

            if not _stat.S_ISDIR(path_stat.st_mode):
                raise Failure(
                    "`%s` is not a directory but no `--to` is specified", fsdecode(exp_path)
                )

        for exp_path in cargs.paths:
            emit, finish = make_organize_emit(cargs, exp_path, output_format, ideal, False)
            try:
                load_and_emit_many(
                    cargs,
                    rrexpr_loadf,
                    filters_allow,
                    emit,
                    [exp_path],
                    follow_symlinks=follow_symlinks,
                )
            finally:
                finish()

    filters_warn()


def cmd_import(cargs: _t.Any) -> None:
    output_format = elaborate_output("--output", output_alias, cargs.output) + ".wrr"
    _num, filters_allow, filters_warn = compile_filters(cargs)
    rrexpr_loadf = select_rrexpr_loadf(cargs)
    handle_paths(cargs)

    def action_op[AnyStr: (
        str,
        bytes,
    )](
        source: DeferredSource,
        reqres: Reqres,
        path: AnyStr,
        overwrite: bool | _os.stat_result,
        sync: bool | Deferred[AnyStr],
    ) -> None:
        if isinstance(source, WRRFileSource):
            clone_file(source.path, path, allow_overwrites=overwrite, sync=sync)
        else:
            write_file(wrr_dumps(reqres), path, allow_overwrites=overwrite, sync=sync)

    emit, finish = make_cached_emit(
        cargs,
        "import",
        "importing",
        action_op,
        _op.expanduser(cargs.destination),
        output_format,
        False,
        False,
        None,
        False,
    )
    try:
        load_and_emit_many(cargs, rrexpr_loadf, filters_allow, emit, cargs.paths)
    finally:
        finish()

    filters_warn()


def path_to_url(x: str) -> str:
    return x.replace("?", "%3F")


definitive_response_codes = frozenset([200, 204, 300, 404, 410])
redirect_response_codes = frozenset([301, 302, 303, 307, 308])

IndexedReqres = tuple[TimeStamp, ReqresExpr[_t.Any]]
type SortedReqresIndex = SortedDictIndex[URLType, TimeStamp, IndexedReqres]
type UnsortedReqresIndex = DictIndex[URLType, TimeStamp, IndexedReqres]


def complete_response(indexed: IndexedReqres) -> bool:
    response = indexed[1].reqres.response
    return response is not None and response.complete


def normal_document(indexed: IndexedReqres) -> bool:
    return complete_response(indexed) and indexed[1].reqres.request.method in ("GET", "DOM")


def cmd_mirror(cargs: _t.Any) -> None:
    on_error = select_on_error(cargs.errors)

    if len(cargs.exprs) == 0:
        cargs.exprs = [compile_expr(default_expr("mirror", cargs.default_expr))]

    output_format = elaborate_output("--output", output_alias, cargs.output)
    destination = _op.expanduser(cargs.destination)

    content_output_format = elaborate_output(
        "--content-output", content_output_alias, cargs.content_output
    )
    if cargs.content_destination is not None:
        content_destination = _op.expanduser(cargs.content_destination)
    else:
        content_destination = destination

    action_op: _t.Any
    action = cargs.content_action
    copy = False
    if action == "copy":
        copy = True
    elif action == "hardlink":
        action_op = link_file
    elif action == "symlink":
        action_op = symlink_file
    else:
        assert False

    if cargs.absolute is None:
        relative = action != "symlink"
    else:
        relative = not cargs.absolute

    allow_updates: bool = cargs.allow_updates

    singletons: bool
    nearest: TimeStamp | None
    singletons, nearest = cargs.mode

    PathType: _t.TypeAlias = str
    seen_counter: SeenCounter[PathType] = SeenCounter()

    RequestIDType: _t.TypeAlias = bytes
    PageIDType = tuple[TimeStamp, RequestIDType]
    RequestOrPageIDType = RequestIDType | PageIDType

    def get_request_id(net_url: URLType, rrexpr: ReqresExpr[_t.Any]) -> RequestIDType:
        request = rrexpr.reqres.request
        body = request.body or b""
        body_ = body if isinstance(body, bytes) else body.encode("utf-8")
        return f"{request.method} {net_url} ".encode("utf-8") + _hashlib.sha256(body_).digest()

    committed: dict[int, PathType] = {}
    done: dict[int, PathType | None] = {}

    def get_rel_out_path(rrexpr_id: int, rrexpr: ReqresExpr[_t.Any]) -> PathType:
        try:
            return committed[rrexpr_id]
        except KeyError:
            rrexpr.values["num"] = 0
            def_out_path = output_format % rrexpr
            rrexpr.values["num"] = seen_counter.count(def_out_path)
            committed[rrexpr_id] = rel_out_path = _op.join(destination, output_format % rrexpr)
            mem.consumption += 8 + len(rel_out_path)
            return rel_out_path

    if cargs.default_input_filters:
        cargs.status_re += [default_input_status_re]

    _num, filters_allow, filters_warn = compile_filters(cargs)

    if cargs.default_root_filters:
        cargs.root_status_re += [default_root_status_re]

    _root_filters_num, root_filters_allow, root_filters_warn = compile_filters(cargs, "root_")

    max_depth: int = cargs.depth
    max_memory = cargs.memory * 1024 * 1024

    index: SortedReqresIndex = SortedDictIndex(
        key_key=identity, value_key=fst, ideal=nearest if singletons else None
    )

    Queue = OrderedDict[RequestOrPageIDType, IndexedReqres]
    queue: Queue = OrderedDict()

    if stdout.isatty():
        stdout.write_bytes(b"\033[32m")
    stdout.write_str_ln(gettext("loading input `PATH`s..."))
    if stdout.isatty():
        stdout.write_bytes(b"\033[0m")
    stdout.flush()

    def report_queued[Source: DeferredSource](
        stime: TimeStamp,
        net_url: URLType,
        pretty_net_url: URLType,
        source: Source,
        level: int,
        old_stime: TimeStamp | None = None,
    ) -> None:
        if stdout.isatty():
            stdout.write_bytes(b"\033[33m")
        durl = net_url if pretty_net_url == net_url else f"{net_url} ({pretty_net_url})"
        ispace = " " * (2 * level)
        if old_stime is None:
            stdout.write_str_ln(
                ispace
                + gettext("queued [%s] %s from %s")
                % (
                    stime.format(*time_format, precision=3),
                    durl,
                    source.show_source(),
                )
            )
        else:
            stdout.write_str_ln(
                ispace
                + gettext("requeued [%s] -> [%s] %s from %s")
                % (
                    old_stime.format(*time_format, precision=3),
                    stime.format(*time_format, precision=3),
                    durl,
                    source.show_source(),
                )
            )
        if stdout.isatty():
            stdout.write_bytes(b"\033[0m")
        stdout.flush()

    def collect[Source: DeferredSource](should_enqueue: bool) -> EmitFunc[ReqresExpr[Source]]:
        def emit(rrexpr: ReqresExpr[Source]) -> None:
            stime = rrexpr.stime
            net_url = rrexpr.net_url
            indexed = (stime, rrexpr)
            if not index.insert(net_url, indexed):
                return

            unqueued = True
            request_id = get_request_id(net_url, rrexpr)
            page_id: PageIDType = (stime, request_id)
            pid: RequestOrPageIDType
            if nearest is not None:
                for pid in (request_id, page_id):
                    qobj = queue.get(pid, None)
                    if qobj is not None:
                        qstime, _qrrexpr = qobj
                        if is_closer(nearest, stime, qstime):
                            queue[pid] = indexed
                            report_queued(stime, net_url, rrexpr.pretty_net_url, rrexpr.source, 1, qstime)  # fmt: skip
                        unqueued = False

            if unqueued and should_enqueue and root_filters_allow(rrexpr):
                unqueued = False
                pid = request_id if nearest is not None else page_id
                #     ^ not `--all`                          ^ otherwise
                queue[pid] = indexed
                report_queued(stime, net_url, rrexpr.pretty_net_url, rrexpr.source, 1)  # fmt: skip

            if unqueued or mem.consumption > max_memory:
                rrexpr.unload()

        return emit

    handle_paths(cargs)
    elaborate_paths(cargs.boring)

    rrexpr_loadf = select_rrexpr_loadf(cargs)
    seen_paths: set[PathType] = set()
    load_and_emit_many(
        cargs, rrexpr_loadf, filters_allow, collect(True), cargs.paths, seen_paths=seen_paths
    )
    load_and_emit_many(
        cargs, rrexpr_loadf, filters_allow, collect(False), cargs.boring, seen_paths=seen_paths
    )

    indexed_num = index.size

    def remap_url_fallback(stime: TimeStamp, purl: ParsedURL, expected_cts: list[str]) -> PathType:
        trrexpr = ReqresExpr(UnknownSource(), fallback_Reqres(purl, expected_cts, stime))
        trrexpr.values["num"] = 0
        return _op.join(destination, output_format % trrexpr)

    class Mutable:
        n: int = 0
        doc_n: int = 0
        depth: int = 0

    def render[Source: DeferredSource](
        stime: TimeStamp,
        net_url: URLType,
        rrexpr: ReqresExpr[Source],
        rel_out_path: PathType,
        enqueue: bool,
        new_queue: Queue,
        level: int,
    ) -> PathType | None:
        rrexpr_id = id(rrexpr)
        assert rrexpr_id not in done
        done[rrexpr_id] = None  # (breakCycles)

        level0 = level == 0
        n = Mutable.n = Mutable.n + 1
        if level0:
            doc_n = Mutable.doc_n = Mutable.doc_n + 1
        else:
            doc_n = Mutable.doc_n
        n100 = 100 * n
        n_total = n + len(new_queue) + len(queue)

        source = rrexpr.source

        if stdout.isatty():
            if level0:
                stdout.write_bytes(b"\033[32m")
            else:
                stdout.write_bytes(b"\033[34m")
        ispace = " " * (2 * level)
        if level0:
            stdout.write_str_ln(
                gettext(
                    "mirroring input #%d, %.2f%% of %d queued (%.2f%% of %d indexed), document #%d, depth %d"
                )
                % (
                    n,
                    n100 / n_total,
                    n_total,
                    n100 / indexed_num,
                    indexed_num,
                    doc_n,
                    Mutable.depth,
                )
            )
        else:
            stdout.write_str_ln(
                ispace
                + gettext(
                    "mirroring requisite input #%d, %.2f%% of %d queued (%.2f%% of %d indexed)"
                )
                % (n, n100 / n_total, n_total, n100 / indexed_num, indexed_num)
            )
        stdout.write_str_ln(
            ispace + gettext("stime [%s]") % (stime.format(*time_format, precision=3),)
        )
        stdout.write_str_ln(ispace + gettext("net_url %s") % (net_url,))
        stdout.write_str_ln(ispace + gettext("src %s") % (source.show_source(),))
        if stdout.isatty():
            stdout.write_bytes(b"\033[0m")
        stdout.flush()

        def handle_warning(msg: str, *args: _t.Any) -> None:
            ispace = " " * (2 * (level + 1))
            printf_err(ispace + gettext(msg), *args, color=1)

        try:
            document_dir = _op.dirname(rel_out_path)

            def remap_url(
                upurl: ParsedURL,
                link_type: LinkType,
                expected_cts: list[str],
                allow_fallbacks: bool,
            ) -> tuple[URLType, bool] | None:
                raise_first_delayed_signal()

                unet_url = upurl.net_url
                is_requisite = link_type == LinkType.REQ
                ustime = stime if nearest is None or is_requisite else nearest
                upredicate = normal_document if link_type != LinkType.ACTION else complete_response

                uobj: IndexedReqres | None = None
                again = True
                while again:
                    again = False
                    for nobj in index.iter_closest(unet_url, ustime, upredicate):
                        response = nobj[1].reqres.response
                        assert response is not None
                        code = response.code
                        if code in redirect_response_codes:
                            location = get_header_value(response.headers, "location", None)
                            if location is not None:
                                try:
                                    unet_url_ = _up.urljoin(unet_url, location)
                                    upurl_ = parse_url(unet_url_)
                                except ValueError:
                                    pass
                                else:
                                    # preserve the fragment
                                    upurl_.ofm = upurl.ofm
                                    upurl_.fragment = upurl.fragment
                                    # reset and redirect
                                    unet_url = unet_url_
                                    upurl = upurl_
                                    # try again
                                    again = True
                                    break
                        else:
                            uobj = nobj
                            break

                if uobj is None:
                    # unavailable
                    urel_out_path = None
                else:
                    ustime, urrexpr = uobj
                    urrexpr_id = id(urrexpr)
                    urequest_id = get_request_id(unet_url, urrexpr)
                    upage_id = (ustime, urequest_id)

                    if is_requisite:
                        try:
                            urel_out_path = done[urrexpr_id]
                        except KeyError:
                            # unqueue it
                            for q in (new_queue, queue):
                                try:
                                    del q[upage_id]
                                except KeyError:
                                    pass
                                try:
                                    del q[urequest_id]
                                except KeyError:
                                    pass

                            # render it immediately
                            # NB: (breakCycles) breaks dependency cycles that can make this loop infinitely
                            # NB: using content_destination path here
                            urel_out_path = get_rel_out_path(urrexpr_id, urrexpr)
                            urel_out_path = render(ustime, unet_url, urrexpr, urel_out_path, enqueue, new_queue, level + 1)  # fmt: skip
                            urrexpr.unload()
                    elif urrexpr_id in done:
                        # nothing to do
                        urel_out_path = get_rel_out_path(urrexpr_id, urrexpr)
                        # NB: will be unloaded already
                    elif (
                        upage_id in new_queue
                        or upage_id in queue
                        or urequest_id in new_queue
                        or urequest_id in queue
                    ):
                        # nothing to do
                        urel_out_path = get_rel_out_path(urrexpr_id, urrexpr)
                        if mem.consumption > max_memory:
                            urrexpr.unload()
                    elif enqueue:
                        urel_out_path = get_rel_out_path(urrexpr_id, urrexpr)
                        new_queue[upage_id] = uobj
                        report_queued(ustime, unet_url, upurl.pretty_net_url, urrexpr.source, level + 1)  # fmt: skip
                        if mem.consumption > max_memory:
                            rrexpr.unload()
                    else:
                        # this will not be mirrored
                        urel_out_path = None
                        # NB: Not setting
                        #
                        #  committed[urrexpr_id] = None
                        #
                        # because it might be a requisite for another page.
                        #
                        # In which case, when not running with `--remap-all`, this page will void
                        # this link unnecessarily, yes.

                exists = True

                if urel_out_path is None:
                    if allow_fallbacks:
                        urel_out_path = remap_url_fallback(stime, upurl, expected_cts)
                        exists = False
                    else:
                        return None

                if relative:
                    out_path = _op.relpath(urel_out_path, document_dir)
                else:
                    out_path = _op.abspath(urel_out_path)

                return path_to_url(out_path) + upurl.ofm + upurl.fragment, exists

            rrexpr.remap_url = cached_remap_url(net_url, remap_url, handle_warning=handle_warning)

            old_data = read_file_maybe(rel_out_path)

            data: bytes
            if old_data is not None and not allow_updates:
                data = old_data

                if stdout.isatty():
                    stdout.write_bytes(b"\033[33m")
                stdout.write_str_ln(
                    ispace
                    + gettext(
                        "reusing file content: destination exists and `--skip-existing` is set"
                    )
                )
                if stdout.isatty():
                    stdout.write_bytes(b"\033[0m")
            else:
                with TIOWrappedWriter(_io.BytesIO()) as f:
                    print_exprs(rrexpr, cargs.exprs, cargs.separator, f)
                    data = f.fobj.getvalue()

            try:
                if copy:
                    real_out_path = rel_out_path
                    if old_data != data:
                        write_file(data, rel_out_path, allow_updates)
                else:
                    rrexpr.values["content"] = data
                    rrexpr.values["content_sha256"] = sha256_raw = _hashlib.sha256(data).digest()
                    sha256_hex = sha256_raw.hex()

                    real_out_path = _op.join(content_destination, content_output_format % rrexpr)

                    old_content = read_file_maybe(real_out_path)

                    if old_content is None:
                        write_file(data, real_out_path, False)
                    elif old_content != data:
                        raise Failure(
                            "wrong file content in `%s`: expected sha256 `%s`, got sha256 `%s`",
                            real_out_path,
                            sha256_hex,
                            _hashlib.sha256(old_content).hexdigest(),
                        )

                    if old_data != data:
                        action_op(real_out_path, rel_out_path, allow_updates)

                    stdout.write_str_ln(ispace + gettext("content_dst %s") % (real_out_path,))

                stdout.write_str_ln(ispace + gettext("dst %s") % (rel_out_path,))
                stdout.flush()

                done[rrexpr_id] = real_out_path
                return real_out_path
            except FileExistsError as exc:
                raise Failure(
                    "trying to overwrite `%s` which already exists", exc.filename
                ) from exc
            except OSError as exc:
                handle_ENAMETOOLONG(exc, exc.filename)
                if exc.errno == _errno.EXDEV:
                    raise Failure(f"can't {action} across file systems") from exc
                raise
        except Failure as exc:
            on_error(exc.elaborate("while processing `%s`", source.show_source()))
            return rel_out_path
        except Exception as exc:
            raise CatastrophicFailure("%s", str(exc)).elaborate(
                "while processing `%s`", source.show_source()
            ) from exc

    while len(queue) > 0:
        raise_first_delayed_signal()

        new_queue: Queue = OrderedDict()
        enqueue = Mutable.depth < max_depth

        while len(queue) > 0:
            raise_first_delayed_signal()

            _qpid, qobj = queue.popitem(False)
            qstime, qrrexpr = qobj
            render(qstime, qrrexpr.net_url, qrrexpr, get_rel_out_path(id(qrrexpr), qrrexpr), enqueue, new_queue, 0)  # fmt: skip
            qrrexpr.unload()

        queue = new_queue
        Mutable.depth += 1

    filters_warn()
    root_filters_warn()


def cmd_serve(cargs: _t.Any) -> None:
    import bottle
    from fnmatch import translate
    import hoardy_web.static as _static

    quiet = cargs.quiet

    server_url_base = f"http://{cargs.host}:{cargs.port}"

    locate_page = bottle.SimpleTemplate(source=_static.locate_page_stpl)
    app = bottle.Bottle()
    BottleReturnType = str | bytes | None

    PSpec = _t.ParamSpec("PSpec")

    def with_no_signals(
        func: _t.Callable[PSpec, BottleReturnType],
    ) -> _t.Callable[PSpec, BottleReturnType]:
        def decorated(*args: PSpec.args, **kwargs: PSpec.kwargs) -> BottleReturnType:
            with no_signals():
                return func(*args, **kwargs)

        return decorated

    def with_plain_error(
        func: _t.Callable[PSpec, BottleReturnType],
    ) -> _t.Callable[PSpec, BottleReturnType]:
        def decorated(*args: PSpec.args, **kwargs: PSpec.kwargs) -> BottleReturnType:
            bottle.response.set_header("content-type", "text/plain; charset=utf-8")
            try:
                return func(*args, **kwargs)
            except CatastrophicFailure as exc:
                if not quiet:
                    stderr.write_str_ln(get_traceback(exc))
                    stderr.flush()
                bottle.response.status = 400
                return exc.get_message(gettext)
            except Exception as exc:
                if not quiet:
                    stderr.write_str_ln(get_traceback(exc))
                    stderr.flush()
                bottle.response.status = 500
                return gettext("uncaught error: %s") % (str(exc),)

        return decorated

    default_output = elaborate_output("--output", output_alias, cargs.output) + ".wrr"
    fallback_output = (
        elaborate_output("--fallback-output", output_alias, cargs.fallback_output) + ".wrr"
    )
    destination = map_optional(
        lambda x: _op.expanduser(x), cargs.destination  # pylint: disable=unnecessary-lambda
    )

    bucket_re = _re.compile(r"[\w -]+")
    ignore_buckets = cargs.ignore_buckets
    default_bucket = cargs.default_bucket
    bucket_prefix = cargs.bucket_prefix
    fallback_bucket_prefix = cargs.fallback_bucket_prefix

    if not default_bucket:
        raise CatastrophicFailure("`--default-bucket` can't be empty")

    fallback = cargs.fallback
    compression = cargs.compression
    print_outputs: bool = cargs.print
    terminator: bytes = cargs.terminator

    implicit_similar: bool | None = cargs.implicit_similar

    if cargs.mode is None:
        do_replay = False
        ideal = anytime.end
    else:
        do_replay = True
        ideal = cargs.mode[1]

    inherit: str | None = None
    if len(cargs.exprs) == 0:
        cargs.exprs = [
            compile_expr(
                default_expr("serve" if cargs.web_replay else "mirror", cargs.default_expr)
            )
        ]
        inherit = "request" if cargs.default_expr == "raw_qbody" else "response"
    take_whatever = inherit != "response"
    not_web_replay = not cargs.web_replay

    if cargs.default_input_filters:
        cargs.status_re += [default_input_status_re]

    _num, filters_allow, filters_warn = compile_filters(cargs)

    PathType: _t.TypeAlias = str

    # net_url -> rhostname, unquoted, pretty_net_url
    cached_url_keys: LRUCache[URLType, tuple[str, str, URLType]] = LRUCache(512)

    def url_key(net_url: URLType, purl: ParsedURL | None = None) -> tuple[str, str, URLType]:
        """A key function to sort urls by `rhostname`."""
        try:
            return cached_url_keys[net_url]
        except KeyError:
            if purl is None:
                purl = parse_url(net_url)
            cached_url_keys[net_url] = res = (
                purl.rhostname,
                f"{purl.mq_path}{purl.oqm}{purl.mq_query}",
                purl.pretty_net_url,
            )
            return res

    index: SortedReqresIndex = SortedDictIndex(
        key_key=url_key,
        value_key=fst,
        ideal=ideal,
    )

    def emit[Source: DeferredSource](rrexpr: ReqresExpr[Source]) -> None:
        stime = rrexpr.stime
        net_url = rrexpr.net_url
        indexed = (stime, rrexpr)
        # a bit of a hack ...
        url_key(net_url, rrexpr.reqres.request.url)
        # ... to make the following line skip re-parsing of the `net_url`
        index.insert(net_url, indexed)
        rrexpr.unload()

    if do_replay:
        if stderr.isatty():
            stderr.write_bytes(b"\033[32m")
        stderr.write_str_ln(gettext("loading input `PATH`s..."))
        if stderr.isatty():
            stderr.write_bytes(b"\033[0m")
        stderr.flush()

        handle_paths(cargs)

        rrexpr_loadf = select_rrexpr_loadf(cargs)
        seen_paths: set[PathType] = set()
        if destination is not None and cargs.implicit and _op.exists(destination):
            load_and_emit_many(
                cargs, rrexpr_loadf, filters_allow, emit, [destination], seen_paths=seen_paths
            )
        load_and_emit_many(
            cargs, rrexpr_loadf, filters_allow, emit, cargs.paths, seen_paths=seen_paths
        )
    elif cargs.implicit:
        raise CatastrophicFailure("`--no-replay`: not allowed with `--implicit`")
    elif len(cargs.paths) > 0:
        raise CatastrophicFailure("`--no-replay`: not allowed with a non-empty list of `PATH`s")

    if not quiet:
        filters_warn()

    def json_fmtts(stime: TimeStamp) -> list[str]:
        return [str(Decimal(stime)), stime.format(*time_format_s)]

    def needed_precision(stime: TimeStamp, not_including: list[TimeStamp]) -> int:
        """Compute `precision` such that formatting `stime` with it would not include
        any of `not_including` (except for those equal to `stime` itself) in the
        resulting selector.
        """
        prec = 0
        delta = Decimal(1)
        for t in not_including:
            d = abs(stime - t)
            while d != 0 and d < delta:
                prec += 1
                delta /= 10
        return prec

    def uni_fmtts(stime: TimeStamp, not_including: list[TimeStamp] = []) -> str:
        """Produce a timestamp uniquely localizing `net_url` w.r.t. `not_including`."""
        return stime.format(*time_format_s, precision=needed_precision(stime, not_including))

    def url_fmtts(net_url: URLType, stime: TimeStamp) -> str:
        """Produce a timestamp uniquely localizing `net_url` in the index."""
        not_including: list[TimeStamp] = []
        # NB: not adding `normal_document` here, since we want a globally unique result
        for u in index.get_adjacent(net_url, stime, anytime.start, anytime.end):
            if u is not None:
                not_including.append(u[0])
        return uni_fmtts(stime, not_including)

    server_info_dict: dict[str, _t.Any] = {
        "version": 1,
    }
    if destination is not None:
        server_info_dict["dump_wrr"] = "/pwebarc/dump"
    if do_replay:
        server_info_dict["index_ideal"] = map_optional(json_fmtts, index.ideal)
        server_info_dict["replay_oldest"] = "/web/0/{url}"
        server_info_dict["replay_latest"] = "/web/2/{url}"
        if index.ideal is None:
            server_info_dict["replay_any"] = "/web/{timestamp}/{url}"
    server_info_json = _json.dumps(server_info_dict).encode("utf-8")
    del server_info_dict

    @app.route("/hoardy-web/server-info")  # type: ignore
    @with_no_signals
    def server_info() -> bytes:
        return server_info_json

    @_dc.dataclass
    class Options:
        re: bool = False
        glob: bool = False
        similar: bool = False

    type Selector = tuple[list[TimeStamp], list[TimeRange], Options]

    def parse_selector(selector: str) -> Selector:
        stamps = []
        ranges = []
        opts = Options()
        for part in selector.split(","):
            part = part.strip()

            if part == "re":
                opts.re = True
            elif part == "glob":
                opts.glob = True
            elif part == "similar":
                opts.similar = True
            elif part in ("0", "1", "oldest", "old", "first", "-inf"):
                stamps.append(anytime.start)
            elif part in ("2", "latest", "last", "newest", "new", "+inf"):
                stamps.append(anytime.end)
            else:
                res, wide = run_parser(TimeRange.parse, True, part)[0]
                if wide:
                    ranges.append(res)
                else:
                    stamps.append(res.middle)
        stamps.sort()
        ranges.sort()
        return stamps, ranges, opts

    def explain_selector(selector: Selector) -> list[tuple[str, str]]:
        res: list[tuple[str, str]] = []
        for s in selector[0]:
            res.append((gettext("closest to"), s.format(*time_format)))
        for r in selector[1]:
            res.append(
                (
                    gettext("inside of"),
                    r.format3(*time_format, range_fmt="[{0}]--[{1}] => {2}"),
                )
            )
        return res

    def search_by_net_url(
        results: UnsortedReqresIndex, inet_url: URLType, selector: Selector
    ) -> None:
        """For a given `inet_url`, slurp its matching subset of reqres from `index` to `results`."""
        for s in selector[0]:
            iobj = index.get_closest(inet_url, s, normal_document)
            if iobj is not None:
                results.insert(inet_url, iobj)
        for r in selector[1]:
            for iobj in index.iter_range(inet_url, r.start, r.end, 0, normal_document):
                results.insert(inet_url, iobj)

    def search_by_regexp(
        results: UnsortedReqresIndex, pattern: str, selector: Selector
    ) -> UnsortedReqresIndex:
        """`search` all urls matching a regexp."""
        if pattern == ".*" and any(map(lambda s: s == anytime, selector[1])):
            # make "/find/*/*" and similar requests really cheap
            return index

        cpat = _re.compile(pattern)
        for inet_url in index.keys():
            if inet_url in results:
                continue
            ipretty_net_url = url_key(inet_url)[2]
            if cpat.fullmatch(ipretty_net_url):
                search_by_net_url(results, inet_url, selector)
        return results

    @app.route("/pwebarc/dump", method="POST")  # type: ignore
    @with_plain_error
    @with_no_signals
    def dump_wrr() -> BottleReturnType:
        if destination is None:
            bottle.response.status = 403
            return gettext("archiving is forbidden, restart the server with `%s` to enable") % (
                "hoardy-web serve --to <path>",
            )

        ctype = bottle.request.content_type
        if ctype not in ("application/x-wrr+cbor", "application/cbor"):
            raise Failure("expected CBOR data, got `%s`", ctype)

        env = bottle.request.environ

        bucket = ""
        if not ignore_buckets:
            bucket_param = bottle.request.query.get("profile", "")
            bucket = "".join(bucket_re.findall(bucket_param))
        if not bucket:
            bucket = default_bucket

        # read request body data
        cborf = BytesIOReader(b"")
        inf = env["wsgi.input"]
        try:
            todo = int(env["CONTENT_LENGTH"])
        except Exception as exc:
            raise Failure("need `content-length`") from exc

        while todo > 0:
            res = inf.read(todo)
            if len(res) == 0:
                raise Failure("incomplete data")
            cborf.write(res)
            todo -= len(res)

        cborf.seek(0)
        data = cborf.getvalue()  # type: ignore
        if compression:
            data = gzip_maybe(data)

        cborf.seek(0)
        try:
            try:
                reqres = first(wrr_load(cborf, 1, 1))[1]
            except Failure as exc:
                raise exc.elaborate("failed to parse content body")
            except Exception as exc:
                raise Failure("failed to parse content body: %s", str(exc)) from exc

            trrexpr = ReqresExpr(UnknownSource(), reqres)
            this_bucket = bucket_prefix + bucket
            this_format = default_output
            this_replay = do_replay
        except Exception as exc:
            if not fallback:
                raise

            if not quiet:
                stderr.write_str_ln(get_traceback(exc))
                stderr.flush()

            now = TimeStamp.from_now()
            trrexpr = ReqresExpr(
                UnknownSource(),
                trivial_Reqres(
                    parse_url("https://example.org/fallback"),
                    "application/octet-stream",
                    now,
                    now,
                    now,
                ),
            )
            this_bucket = fallback_bucket_prefix + bucket
            this_format = fallback_output
            this_replay = False
        del cborf

        trrexpr.values["num"] = 0
        prev_path: str | None = None
        while True:
            rel_out_path = _op.join(destination, this_bucket, this_format % trrexpr)
            abs_out_path = _op.abspath(rel_out_path)

            if prev_path == abs_out_path:
                raise Failure("destination already exists" + variance_help)
            prev_path = abs_out_path

            try:
                write_file(data, abs_out_path)
            except FileExistsError:
                pass
            except OSError as exc:
                raise Failure("failed to write data to `%s`: %s", abs_out_path, str(exc)) from exc
            else:
                break

            trrexpr.values["num"] += 1

        if this_replay:
            rrexpr = ReqresExpr(WRRFileSource(abs_out_path, _os.stat(abs_out_path)), reqres)
            rrexpr.values = trrexpr.values
            if filters_allow(rrexpr):
                emit(rrexpr)
            stderr.write_str_ln(gettext("archived %s -> %s") % (rrexpr.net_url, abs_out_path))
        else:
            stderr.write_str_ln(gettext("fallback-archived something -> %s") % (abs_out_path,))
        stderr.flush()

        if print_outputs:
            stdout.write(abs_out_path)
            stdout.write_bytes(terminator)
            stdout.flush()

        return b""

    @app.route("/<namespace:re:(find|web|redirect|unavailable|other)>/<selector>/<surl:path>")  # type: ignore
    @with_no_signals
    def from_archive(namespace: str, selector: str, surl: str) -> BottleReturnType:
        if not do_replay:
            bottle.abort(403, "Replay is forbidden on this server")
            return None

        is_unavailable = namespace == "unavailable"
        if is_unavailable and bottle.request.get_header("sec-fetch-dest", "document") != "document":
            # speedup unavailable `remap_url` results
            bottle.abort(404, "Not Found")
            return None

        is_find = not is_unavailable and namespace == "find"

        surl = surl.replace("#", "%23")
        query = bottle.request.environ.get("QUERY_STRING", "")
        if len(query) > 0:
            surl += "?" + _up.unquote(query)

        try:
            pselector = parse_selector(selector)
        except CatastrophicFailure as exc:
            bottle.abort(400, exc.get_message(gettext))
            return None

        stamps, ranges, opts = pselector
        is_match = opts.re or opts.glob and opts.similar

        if (len(stamps) > 1 or len(ranges) > 0 or is_match) and not is_find:
            # must be a search page
            bottle.redirect(f"/find/{selector}/{surl}", 302)
            return None

        try:
            purl = parse_url(surl)
        except URLParsingError:
            # fallback
            have_purl = False
            pretty_net_url = surl
            net_url = surl
        else:
            have_purl = True
            pretty_net_url = purl.pretty_net_url
            net_url = purl.net_url

        results: UnsortedReqresIndex = DictIndex(value_key=fst)

        if is_match:
            # fallthrough
            pass
        elif net_url in index:
            # search the exact net_url
            search_by_net_url(results, net_url, pselector)
        elif len(query) == 0:
            # When the query is empty, WSGI loses the trailing "?" even
            # when it was given by the client, so we have to check
            net_url_ = net_url + "?"
            if net_url_ in index:
                net_url = net_url_
                pretty_net_url += "?"
                search_by_net_url(results, net_url, pselector)
            del net_url_

        if results.size != 1 and not is_find:
            # redirect so the search page
            bottle.redirect(f"/find/{selector}/{surl}", 302)
            return None

        if is_find:
            # generate a search page

            not_found = results.size == 0

            pattern: str | None
            if opts.re:
                pattern = surl
            elif opts.glob:
                pattern = translate(surl)[4:-3]
            elif (
                opts.similar
                or not_found
                and (implicit_similar is True or implicit_similar is False and "*" in surl)
            ):
                opts.similar = True
                if have_purl and purl.scheme.startswith("http"):
                    # if it can be parsed as a valid URL, also glob without the scheme and with the
                    # slash at the end of the path and the query optional
                    mq_path = purl.mq_path
                    if mq_path.endswith("/"):
                        mq_path = mq_path[:-1]
                    if mq_path.endswith("*"):
                        mq_path = mq_path[:-1]
                    pattern = ".*://" + translate(purl.netloc + "/" + mq_path)[4:-3] + ".*"
                else:
                    # fallback to globbing
                    opts.glob = True
                    pattern = translate(surl)[4:-3]
            else:
                pattern = None

            if pattern is not None:
                results = search_by_regexp(results, pattern, pselector)

            results_size = results.size

            # set code to "Not Found" or "Multiple Choices", depending
            bottle.response.status = 404 if results_size == 0 else 300

            answer = {
                "url": pretty_net_url,
                "net_url": net_url,
                "selector": selector,
                "explained_selector": explain_selector(pselector),
                "not_found": not_found,
                "pattern": pattern,
                "matching": (
                    "Visits to this exact URL" if pattern is None else "Visits to matching URLs"
                ),
                "matching_kind": (
                    "exact"
                    if pattern is None
                    else "re" if opts.re else "glob" if opts.glob else "similar"
                ),
                "results": results,
                "results_len": len(results),
                "results_size": results_size,
                # functions
                "url_fmtts": url_fmtts,
                "pretty": lambda x: url_key(x)[2],
            }
            return locate_page.render(answer)  # type: ignore

        # get the result
        uobj = first(results.values(), None)
        del results
        assert uobj is not None
        stime, rrexpr = uobj

        want_namespace = "web" if is_unavailable else namespace
        stime_selector = url_fmtts(net_url, stime)
        if namespace != want_namespace or selector != stime_selector:
            # redirect to right namespace and timestamp
            bottle.redirect(f"/{want_namespace}/{stime_selector}/{surl}", 302)
            return None

        # render the replay

        try:

            def remap_url_(
                upurl: ParsedURL,
                _link_type: LinkType,
                _expected_cts: list[str],
                _allow_fallbacks: bool,
            ) -> tuple[URLType, bool] | None:
                unamespace = "unavailable"
                ustime_selector = stime_selector
                unet_url = upurl.net_url
                exist = False

                for uobj in index.iter_closest(unet_url, stime, normal_document):
                    exist = True
                    ustime, urrexpr = uobj
                    response = urrexpr.reqres.response
                    assert response is not None
                    code = response.code
                    if take_whatever or code in definitive_response_codes:
                        # that's a definitive answer page, point this directly there, including to
                        # its timestamp, to optimize away above redirects
                        unamespace = "web"
                        ustime_selector = url_fmtts(unet_url, ustime)
                        break
                    if code in redirect_response_codes:
                        # that's a redirect, point it there
                        unamespace = "redirect"
                        break
                    # something else
                    unamespace = "other"
                    # NB: continue trying other visits in this case

                return (
                    f"/{unamespace}/{ustime_selector}/{unet_url}" + upurl.ofm + upurl.fragment,
                    exist,
                )

            rrexpr.remap_url = remap_url = cached_remap_url(
                net_url, remap_url_, handle_warning=_logging.warn
            )

            def rebase_remap_url(url: URLType) -> URLType | None:
                try:
                    href = _up.urljoin(net_url, url)
                except ValueError:
                    return None
                res = remap_url(href, LinkType.JUMP, [], True)
                if res is not None:
                    return res[0]
                return None

            # TODO: inherit MIME from generated expression type instead
            rere_obj: Request | Response | None = None
            if inherit is not None:
                rere_obj = getattr(rrexpr.reqres, inherit)

            if rere_obj is not None:
                if isinstance(rere_obj, Response):
                    # inherit response's status code
                    bottle.response.status = rere_obj.code

                    for hn, hv in get_headers(rere_obj.headers):
                        hl = hn.lower()
                        hr: URLType | None = None
                        if hl == "location":
                            hr = rebase_remap_url(hv.strip())
                        elif not_web_replay:
                            continue
                        elif hl in verbatim_http_headers:
                            hr = hv
                        elif hl == "refresh":
                            try:
                                secs, url = parse_refresh_header(hv)
                            except ValueError:
                                pass
                            else:
                                href = rebase_remap_url(url)
                                if href is not None:
                                    hr = unparse_refresh_header(secs, href)
                        elif hl == "link":
                            try:
                                plinks = parse_link_header(hv)
                            except ValueError:
                                pass
                            else:
                                links = []
                                for url, params in plinks:
                                    rel = get_parameter_value(params, "rel", None)
                                    if rel is not None:
                                        allowed_rels = link_rels_of(
                                            rel, blacklist=preload_link_rels
                                        )
                                        if len(allowed_rels) == 0:
                                            continue
                                        params = set_parameter(
                                            params, "rel", " ".join(allowed_rels)
                                        )
                                    href = rebase_remap_url(url)
                                    if href is not None:
                                        links.append((href, params))
                                hr = unparse_link_header(links) if len(links) > 0 else None

                        if hr is not None:
                            bottle.response.add_header(hn, hr)

                ct, sniff = rere_obj.get_content_type()
                bottle.response.set_header("content-type", ct)
                if not sniff:
                    bottle.response.set_header("x-content-type-options", "nosniff")
            else:
                bottle.response.set_header("content-type", "application/octet-stream")

            data: bytes
            with TIOWrappedWriter(_io.BytesIO()) as f:
                print_exprs(rrexpr, cargs.exprs, cargs.separator, f)
                data = f.fobj.getvalue()

            return data
        except Failure as exc:
            exc.elaborate("while processing [%s] `%s`", stime.format(*time_format), surl)
            bottle.abort(500, exc.get_message(gettext))
            return None
        finally:
            rrexpr.unload()

    if stderr.isatty():
        stderr.write_bytes(b"\033[33m")
    if destination is not None:
        stderr.write_str_ln(
            gettext("Working as an archiving server at %s") % (server_url_base + "/",)
        )
    else:
        stderr.write_str_ln(gettext("Archiving server support is disabled"))
    if do_replay:
        stderr.write_str_ln(
            gettext("Serving replays for %d reqres at %s")
            % (index.size, f"{server_url_base}/web/*/*")
        )
    else:
        stderr.write_str_ln(gettext("Replay server support is disabled"))
    if stderr.isatty():
        stderr.write_bytes(b"\033[0m")
    stderr.flush()

    with yes_signals():
        app.run(host=cargs.host, port=cargs.port, quiet=quiet, debug=cargs.debug_bottle)


def add_doc(fmt: argparse.BetterHelpFormatter) -> None:
    _: _t.Callable[[str], str] = gettext

    # fmt: off
    fmt.add_text(_("# Examples"))

    fmt.start_section(_("Pretty-print all reqres in `../simple_server/pwebarc-dump` using an abridged (for ease of reading and rendering) verbose textual representation"))
    fmt.add_code(f"{__prog__} pprint ../simple_server/pwebarc-dump")
    fmt.end_section()

    fmt.start_section(_("Pipe raw response body from a given `WRR` file to stdout"))
    fmt.add_code(f'{__prog__} get ../simple_server/pwebarc-dump/path/to/file.wrr')
    fmt.end_section()

    fmt.start_section(_("Pipe response body scrubbed of dynamic content from a given `WRR` file to stdout"))
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

    fmt.start_section(_("""List paths of all `WRR` files from `../simple_server/pwebarc-dump` that contain complete `200 OK` responses with `text/html` bodies larger than 1K"""))
    fmt.add_code(f"""{__prog__} find --status-re .200C --response-mime text/html --and "response.body|len|> 1024" ../simple_server/pwebarc-dump""")
    fmt.end_section()

    fmt.start_section(_(f"Rename all `WRR` files in `../simple_server/pwebarc-dump/default` according to their metadata using `--output default` (see the `{__prog__} organize` section for its definition, the `default` format is designed to be human-readable while causing almost no collisions, thus making the `num` substitution parameter to almost always stay equal to `0`, making things nice and deterministic)"))
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
    # fmt: on


def make_argparser(real: bool = True) -> argparse.BetterArgumentParser:
    _: _t.Callable[[str], str] = gettext

    # fmt: off
    parser = argparse.BetterArgumentParser(
        prog=__prog__,
        description=_('Inspect, search, organize, programmatically extract values and generate static website mirrors from, archive, view, and replay web archives/dumps in `WRR` ("Web Request+Response", produced by the `Hoardy-Web` Web Extension browser add-on) and `mitmproxy` (`mitmdump`) file formats.')
        + "\n\n"
        + _("Glossary: a `reqres` (`Reqres` when a type/class) is an instance of a structure representing `HTTP` request+response pair with some additional metadata."),
        additional_sections=[add_doc],
        add_version=True,
    )

    subparsers = parser.add_subparsers(title="subcommands")

    def add_errors(cmd: _t.Any) -> None:
        grp = cmd.add_argument_group("error handling")
        grp.add_argument("--errors", choices=["fail", "skip", "ignore"], default="skip",
            help=_("""when an error occurs:
- `fail`: report failure and stop the execution;
- `skip`: report failure, skip relevant inputs/outputs that produced it, and continue; default;
- `ignore`: don't report anything, skip skip relevant inputs/outputs that produced it, and continue;"""),
        )

    datetime_spec = _("""; the `DATETIME` can be specified as
- `@<decimal>` format, where `<decimal>` can be:
  - a floating point number of seconds since UNIX epoch,
  - "-inf", or
  - "+inf";
- one of the following formats:
  - `YYYY`;
  - `YYYY-mm`,
  - `YYYY-mm-DD`,
  - `YYYY-mm-DD HH:MM`,
  - `YYYY-mm-DD HH:MM:SS`,
  - `YYYY-mm-DD HH:MM:SS.[FF*]`;

both formats can be followed by a time zone specified as `(+|-)HHMM`;
if the time zone is not specified, the `DATETIME` is assumed to be in local time;

if other parts of the date are not specified, they get substituted from `<year>-01-01 00:00:00.0`, e.g.:
- `2024` becomes `2024-01-01 00:00:00`,
- `2024-12` becomes `2024-12-01 00:00:00`,
- `2024-12-31` becomes `2024-12-31 00:00:00`,
- `2024-12-31 10` becomes `2024-12-31 10:00:00`,
- `2024-12-31 10:01` becomes `2024-12-31 10:01:00`,
- `2024-12-31 10:01:02` becomes `2024-12-31 10:01:02.0`;"""
    )
    datetime_spec_id = _("; the `DATETIME` format is the same as above")
    datetime_spec_middle = _("""; the `DATETIME` uses the same format as the `--before` option above (which see), except if some parts of the date are not specified, the `DATETIME` is instead parsed as a time interval and the middle point of that interval is then taken as the resulting value, e.g.:
- `2024` becomes `2024-07-02 00:00:00` (which is the exact middle point of that year),
- `2024-12-31` becomes `2024-12-31 12:00:00`,
- `2024-12-31 10` becomes `2024-12-31 10:30:00`,
- `2024-12-31 10:01` becomes `2024-12-31 10:01:30`,
- `2024-12-31 10:01:02` becomes `2024-12-31 10:01:02.5`;"""
    )

    fullmatch_re = _("; this option matches the given regular expression against the whole input value; to match against any part of the input value, use `.*<re>.*` or `^.*<re>.*$`")
    ie_whitelist = _("; in short, this option defines a whitelisted element rule")
    ie_blacklist = _("; in short, this option defines a blacklisted element rule")

    def add_filter_options(cmd: _t.Any) -> None:
        agrp = cmd.add_argument_group("filtering options")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--ignore-case", dest="ignore_case", action="store_true",
            help=_("when filtering with `--*grep*`, match case-insensitively"),
        )
        grp.add_argument("--case-sensitive", dest="ignore_case", action="store_false",
            help=_("when filtering with `--*grep*`, match case-sensitively"),
        )
        grp.add_argument("--smart-case", dest="ignore_case", action="store_const", const=None,
            help=_("when filtering with `--*grep*`, match case-insensitively if there are no uppercase letters in the corresponding `*PATTERN*` option argument and case-sensitively otherwise; default"),
        )
        cmd.set_defaults(ignore_case=None)

    def add_filters(cmd: _t.Any, do_what: str, root: bool = False) -> None:
        if not root:
            intro = _("input filters; if none are specified, then all reqres from input `PATH`s will be taken")
            opt_prefix = ""
            root_short = []
        else:
            intro = _("recursion root filters; if none are specified, then all URLs available from input `PATH`s will be treated as roots (except for those given via `--boring`)")
            opt_prefix = "root-"
            root_short = ["--root", "-r"]

        agrp = cmd.add_argument_group(
            intro
            + _("""; can be specified multiple times in arbitrary combinations; the resulting logical expression that will be checked is `all_of(before) and all_of(not_before) and all_of(after) and all_of(not_after) and any_of(protocol) and not any_of(not_protcol) and any_of(request_method) and not any_of(not_request_method) ... and any_of(grep) and not any_of(not_grep) and all_of(and_grep) and not all_of(not_and_grep) and all_of(ands) and any_of(ors)`""")
        )

        def add_time_filter(opt: str, what: str, sub: str) -> None:
            agrp.add_argument(f"--{opt_prefix}{opt}", metavar="DATETIME", action="append", type=str, default=[],
                help=_(f"{do_what} its `stime` is {what} than this value") + sub,
            )

        add_time_filter("before", "smaller", datetime_spec)
        add_time_filter("not-before", "larger or equal", datetime_spec_id)
        add_time_filter("after", "larger", datetime_spec_id)
        add_time_filter("not-after", "smaller or equal", datetime_spec_id)

        def map_opts(suffix: str, *opts: str) -> list[str]:
            return list(map(lambda opt: f"--{opt_prefix}{opt}{suffix}", opts))

        def add_str_filter(
            opt: str,
            yes: bool,
            what: str,
            what_p: str,
            what_re: str,
            *,
            short: list[str] = [],
            abs_short: list[str] = [],
            abs_short_p: list[str] = [],
            abs_short_re: list[str] = [],
            sub: str = "",
            sub_p: str = "",
            sub_re: str = "",
        ) -> None:
            metavar = opt.upper().replace("-", "_")
            if yes:
                one_of, is_equal_to, is_a_prefix, matches, wb = "one of", "is equal to", "is a prefix", "matches", ie_whitelist
            else:
                one_of, is_equal_to, is_a_prefix, matches, wb = "none of", "are equal to", "are a prefix", "match", ie_blacklist

            agrp.add_argument(*map_opts("", opt, *short), *abs_short, metavar=metavar, action="append", type=str, default=[],
                help=_(f"{do_what} {one_of} the given `{metavar}` option arguments {is_equal_to} its {what}")
                + sub + wb,
            )
            agrp.add_argument(*map_opts("-prefix", opt, *short), *abs_short_p, metavar=f"{metavar}_PREFIX", action="append", type=str, default=[],
                help=_(f"{do_what} {one_of} the given `{metavar}_PREFIX` option arguments {is_a_prefix} of its {what_p}")
                + sub_p + wb,
            )
            agrp.add_argument(*map_opts("-re", opt, *short), *abs_short_re, metavar=f"{metavar}_RE", action="append", type=str, default=[],
                help=_(f"{do_what} {one_of} the given `{metavar}_RE` regular expressions {matches} its {what_re}")
                + sub_re + wb,
            )

        def add_yn_str_filter(opt: str, *args: _t.Any, **kwargs: _t.Any) -> None:
            add_str_filter(opt, True, *args, **kwargs)
            kwargs["short"] = map(lambda opt: "not-" + opt, kwargs.get("short", []))
            add_str_filter("not-" + opt, False, *args, **kwargs)

        def add_field_filter(opt: str, field: str, *args: _t.Any, **kwargs: _t.Any) -> None:
            what = f"`{field}` (of `{__prog__} get --expr`, which see)"
            kwargs["sub_re"] = kwargs["sub_re"] + " " + fullmatch_re if "sub_re" in kwargs else fullmatch_re
            add_yn_str_filter(opt, what, what, what, *args, **kwargs)

        add_field_filter("protocol", "protocol")
        add_field_filter("request-method", "request.method", short=["method"])
        add_field_filter("status", "status")

        mixed_url_allowed = (
            _("; Punycode UTS46 IDNAs, plain UNICODE IDNAs, percent-encoded URL components, and UNICODE URL components in arbitrary mixes and combinations are allowed; e.g. `%s` will be silently normalized into its Punycode UTS46 and percent-encoded version of `%s`, which will then be matched against")
            % (example_url[-1], example_url[-2])
        ).replace("%", "%%")
        similarly_allowed = _("; similarly to the previous option, arbitrary mixes of URL encodinds are allowed")
        unmixed_reurl_allowed = _("; only Punycode UTS46 IDNAs with percent-encoded URL components or plain UNICODE IDNAs with UNICODE URL components are allowed; regular expressions that use mixes of differently encoded parts will fail to match properly")
        same_allowed = _("; option argument format and caveats are idential to the `not-`less option above")

        def add_url_filter(opt: str, field: str, yes: bool, **kwargs: _t.Any) -> None:
            what = f"`{field}` (of `{__prog__} get --expr`, which see)"
            add_str_filter(opt, yes, what, what,
                f"`{field}` or `pretty_{field}` (of `{__prog__} get --expr`, which see)",
                sub=mixed_url_allowed if yes else same_allowed,
                sub_p=similarly_allowed if yes else same_allowed,
                sub_re=unmixed_reurl_allowed + fullmatch_re if yes else same_allowed,
                **kwargs,
            )

        add_url_filter("url", "net_url", True, abs_short_p=root_short)
        add_url_filter("not-url", "net_url", False)

        def add_grep_filter(
            opt: str,
            metavar: str,
            what: str,
            what_re: str,
            short: list[str] = [],
            sub: str = "",
            sub_re: str = "",
        ) -> None:
            agrp.add_argument(*map_opts("", opt, *short), metavar=metavar, action="append", type=str, default=[],
                help=_(f"{do_what} {what}") + sub,
            )
            agrp.add_argument(*map_opts("-re", opt, *short), metavar=f"{metavar}_RE", action="append", type=str, default=[],
                help=_(f"{do_what} {what_re}") + sub_re,
            )

        grep_headers = _("; each `HTTP` header of `*.headers` is matched as a single `<header_name>: <header_value>` value")
        grep_binary = _("; at the moment, binary values are matched against given option arguments by encoding the latter into `UTF-8` first, which means that `*.headers` and `*.body` values that use encodings other than `UTF-8` are not guaranteed to match properly")

        def add_greps(
            prefix: str, opt: str, multi: bool, what: str, what_id: str, sub: str, sub_id: str
        ) -> None:
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
                short=[f"{prefix}{opt}"],
                sub=sub + ie_whitelist,
                sub_re=sub_id + ie_whitelist,
            )
            add_grep_filter(f"not-{prefix}or-{opt}", "NOT_OR_PATTERN",
                f"none of the given `NOT_OR_PATTERN` option arguments are substrings of {many}{what_id}",
                f"none of the given `NOT_OR_PATTERN_RE` regular expressions match any substrings of {many}{what_id}",
                short=[f"not-{prefix}{opt}"],
                sub=sub_id + ie_blacklist,
                sub_re=sub_id + ie_blacklist,
            )

            add_grep_filter(f"{prefix}and-{opt}", "AND_PATTERN",
                f"each of the given `AND_PATTERN` option arguments is a substring of {msome}{what_id}",
                f"each of the given `AND_PATTERN_RE` regular expressions matches a substring of {msome}{what_id}",
                sub=sub_id,
                sub_re=sub_id,
            )
            add_grep_filter(f"not-{prefix}and-{opt}", "NOT_AND_PATTERN",
                f"one or more of the given `NOT_AND_PATTERN` option arguments is not a substring of {mel}{what_id}",
                f"one or more of the given `NOT_AND_PATTERN_RE` regular expressions fails to match any substrings of {mel}{what_id}",
                sub=sub_id,
                sub_re=sub_id,
            )

        example_mime = list(canonical_mime_of.items())[0]
        mixed_mime_allowed = _("; both canonical and non-canonical MIME types are allowed; e.g., giving `%s` or `%s` will produce the same predicate") % (example_mime[0], example_mime[1])
        unmixed_pmime_allowed = _("; given prefixes will only ever be matched against canonicalized MIME types")
        unmixed_remime_allowed = _("; given regular expressions will only ever be matched against canonicalized MIME types")

        def add_mime_filter(opt: str, side: str, yes: bool) -> None:
            what = f"`{side}_mime` (of `{__prog__} get --expr`, which see)"
            add_str_filter(opt, yes, what, what, what,
                sub=mixed_mime_allowed if yes else same_allowed,
                sub_p=unmixed_pmime_allowed if yes else same_allowed,
                sub_re=unmixed_remime_allowed + fullmatch_re if yes else same_allowed,
            )

        def add_rr_filter(side: str) -> None:
            add_greps(f"{side}-headers-", "grep", True,
                f"the list containing all `{side}.headers` (of `{__prog__} get --expr`, which see)",
                "the above list",
                grep_headers + grep_binary,
                _("; matching caveats are the same as above"),
            )

            add_greps(f"{side}-body-", "grep", False,
                f"`{side}.body` (of `{__prog__} get --expr`, which see)",
                f"`{side}.body`",
                grep_binary,
                _("; matching caveats are the same as above"),
            )

            add_mime_filter(f"{side}-mime", side, True)
            add_mime_filter(f"not-{side}-mime", side, False)

        add_rr_filter("request")
        add_rr_filter("response")

        add_greps("", "grep", True,
            f"the list containing `raw_url`, `url`, `pretty_url`, all `request.headers`, `request.body`, all `response.headers`, and `response.body` (of `{__prog__} get --expr`, which see)",
            "the above list",
            grep_headers + grep_binary,
            _("; matching caveats are the same as above"),
        )

        agrp.add_argument(f"--{opt_prefix}and", metavar="EXPR", action="append", type=str, default=[],
            help=_(f"{do_what} all of the given expressions of the same format as `{__prog__} get --expr` (which see) evaluate to `true`"),
        )
        agrp.add_argument(f"--{opt_prefix}or", metavar="EXPR", action="append", type=str, default=[],
            help=_(f"{do_what} some of the given expressions of the same format as `{__prog__} get --expr` (which see) evaluate to `true`"),
        )

    def add_default_filters(cmd: _t.Any, kind: str = "input") -> None:
        agrp = cmd.add_argument_group(f"default {kind} filters")
        if kind == "input":
            def_def = '--status-re ".(200|30[012378])C"'
            what, unwhat, inputs = "index", "ignore", "inputs"
            def_note = _("; this matches complete `200 OK` and `300 Multiple Choices` responses and various redirects")
            undef_note = _(f"""; if you set this option, you should also probably set at least `--status-re ".*C" --not-status-re ".206."`, unless you want `{__prog__} mirror` processing partially downloaded data""")
        elif kind == "root":
            def_def = '--root-status-re ".[23]00C"'
            what, unwhat, inputs = "queue", "skip", "indexed"
            def_note = _("; this matches complete `200 OK` and `300 Multiple Choices` responses")
            undef_note = _(f"""; `{__prog__} mirror` will follow redirects when remapping links, but, at the moment, attempting to render redirects produces empty files; thus, if you set this option, you should also set `--not-status-re ".30[12378]."` or similar""")
        else:
            assert False

        ddest = f"default_{kind}_filters"
        agrp.add_argument(f"--{unwhat}-some-{inputs}", dest=ddest, action="store_true",
            help=_(f"initialize {kind} filters to `%s`") % (def_def,) + def_note + _("; default"),
        )
        agrp.add_argument(f"--{what}-all-{inputs}", dest=ddest, action="store_false",
            help=_(f"do not set any {kind} filters by default") + undef_note,
        )
        cmd.set_defaults(**{ddest: True})

    def add_pure(cmd: _t.Any) -> None:
        cmd.add_argument("-q", "--quiet", action="store_true",
            help=_("don't print end-of-filtering warnings to stderr"),
        )

    def add_impure(cmd: _t.Any) -> None:
        cmd.add_argument("--dry-run", action="store_true",
            help= _("perform a trial run without actually performing any changes"),
        )
        cmd.add_argument("-q", "--quiet", action="store_true",
            help=_("don't log file updates and don't print end-of-filtering warnings to stderr"),
        )

    def add_common(cmd: _t.Any, kind: str, filter_what: str) -> None:
        add_errors(cmd)
        add_paths(cmd, kind)
        add_sniff(cmd, kind)
        if real:
            add_filter_options(cmd)
            add_filters(cmd, filter_what)
        if kind in ("mirror", "serve"):
            add_default_filters(cmd)
        if kind == "mirror":
            add_default_filters(cmd, "root")

    def add_abridged(cmd: _t.Any) -> None:
        grp = cmd.add_mutually_exclusive_group()
        grp.add_argument("-u", "--unabridged", dest="abridged", action="store_false",
            help=_("print all data in full"),
        )
        grp.add_argument("--abridged", action="store_true",
            help=_("shorten long strings for brevity, useful when you want to visually scan through batch data dumps; default"),
        )
        cmd.set_defaults(abridged=True)

    def add_termsep(
        cmd: _t.Any,
        name: str,
        what: str,
        short: bool = True,
        default: bytes = b"\n",
        allow_not: bool = False,
    ) -> None:
        agrp = cmd.add_argument_group(what)
        grp = agrp.add_mutually_exclusive_group()
        def_def = "; " + _("default")

        grp.add_argument(*optlist(short, "-l"), f"--lf-{name}ated", dest=f"{name}ator", action="store_const", const=b"\n",
            help=_(f"... by {name}ating them with `\\n` (LF) newline characters") + (def_def if default == b"\n" else ""),
        )
        grp.add_argument(*optlist(short, "-z"), f"--zero-{name}ated", dest=f"{name}ator", action="store_const", const=b"\0",
            help=_(f"... by {name}ating them with `\\0` (NUL) bytes") + (def_def if default == b"\0" else ""),
        )
        if allow_not:
            grp.add_argument(f"--not-{name}ated", dest=f"{name}ator", action="store_const", const=b"",
                help=_("... by simply concatenating them"),
            )

        if name == "termin":
            cmd.set_defaults(terminator=default)
        elif name == "separ":
            cmd.set_defaults(separator=default)

    def add_terminator(cmd: _t.Any, *args: _t.Any, **kwargs: _t.Any) -> None:
        add_termsep(cmd, "termin", *args, **kwargs)

    def add_separator(cmd: _t.Any, *args: _t.Any, allow_not: bool = True, **kwargs: _t.Any) -> None:
        add_termsep(cmd, "separ", *args, allow_not=allow_not, **kwargs)  # type: ignore

    def add_paths(cmd: _t.Any, kind: str) -> None:
        def_paths: WalkOrder | None
        def_walk: WalkOrder | None
        if kind == "organize":
            def_def = "; " + _("default when `--no-overwrite`")
            def_sup = "; " + _("default when `--latest`")
            def_paths = None
            def_walk = None
        else:
            def_def = "; " + _("default")
            def_sup = ""
            def_paths = WalkOrder.NONE
            def_walk = WalkOrder.SORT

        agrp = cmd.add_argument_group("path ordering")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--paths-given-order", dest="walk_paths", action="store_const", const=WalkOrder.NONE,
            help=_("`argv` and `--stdin0` `PATH`s are processed in the order they are given") + def_def,
        )
        grp.add_argument("--paths-sorted", dest="walk_paths", action="store_const", const=WalkOrder.SORT,
            help=_("`argv` and `--stdin0` `PATH`s are processed in lexicographic order"),
        )
        grp.add_argument("--paths-reversed", dest="walk_paths", action="store_const", const=WalkOrder.REVERSE,
            help=_("`argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order") + def_sup,
        )
        cmd.set_defaults(walk_paths=def_paths)

        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--walk-fs-order", dest="walk_fs", action="store_const", const=WalkOrder.NONE,
            help=_("recursive file system walk is done in the order `readdir(2)` gives results"),
        )
        grp.add_argument("--walk-sorted", dest="walk_fs", action="store_const", const=WalkOrder.SORT,
            help=_("recursive file system walk is done in lexicographic order") + def_def,
        )
        grp.add_argument("--walk-reversed", dest="walk_fs", action="store_const", const=WalkOrder.REVERSE,
            help=_("recursive file system walk is done in reverse lexicographic order") + def_sup,
        )
        cmd.set_defaults(walk_fs=def_walk)

        agrp = cmd.add_argument_group("input loading")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--load-any", dest="loader", action="store_const", const=None,
            help=_("for each given input `PATH`, decide which loader to use based on its file extension; default"),
        )
        grp.add_argument("--load-wrr", dest="loader", action="store_const", const="wrr",
            help=_("load all inputs using the single-`WRR` per-file loader"),
        )
        grp.add_argument("--load-wrrb", dest="loader", action="store_const", const="wrr",
            help=_("load all inputs using the `WRR` bundle loader, this will load separate `WRR` files as single-`WRR` bundles too"),
        )
        grp.add_argument("--load-mitmproxy", dest="loader", action="store_const", const="mitmproxy",
            help=_("load inputs using the `mitmproxy` dump loader"),
        )
        grp.set_defaults(loader=None)

        agrp.add_argument("--stdin0", action="store_true",
            help=_("read zero-terminated `PATH`s from stdin, these will be processed after all `PATH`s specified as command-line arguments"),
        )

        if kind == "mirror":
            agrp.add_argument("--boring", metavar="PATH", action="append", type=str, default=[],
                help=_("low-priority input `PATH`; boring `PATH`s will be processed after all `PATH`s specified as positional command-line arguments and those given via `--stdin0` and will not be queued as roots even when no `--root-*` options are specified"),
            )

        agrp.add_argument("paths", metavar="PATH", nargs="*", type=str,
            help=_("inputs, can be a mix of files and directories (which will be traversed recursively)"),
        )

    def add_sniff(cmd: _t.Any, kind: str) -> None:
        oscrub = f"this influeences generated file names because `filepath_parts` and `filepath_ext` of `{__prog__} get --expr` (which see) depend on both the original file extension present in the URL and the detected `MIME` type of its content"
        wscrub = "higher values make the `scrub` function (which see) censor out more things when `-unknown`, `-styles`, or `-scripts` options are set; in particular, at the moment, with `--sniff-paranoid` and `-scripts` most plain text files will be censored out as potential `JavaScript`"
        if kind == "pprint":
            what = "this simply populates the `potentially` lists in the output in various ways"
        elif kind in ("organize", "import"):
            what = oscrub
        elif kind != "mirror":
            what = wscrub
        else:
            what = f"{oscrub}; also, {wscrub}"

        agrp = cmd.add_argument_group(
            _("`MIME` type sniffing; this controls the use of the [`mimesniff` algorithm](https://mimesniff.spec.whatwg.org/); for this subcommand " + what)
        )
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--sniff-default", dest="sniff", action="store_const", const=SniffContentType.NONE,
            help=_("run `mimesniff` when the spec says it should be run; i.e. trust `Content-Type` `HTTP` headers most of the time; default"),
        )
        grp.add_argument("--sniff-force", dest="sniff", action="store_const", const=SniffContentType.FORCE,
            help=_("run `mimesniff` regardless of what `Content-Type`  and `X-Content-Type-Options` `HTTP` headers say; i.e. for each reqres, run `mimesniff` algorithm on the `Content-Type` `HTTP` header and the actual contents of `(request|response).body` (depending on the first argument of `scrub`) to determine what the body actually contains, then interpret the data as intersection of what `Content-Type` and `mimesniff` claim it to be; e.g. if `Content-Type` says `text/plain` but `mimesniff` says `text/plain or text/javascript`, interpret it as `text/plain`"),
        )
        grp.add_argument("--sniff-paranoid", dest="sniff", action="store_const", const=SniffContentType.PARANOID,
            help=_("do what `--sniff-force` does, but interpret the results in the most paranoid way possible; e.g. if `Content-Type` says `text/plain` but `mimesniff` says `text/plain or text/javascript`, interpret it as `text/plain or text/javascript`; which, for instance, will then make `scrub` with `-scripts` censor it out, since it can be interpreted as a script"),
        )
        grp.set_defaults(sniff=SniffContentType.NONE)

    def no_cmd(_cargs: _t.Any) -> None:
        parser.print_help(stderr)
        _sys.exit(2)

    parser.set_defaults(func=no_cmd)

    if not real:
        add_filter_options(parser)
        add_filters(parser, "accept reqres for processing when")

    # pprint
    cmd = subparsers.add_parser("pprint", aliases=["print", "inspect"],
        help=_("pretty-print given inputs"),
        description=_("""Pretty-print given inputs to stdout."""),
    )
    add_pure(cmd)
    add_common(cmd, "pprint", "pretty-print reqres when")
    add_abridged(cmd)
    cmd.set_defaults(func=cmd_pprint)

    class AddExpr(argparse.Action):
        def __call__(
            self,
            parser: _t.Any,
            cfg: argparse.Namespace,
            value: _t.Any,
            option_string: str | None = None,
        ) -> None:
            cfg.exprs.append(compile_expr(value))

    fd_fileobj = {0: stdin, 1: stdout, 2: stderr}

    class AddExprFd(argparse.Action):
        def __call__(
            self,
            parser: _t.Any,
            cfg: argparse.Namespace,
            value: _t.Any,
            option_string: str | None = None,
        ) -> None:
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

    def add_expr(cmd: _t.Any, kind: str) -> None:
        def __(value: str, indent: int = 6) -> str:
            prefix = " " * indent
            lines = value.split("\n")
            return f"\n{prefix}".join([_(line) for line in lines]).replace("%", "%%")

        agrp = cmd.add_argument_group("expression evaluation")

        if kind == "get":
            agrp.add_argument("--expr-fd", metavar="INT", type=int, default=1,
                help=_("file descriptor to which the results of evaluations of the following `--expr`s computations should be written; can be specified multiple times, thus separating different `--expr`s into different output streams; default: `%(default)s`, i.e. `stdout`"),
            )

            agrp.add_argument("-e", "--expr", dest="mexprs", metavar="EXPR", action=AddExprFd, type=str, default={},
                help=_('an expression to compute; can be specified multiple times in which case computed outputs will be printed sequentially (see also "printing" options below); the default depends on options below')
                + _("; each `EXPR` describes a state-transformer (pipeline) which starts from value `None` and evaluates a script built from the following")
                + ":\n- "
                + _("constants and functions:")
                + "\n"
                + "".join(
                    [f"  - `{name}`: {__(value[0])}\n" for name, value in ReqresExpr_atoms.items()]
                )
                + "- "
                + _("reqres fields, these work the same way as constants above, i.e. they replace current value of `None` with field's value, if reqres is missing the field in question, which could happen for `response*` fields, the result is `None`")
                + ":\n"
                + "".join([f"  - `{name}`: {__(value)}\n" for name, value in Reqres_fields.items()])
                + "- "
                + _("derived attributes:")
                + "\n"
                + "".join(
                    [
                        f"  - `{name}`: {__(value)}\n"
                        for name, value in ReqresExpr_derived_attrs.items()
                    ]
                )
                + "- "
                + _("a compound expression built by piping (`|`) the above, for example")
                + __(
                    f""":
- `{default_expr("get", "raw_sbody")}` (the default for `get` and `run`) will print raw `response.body` or an empty byte string, if there was no response;
- `{default_expr("get", "raw_sbody")}|scrub response defaults` will take the above value, `scrub` it using default content scrubbing settings which will censor out all actions and references to page requisites;
- `response.complete` will print the value of `response.complete` or `None`, if there was no response;
- `response.complete|false` will print `response.complete` or `False`;
- `net_url|to_ascii|sha256|to_hex` will print a hexadecimal representation of the `sha256` hash of the URL that was actually sent over the network;
- `net_url|to_ascii|sha256|take_prefix 2|to_hex` will print the first 2 bytes (4 characters) of the above;
- `path_parts|take_prefix 3|pp_to_path` will print first 3 path components of the URL, minimally quoted to be used as a path;
- `query_ne_parts|take_prefix 3|qsl_to_path|abbrev 128` will print first 3 non-empty query parameters of the URL, abbreviated to 128 characters or less, minimally quoted to be used as a path;""",
                    2,
                )
                + "\n\nExample URL mappings:\n"
                + "".join(
                    [f"  - `{name}`:\n" + atom_example(name, 4) + "\n" for name in atom_test]
                ),
            )
        else:
            agrp.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action=AddExpr, type=str, default=[],
                help=_(f"an expression to compute, same expression format and semantics as `{__prog__} get --expr` (which see); can be specified multiple times; the default depends on `--remap-*` options below"),
            )

        if kind == "stream":
            add_terminator(cmd, "print `--format=raw` `--expr` output values", allow_not=True)
            cmd.set_defaults(default_expr="dot")
        elif kind in ("mirror", "serve"):
            add_separator(cmd, "render `--expr` values into `--output` files", short=False)
            cmd.set_defaults(default_expr="all")
        else:
            add_separator(cmd, "print `--expr` values")
            cmd.set_defaults(default_expr="raw_sbody")

        def alias(what: str) -> str:
            return _("set the default value of `--expr` to `%s`") % (default_expr(kind, what),)

        agrp = cmd.add_argument_group("default value of `--expr`")
        grp = agrp.add_mutually_exclusive_group()

        if kind == "stream":
            grp.add_argument("--structure", dest="default_expr", action="store_const", const="dot",
                help=alias("dot") + _("; i.e. dump the whole structure; default"),
            )

        grp.add_argument("--raw-qbody", dest="default_expr", action="store_const", const="raw_qbody",
            help=alias("raw_qbody")
            + _("; i.e. produce the raw request body"),
        )
        grp.add_argument("--raw-sbody", "--no-remap", dest="default_expr", action="store_const", const="raw_sbody",
            help=alias("raw_sbody")
            + _("; i.e. produce the raw response body")
            + (_("; default") if kind in ("get", "run") else ""),
        )

        grp.add_argument("--remap-id", dest="default_expr", action="store_const", const="id",
            help=alias("id")
            + _("; i.e. `scrub` response body as follows: remap all URLs with an identity function (which, as a whole, is NOT an identity function, it will transform all relative URLs into absolute ones), censor out all dynamic content (e.g. `JavaScript`); results will NOT be self-contained"),
        )
        grp.add_argument("--remap-void", dest="default_expr", action="store_const", const="void",
            help=alias("void")
            + _("; i.e. `scrub` response body as follows: remap all URLs into `javascript:void(0)` and empty `data:` URLs, censor out all dynamic content; results will be self-contained"),
        )

        if kind == "serve":
            grp.add_argument("--remap-semi", dest="default_expr", action="store_const", const="semi",
                help=alias("semi")
                + _("; i.e. `scrub` response body as follows: keeps all jump links pointing to unarchived URLs as-is, remap all other links and references to their replay URLs, censor out all dynamic content; results will be self-contained"),
            )
            grp.add_argument("--remap-all", dest="default_expr", action="store_const", const="all",
                help=alias("all")
                + _("; i.e. `scrub` response body as follows: remap all links and references to their replay URLs, even when they are not available in the index, censor out all dynamic content; results will be self-contained; default"),
            )
            return

        if kind != "mirror":
            return

        grp.add_argument("--remap-open", "-k", "--convert-links", dest="default_expr", action="store_const", const="open",
            help=alias("open")
            + _("; i.e. `scrub` response body as follows: remap all URLs present in input `PATH`s and reachable from `--root-*`s in no more that `--depth` steps to their corresponding `--output` paths, remap all other URLs like `--remap-id` does, censor out all dynamic content; results almost certainly will NOT be self-contained"),
        )
        grp.add_argument("--remap-closed", dest="default_expr", action="store_const", const="closed",
            help=alias("closed")
            + _("; i.e. `scrub` response body as follows: remap all URLs present in input `PATH`s and reachable from `--root-*`s in no more that `--depth` steps to their corresponding `--output` paths, remap all other URLs like `--remap-void` does, censor out all dynamic content; results will be self-contained"),
        )
        grp.add_argument("--remap-semi", dest="default_expr", action="store_const", const="semi",
            help=alias("semi")
            + _("; i.e. `scrub` response body as follows: remap all jump links like `--remap-open` does, remap action links and references to page requisites like `--remap-closed` does, censor out all dynamic content; this is a better version of `--remap-open` which keeps the `mirror`s self-contained with respect to page requisites, i.e. generated pages can be opened in a web browser without it trying to access the Internet, but all navigations to missing and unreachable URLs will still point to the original URLs; results will be semi-self-contained"),
        )
        grp.add_argument("--remap-all", dest="default_expr", action="store_const", const="all",
            help=alias("all")
            + _(f"""; i.e. `scrub` response body as follows: remap all links and references like `--remap-closed` does, except, instead of voiding missing and unreachable URLs, replace them with fallback URLs whenever possble, censor out all dynamic content; results will be self-contained; default

`{__prog__} mirror` uses `--output` paths of trivial `GET <URL> -> 200 OK` as fallbacks for `&(jumps|actions|reqs)` options of `scrub`.
This will remap links pointing to missing and unreachable URLs to missing files.
However, for simple `--output` formats (like the default `hupq`), those files can later be generated by running `{__prog__} mirror` with `WRR` files containing those missing or unreachable URLs as inputs.
I.e. this behaviour allows you to add new data to an already existing mirror without regenerating old files that reference newly added URLs.
I.e. this allows `{__prog__} mirror` to be used incrementally.

Note however, that using fallbacks when the `--output` format depends on anything but the URL itself (e.g. if it mentions timestamps) will produce a mirror with unrecoverably broken links.
"""),
        )

        agrp = cmd.add_argument_group("link conversions")
        grp = agrp.add_mutually_exclusive_group()

        grp.add_argument("--relative", dest="absolute", action="store_false",
            help=_("when remapping URLs to local files, produce links and references with relative URLs (relative to the `--output` files under `OUTPUT_DESTINATION`); default when `--copy` or `--hardlink`"),
        )
        grp.add_argument("--absolute", dest="absolute", action="store_true",
            help=_("when remapping URLs to local files, produce links and references with absolute URLs; default when `--symlink`"),
        )
        cmd.set_defaults(absolute=None)

    # get
    cmd = subparsers.add_parser("get",
        help=_("print values produced by evaluating given expressions on a given input"),
        description=_("""Print results produced by evaluating given `EXPR`essions on a given input to stdout.

Algorithm:

- Load input `PATH`;
- evaluate all `EXPR` expressions on the resulting reqres;
- print all the results to stdout, terminating each value as specified.

The end.
"""),
    )

    add_sniff(cmd, "get")
    add_expr(cmd, "get")

    cmd.add_argument("path", metavar="PATH", type=str,
        help=_("input `WRR` file path"),
    )
    cmd.set_defaults(func=cmd_get)

    # run
    cmd = subparsers.add_parser("run", aliases=["spawn"],
        help=_("spawn a process with temporary files generated from given expressions evaluated on given inputs"),
        description=_(f"""Spawn `COMMAND` with given static `ARG`uments and `NUM` additional arguments generated by evaluating given `EXPR`essions on given `PATH`s into temporary files.

Algorithm:

- Load `NUM` given `PATH`s (`--num-args` decides the point at which `argv` get split into `ARG`s and `PATH`s);
- for each of `NUM` resulting reqres:
  - evaluate `EXPR` expressions;
  - write the results into a newly generated temporary file, terminating each value as specified;
- spawn given `COMMAND` with given `ARG` arguments and `NUM` additional arguments that are paths of the files generated in the previous step,
- wait for it to finish,
- delete the temporary files,
- exit with the return code of the spawned process.

The end.

Essentially, this is `{__prog__} get` into a temporary file for each given `PATH`, followed by spawning of `COMMAND`, followed by cleanup when it finishes.
"""),
    )

    add_sniff(cmd, "run")
    add_expr(cmd, "run")

    cmd.add_argument("-n", "--num-args", metavar="NUM", type=int, default=1,
        help=_("number of `PATH`s; default: `%(default)s`"),
    )
    cmd.add_argument("command", metavar="COMMAND", type=str,
        help=_("command to spawn")
    )
    cmd.add_argument("args", metavar="ARG", nargs="*", type=str,
        help=_("static arguments to give to the `COMMAND`"),
    )
    cmd.add_argument("paths", metavar="PATH", nargs="+", type=str,
        help=_("input `WRR` file paths to be mapped into new temporary files"),
    )
    cmd.set_defaults(func=cmd_run)

    # stream
    cmd = subparsers.add_parser("stream",
        help=_(f"stream lists containing values produced by evaluating given expressions on given inputs, a generalized `{__prog__} get`"),
        description=_(f"""Stream lists of results produced by evaluating given `EXPR`essions on given inputs to stdout.

Algorithm:

- For each input `PATH`:
  - load it;
  - evaluate all `EXPR` expressions on the resulting reqres;
  - encode the resulting list into a requested `FORMAT`;
  - print it to stdout.

The end.

Essentially, this is a generalized `{__prog__} get`.
"""),
    )
    add_pure(cmd)
    add_common(cmd, "stream", "stream-print reqres when")
    add_abridged(cmd)
    cmd.add_argument("--format", metavar="FORMAT", choices=["py", "cbor", "json", "raw"], default="py",
        help=_("""generate output in:
- py: Pythonic Object Representation aka `repr`; default
- cbor: Concise Binary Object Representation aka `CBOR` (RFC8949)
- json: JavaScript Object Notation aka `JSON`; **binary data can't be represented, UNICODE replacement characters will be used**
- raw: concatenate raw values; termination is controlled by `*-terminated` options
"""),
    )
    add_expr(cmd, "stream")
    cmd.set_defaults(func=cmd_stream)

    # find
    cmd = subparsers.add_parser("find",
        help=_("print paths of inputs matching specified criteria"),
        description=_("""Print paths of inputs matching specified criteria.

Algorithm:

- For each input `PATH`:
  - load one or more reqres from it;
  - for each reqres:
    - if it does not satisfy given filters, skip it;
    - print its path to stdout.

The end.
"""),
    )
    add_pure(cmd)
    add_common(cmd, "find", "print path of reqres when")
    add_terminator(cmd, "print paths of matching `WRR` files")
    cmd.set_defaults(sniff=SniffContentType.NONE)
    cmd.set_defaults(func=cmd_find)

    def add_organize(cmd: _t.Any, kind: str, cache: int = 8192, batch: int = 128) -> None:
        agrp = cmd.add_argument_group("caching")
        agrp.add_argument("--cache", "--cache-number", metavar="INT", type=int, default=cache,
            help=_("cache at most this many output paths in RAM; default: `%(default)s`")
        )
        agrp.add_argument("--batch", "--batch-number", metavar="INT", type=int, default=batch,
            help=_("""batch at most this many file system operations (`write`s, `fsync`s, `--move`-related `unlink`s, etc); default: `%(default)s`;
which is to say that `--batch 0` forces all file system operations to be performed immediately;
meanwhile, `--batch N` for `N > 0` enables batching of file system operations, which, in most situations, greatly improves observed program performance, since batching greatly reduces the number of needed directory `fsync`s"""),
        )
        agrp.add_argument("--memory", "--max-memory", metavar="INT", type=int, default=1024,
            help=_("while applying the above settings, try to limit total memory consumption to this value, in MiB; default: `%(default)s`"),
        )
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--lazy", dest="lazy", action="store_true",
            help=(
                _("set all of the options above to positive infinities; default when `--dry-run` is set")
                + ";\n"
                + _(f"""in other words, compute everything in RAM and then write the results to disk in a single batch;
useful for `{__prog__} organize --symlink --latest --output flat` and similar in cases when the number of inputs is large, the number of distinct `--output` values is small, you have enough RAM to do everything in-memory, and you want to minimize writes to disk;
default when `--dry-run` is set because otherwise the results of a run with `--dry-run` will differ from a normal run since some non-run updates could be emitted from cache""")
            ),
        )
        grp.add_argument("--no-lazy", dest="lazy", action="store_false",
            help=_("use the above values, even if `--dry-run` is set; default when `--dry-run` is not set"),
        )
        cmd.set_defaults(lazy=None)

        agrp = cmd.add_argument_group("fsyncs")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--fsync", dest="fsync", action="store_true",
            help=("perform all `fsync`s properly; default"),
        )
        grp.add_argument("--no-fsync", dest="fsync", action="store_false",
            help=("""skip all `fsync`s; setting this also forces `--batch 0`;
this option should only be used for testing or when both inputs and outputs are stored on the same file system which is also running in `data=ordered` mode;
in all other situations **the use of this option is DANGEROUS as it could result in INCONSISTENT DISK STATES and/or LOSE SOME OF YOUR DATA on power loss**;
the latter is the reason why the combination of `--no-sync --move` also requires `--please-destroy-my-data`""")
        )
        cmd.set_defaults(fsync=True)

        is_organize = kind == "organize"

        agrp = cmd.add_argument_group("deferring")
        grp = agrp.add_mutually_exclusive_group()
        grp.add_argument("--defer", dest="defer", action="store_true",
            help=(
                _("defer all updates into the cache and perform them as cache elements get evicted")
                + (_("; default unless `--dry-run` is set") if is_organize else "")
            ),
        )
        grp.add_argument("--no-defer", dest="defer", action="store_false",
            help=(
                _("perform all updates eagerly, never deferring them into the cache")
                + (_("; default unless `--dry-run` is set") if not is_organize else "")
                + ";\n"
                + _("""in other words, force output files to be batched for writing in the order their respective reqres appear among the given `INPUT`s;
note that this option being set does note imply that the resulting file system operations will be performed immediately, to force that this option needs to be combined with `--batch 0` or `--no-sync` (which see)""")
            ),
        )
        cmd.set_defaults(defer=is_organize)

    def add_fileout(cmd: _t.Any, kind: str) -> None:
        if kind == "serve":
            agrp = cmd.add_argument_group("file output options")
            grp = agrp.add_mutually_exclusive_group()
            grp.add_argument("--compress", dest="compression", action="store_true",
                help="compress new archivals before dumping them to disk; default",
            )
            grp.add_argument("--no-compress", "--uncompressed", dest="compression", action="store_false",
                help="dump new archivals to disk without compression",
            )
            cmd.set_defaults(compression=True)

        agrp = cmd.add_argument_group("file outputs")

        if kind == "organize":
            grp = agrp.add_mutually_exclusive_group()
            grp.add_argument("-t", "--to", f"--{kind}-to", dest="destination", metavar="OUTPUT_DESTINATION", type=str,
                help=_("destination directory; when unset, each source `PATH` must be a directory which will be treated as its own `OUTPUT_DESTINATION`"),
            )
            grp.add_argument("--to-one-of", f"--{kind}-to-one-of", dest="possible_destinations", nargs="+", metavar="PATH", type=str,
                help=_(f"""for each given `PATH` derive its corresponding `--to` automatically by selecting its closest ancestor from one of the give values (if this is a last option before the `PATH`s, you'll have to add an `--` after it for this to work);
thus, e.g., `{__prog__} organize --to-one-of ~/hoardy-web/raw/* -- ~/hoardy-web/raw/*/2024/01` would be equivalent to `for a in default background extension etc; do {__prog__} organize --to ~/hoardy-web/raw/$a -- ~/hoardy-web/raw/$a/2024/01; done`, except `--to-one-of` it would also work with `--stdin0` and such"""),
            )
            agrp.add_argument("-o", "--output", metavar="OUTPUT_FORMAT", default="default", type=str,
                help=_("""format describing generated output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string:""")
                + "\n- "
                + _("available aliases and corresponding %%-substitutions:")
                + "\n"
                + "".join(
                    [
                        f"  - `{name}`{' ' * (12 - len(name))}: `{value.replace('%', '%%')}`"
                        + ("; the default" if name == "default" else "")
                        + "\n"
                        + output_example(name, 8)
                        + "\n"
                        for name, value in output_alias.items()
                    ]
                )
                + "- "
                + _("available substitutions:")
                + "\n  - "
                + _(f"all expressions of `{__prog__} get --expr` (which see)")
                + ";\n  - `num`: "
                + _("number of times the resulting output path was encountered before; adding this parameter to your `--output` format will ensure all generated file names will be unique"),
            )
        elif kind in ("import", "mirror", "serve"):
            if kind != "serve":
                agrp.add_argument("-t", "--to", f"--{kind}-to", dest="destination", metavar="OUTPUT_DESTINATION", type=str, required=True,
                    help=_("destination directory; required"),
                )
            else:
                agrp.add_argument("-t", "--to", "--archive-to", dest="destination", metavar="ARCHIVE_DESTINATION", type=str,
                    help=_("archiving destination directory; if left unset, which is the default, then archiving server support will be disabled"),
                )
                agrp.add_argument("-i", "--implicit", action="store_true",
                    help=_("prepend `ARCHIVE_DESTINATION` to the list of input `PATH`s"),
                )

            def_def = "hupq_n" if kind == "mirror" else "default"
            agrp.add_argument("-o", "--output", metavar="OUTPUT_FORMAT", default=def_def, type=str,
                help=_(f"""format describing generated output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string; same expression format as `{__prog__} organize --output` (which see); default: `%(default)s`"""),
            )
        else:
            assert False

        if kind in ("organize", "mirror"):
            agrp = cmd.add_argument_group("updates to `--output`s")
            grp = agrp.add_mutually_exclusive_group()

            def_skip = _("skip overwrites of existing files under `OUTPUT_DESTINATION` while skipping duplicated inputs/outputs")

            if kind == "organize":
                grp.add_argument("--keep-duplicates", dest="allow_updates", action="store_const", const=None,
                    help= _("""map each input reqres to its own `--output` path under `OUTPUT_DESTINATION`, thus keeping all duplicated reqres as-is;
the `--o    utput` format must include the `num` substitution for this to work"""),
                )
                grp.add_argument("--skip-existing", "--no-overwrite", dest="allow_updates", action="store_false",
                    help=(
                        def_skip
                        + _("; default unless `--overwrite` is")
                        + ";\n"
                        + _("""when running with `--symlink`, `--output` destinations that are broken symlinks will be considered to be non-existent and will processed as if `--overwrite` was set for those destination paths;
when an     `--output` destination file already contains a given source reqres, the resulting action will processed as if `--overwrite` was set for that destination path but the actual action itself will be elided into a noop, i.e., the results will be deduplicated;
in all o    ther cases, existing destination files will be skipped, the `num` substitution value will be incremented, a new `--output` file path will be generated, and the operation will be retried with that new path;
source a    nd destination file directories can be the same (set so explicitly or via unset `--to`), in which case each source file will simply be renamed to use its new `--output` name, though renames that attempt to swap files will fail""")
                    ),
                )
                grp.add_argument("--overwrite", dest="allow_updates", action="store_true",
                    help=_("overwrite old files under `OUTPUT_DESTINATION`; default when running with `--symlink` combined with anything other than `--all`"),
                )
                cmd.set_defaults(allow_updates=MISSING)
            else:
                grp.add_argument("--skip-existing", "--no-overwrite", dest="allow_updates", action="store_false",
                    help=(
                        def_skip
                        + _("; default")
                        + ";\n"
                        + _("""repeated `mirror`s of the same targets with the same parameters (which, therefore, will produce the same `--output` data) will still be allowed and elided into noops but trying to overwrite existing files under `OUTPUT_DESTINATION` with new data will produce errors;
this beh    aviour allows the same `OUTPUT_DESTINATION` to be reused between unrelated `mirror`s and between `mirror`s that produce the same data on disk in their common parts;
however,     note that such reuse combined with `--depth` is likely to produce partially broken results, since skipped rendering of a document will also skip rendering of it references""")
                    ),
                )
                grp.add_argument("--overwrite", dest="allow_updates", action="store_true",
                    help=_("overwrite old files under `OUTPUT_DESTINATION`"),
                )
                cmd.set_defaults(allow_updates=False)

            agrp.add_argument("--please-destroy-my-data", dest="force", action="store_true",
                help=_("permit `--overwrite` usage even when it can loose your data; **DANGEROUS!**"),
            )

        agrp = cmd.add_argument_group("to stdout, print paths of")
        grp = agrp.add_mutually_exclusive_group()

        if kind == "organize":
            grp.add_argument("--print-updated-outputs", dest="print", action="store_const", const="outputs",
                help=_("... newly generated/updated `--output` files"),
            )
            grp.add_argument("--print-updated-inputs", dest="print", action="store_const", const="inputs",
                help=_("... updated/removed `INPUT` files; will only produce an effect when running with `--move`"),
            )
            grp.add_argument("--print-updated", dest="print", action="store_true",
                help=_("... both of the above"),
            )
            grp.add_argument("--print-remap", dest="print", action="store_const", const="remap",
                help=_("... each resulting `--output` file; this option is named this way because in combination with `--stdin0`, effectively, it remaps each given input path to its corresponding output path, which is most useful in combination with `--move` and/or `--dry-run`"),
            )
        else:
            grp.add_argument("--print-updated", "--print-updated-outputs", dest="print", action="store_true",
                help=_("... newly generated/updated `--output` files"),
            )
        grp.add_argument("--no-print", dest="print", action="store_false",
            help=_("... nothing at all") + "; " + _("default"),
        )
        cmd.set_defaults(print=False)

        add_terminator(cmd, "print those paths")

    class EmitNear(argparse.Action):
        def __call__(
            self,
            parser: _t.Any,
            cfg: argparse.Namespace,
            value: _t.Any,
            option_string: str | None = None,
        ) -> None:
            setattr(cfg, self.dest, self.const(timerange(value).middle))

    near = _("... a reqres that is closest to the given `DATETIME` value")
    oldest = _("... its oldest available reqres")
    latest = _("... its latest available reqres")
    hybrid = _(", except, for each URL that is a requisite resource, mirror a reqres that is time-closest to the referencing document")
    hybrid_ie = _("; i.e., this will make each mirrored page refer to requisites (images, media, `CSS`, fonts, etc) that were archived around the time the page itself was archived, even if those requisite resources changed in time; this produces results that are as close to the original web page as possible at the cost of much more memory to `mirror`")
    ram_hungry = ";\n" + _("this is likely to take a lot of time and eat a lot of RAM!")

    def alias_for(s: str) -> str:
        return _("; an alias for `%s` (which see)") % (s,)

    def add_mode(cmd: _t.Any, kind: str, description: str, default: tuple[bool, TimeStamp | None]) -> None:
        agrp = cmd.add_argument_group(description)
        grp = agrp.add_mutually_exclusive_group()
        is_mirror = kind == "mirror"
        is_serve = kind == "serve"
        warnings = ram_hungry if is_mirror or is_serve else ""

        grp.add_argument("--all", dest="mode", action="store_const", const=(False, None),
            help=(
                _("... all available reqres")
                + (_("; default") if is_serve else "")
                + warnings
            ),
        )
        grp.add_argument("--nearest", dest="mode", metavar="DATETIME", action=EmitNear, const=lambda x: (True, x),
            help=(
                near
                + datetime_spec_middle
                + (
                    "\n"
                    + _("if `--to` is set, each new archival will also update the index, replacing old reqres with new reqres if their `stime` is closer to `DATETIME`;")
                    if is_serve
                    else ""
                )
            ),
        )
        if is_mirror:
            grp.add_argument("--nearest-hybrid", dest="mode", metavar="DATETIME", action=EmitNear, const=lambda x: (False, x),
                help=near + hybrid + hybrid_ie + datetime_spec_id + warnings,
            )
        grp.add_argument("--oldest", dest="mode", action="store_const", const=(True, anytime.start),
            help=oldest + alias_for("--nearest @-inf"),
        )
        if is_mirror:
            grp.add_argument("--oldest-hybrid", dest="mode", action="store_const", const=(False, anytime.start),
                help=oldest + hybrid + alias_for("--nearest-hybrid @-inf") + warnings,
            )
        grp.add_argument("--latest", dest="mode", action="store_const", const=(True, anytime.end),
            help=latest + alias_for("--nearest @+inf") + (_("; default") if is_mirror else ""),
        )
        if is_mirror:
            grp.add_argument("--latest-hybrid", dest="mode", action="store_const", const=(False, anytime.end),
                help=latest + hybrid + alias_for("--nearest-hybrid @+inf") + warnings,
            )
        if is_serve:
            grp.add_argument("--no-replay", dest="mode", action="store_const", const=None,
                help=_("disable replay functionality completely, making this instance into an archive-only server, like `hoardy-web-sas` is"),
            )

        cmd.set_defaults(mode=default)

    # organize
    cmd = subparsers.add_parser("organize",
        help=_("programmatically copy/rename/move/hardlink/symlink given input files based on their metadata and/or contents"),
        description=_(f"""Programmatically copy/rename/move/hardlink/symlink given input files based on their metadata and/or contents.

Algorithm:

- For each input `PATH`:
  - load one or more reqres from it;
  - for each reqres:
    - if it does not satisfy given filters, skip it;
    - compute a new destination path under `--to OUTPUT_DESTINATION` for this reqres (using its metadata and specified `--output OUTPUT_FORMAT` format);
    - if the new destination path already contains this reqres, skip this reqres (thus, deduplicating the results);
    - try to move/copy/hardlink/symlink that source file/reqres to that new path;
    - if the previous step succeeded, continue to the next reqres;
    - otherwise, increment the `num` substitution, compute new destination path, and try again.

The end.

Operations that could lead to accidental data loss are not permitted.
E.g., the default `{__prog__} organize --move` will not overwrite any files, which is why the default `--output` format contains the `num` substitution.
"""),
    )
    add_organize(cmd, "organize")
    add_impure(cmd)
    add_common(cmd, "organize", "organize reqres when")

    follow_all = ";\n" + _("all symlinks will be followed")

    agrp = cmd.add_argument_group("action")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--move", dest="action", action="store_const", const="move",
        help=(
            _("move source files to their new paths under `OUTPUT_DESTINATION`; default")
            + ";\n"
            + _("""symlinks to directories among and inside the given `INPUT`s won't be followed;
source files that are themselves symlinks will generate errors""")
        ),
    )
    grp.add_argument("--copy", dest="action", action="store_const", const="copy",
        help=_("copy source files to paths under `OUTPUT_DESTINATION`") + follow_all,
    )
    grp.add_argument("--hardlink", dest="action", action="store_const", const="hardlink",
        help=_("create hardlinks from source files to paths under `OUTPUT_DESTINATION`") + follow_all,
    )
    grp.add_argument("--symlink", dest="action", action="store_const", const="symlink",
        help=_("create symlinks from source files to paths under `OUTPUT_DESTINATION`") + follow_all,
    )
    cmd.set_defaults(action="move")

    add_fileout(cmd, "organize")

    # `--all` is the default
    add_mode(cmd, "organize", "into each `--output` path, write", (False, None))

    cmd.set_defaults(func=cmd_organize)

    # import
    cmd = subparsers.add_parser("import",
        help=_("convert other `HTTP` archive formats into `WRR`"),
        description=_(f"""Parse each `INPUT` `PATH` into (a sequence of) reqres, convert them to `WRR`-dumps, and place them into separate `*.wrr` files under `OUTPUT_DESTINATION`, with paths derived from their reqres metadata.

Internally, this in a slightly optimized alias for `{__prog__} organize --copy --cache 32 --batch 1024 --no-defer` (which see)."""),
    )

    add_organize(cmd, "import", 32, 1024)
    add_impure(cmd)
    add_common(cmd, "import", "import reqres when")
    add_fileout(cmd, "import")

    cmd.set_defaults(func=cmd_import)

    def add_index_memory(cmd: _t.Any) -> None:
        agrp = cmd.add_argument_group("caching")
        agrp.add_argument("--memory", "--max-memory", metavar="INT", type=int, default=1024,
            help=_("""the caches, all taken together, must not take more than this much memory in MiB; default: `%(default)s`;
making this larger improves performance;
the actual maximum whole-program memory consumption is `O(<size of the largest reqres> + <numer of indexed files> + <sum of lengths of all their --output paths> + <--max-memory>)`"""),
        )

    indexing_algorithm = """- for each input `PATH`:
  - load one or more reqres from it;
  - for each reqres:
    - if it does not satisfy given filters, skip it;
    - index it for future use;
    - if running with `--latest` or similar, elide no longer relevant old inputs from the index;"""

    # mirror
    cmd = subparsers.add_parser("mirror",
        help=_("convert given inputs into a local offline static website mirror stored in interlinked files, a-la `wget -mpk`"),
        description=_(f"""Generate a local offline static website mirror from given intuts, producing results similar to those of `wget -mpk`.

Algorithm:

{indexing_algorithm}
    - if there are no root filters set or if it satisfies given root filters, queue its URL for mirroring;
- then, mirror each queued URL, that is, for each URL in the queue:
  - load all indexed reqres;
  - for each reqres:
    - evaluate all `EXPR` expressions on that reqres (which, by default, takes its response body and rewrites all links to point to locally mirrored files);
    - if the document being mirrored has resource requisites, mirror them recursively,
    - if the document being mirrored references other documents and the current recursion depth is smaller than `DEPTH`, queue those documents for mirroring too,
    - write the result of evaluating `EXPR`s into a separate file under `--to OUTPUT_DESTINATION` with its path derived from reqres' metadata and specified `--output OUTPUT_FORMAT` format.

The end.

Essentially, this subcommand is a combination of `{__prog__} organize --copy` followed by in-place `{__prog__} get` which has the advanced URL remapping capabilities of `(*|/|&)(jumps|actions|reqs)` options available in its `scrub` function.
"""),
    )
    add_index_memory(cmd)
    add_impure(cmd)
    add_common(cmd, "mirror", "consider reqres for mirroring when")
    add_expr(cmd, "mirror")

    # `--latest` is the default
    add_mode(cmd, "mirror", "for each URL, mirror", (True, anytime.end))

    add_fileout(cmd, "mirror")

    agrp = cmd.add_argument_group("content-addressed file output mode")

    agrp.add_argument("--copy", dest="content_action", action="store_const", const="copy",
        help=_("do not use content-addressed outputs, simply write rendered output data to files under `OUTPUT_DESTINATION`"),
    )
    agrp.add_argument("--hardlink", dest="content_action", action="store_const", const="hardlink",
        help=_("write rendered output data to files under `CONTENT_DESTINATION`, then hardlink them to paths under `OUTPUT_DESTINATION`; default"),
    )
    agrp.add_argument("--symlink", dest="content_action", action="store_const", const="symlink",
        help=_("write rendered output data to files under `CONTENT_DESTINATION`, then symlink them to paths under `OUTPUT_DESTINATION`"),
    )
    cmd.set_defaults(content_action="hardlink")

    agrp = cmd.add_argument_group("content-addressed file output settings")

    agrp.add_argument("--content-to", dest="content_destination", metavar="CONTENT_DESTINATION", type=str,
        help=_("content-addressed destination directory; if not specified, reuses `OUTPUT_DESTINATION`"),
    )
    agrp.add_argument("--content-output", metavar="CONTENT_FORMAT", default="default", type=str,
        help=_("""format describing generated content-addressed output paths, an alias name or "format:" followed by a custom pythonic %%-substitution string:""")
        + "\n- "
        + _("available aliases and corresponding %%-substitutions:")
        + "\n"
        + "".join(
            [
                f"  - `{name}`{' ' * (12 - len(name))}: `{value.replace('%', '%%')}`"
                + ("; the default" if name == "default" else "")
                + "\n"
                for name, value in content_output_alias.items()
            ]
        )
        + "- "
        + _("available substitutions:")
        + "\n  - "
        + _(f"all expressions of `{__prog__} get --expr` (which see)")
        + ";\n  - `content`: "
        + _("rendered content")
        + "\n  - `content_sha256`: "
        + _("alias for `content|sha256`"),
    )

    add_filters(cmd, "take reqres as a root when", True)

    agrp = cmd.add_argument_group("recursion depth")
    agrp.add_argument("-d", "--depth", metavar="DEPTH", type=int, default=0,
        help=_('maximum recursion depth level; the default is `0`, which means "`--root-*` documents and their requisite resources only"; setting this to `1` will also mirror one level of documents referenced via jump and action links, if those are being remapped to local files with `--remap-*`; higher values will mean even more recursion'),
    )

    cmd.set_defaults(func=cmd_mirror)

    # serve
    cmd = subparsers.add_parser("serve",
        help=_("run an archiving server and/or serve given input files for replay over HTTP"),
        description=_("""Run an archiving server and/or serve given input files for replay over HTTP.

Algorithm:

{indexing_algorithm}
- start listening on given host and port for:
  - replay requests on `GET /web/<selector>/<url>`;
- for each replay request:
  - if `selector` ends with `*`:
    - interpret `selector` as a time interval;
    - interpret `url` as glob pattern;
    - show a page with all indexed visits to URLs matching the pattern in the interval;
  - otherwise:
    - if `url` has indexed visits, respond with data most closely matching the given `selector`;
    - otherwise:
      - if `url` contains `*`, interpret it as a glob pattern;
      - otherwise, generate a glob pattern by chopping away less important parts of the current `url`;
      - show a `Not Found` page with a list of similar URLs and visits matching the pattern.

The end.
"""),
    )
    cmd.add_argument("-q", "--quiet", action="store_true",
        help=_("don't don't print end-of-filtering warnings, don't print optional informational messages, and don't log HTTP requests to stderr"),
    )
    add_index_memory(cmd)
    add_common(cmd, "serve", "make reqres available when")

    agrp = cmd.add_argument_group("`HTTP` server options")
    agrp.add_argument("--host", type=str, default="127.0.0.1",
        help=_("listen on what host/IP; default: `%(default)s`"),
    )
    agrp.add_argument("--port", type=int, default=3210,
        help=_("listen on what port; default: `%(default)s`"),
    )
    agrp.add_argument("--debug-bottle", action="store_true",
        help=_("run with `bottle`'s debugging enabled"),
    )

    add_expr(cmd, "serve")

    agrp = cmd.add_argument_group("buckets")
    agrp.add_argument("--default-bucket", "--default-profile", metavar="STR", default="default", type=str,
        help=_("a bucket name to use when an `HTTP`-submission does not specify any; default: `%(default)s`"),
    )
    agrp.add_argument("--ignore-buckets", "--ignore-profiles", action="store_true",
        help=_("ignore bucket names specified by `HTTP`-submissions and use the value of `--default-bucket` instead"),
    )
    agrp.add_argument("--bucket-prefix", metavar="STR", default="", type=str,
        help=_("when writing files to disk, prepend the following prefix to all bucket values, including the `--default-bucket` one; default: `%(default)s`"),
    )

    add_fileout(cmd, "serve")

    agrp = cmd.add_argument_group("when `--to` is set but parsing of an `HTTP`-submitted `WRR`-dump fails")
    agrp.add_argument("--fallback", dest="fallback", action="store_true",
        help=_("... write the dump into a separate file with the name derived using `--fallback-*` options below, skip adding it to replay index, and report success to the submitter, similarly to how `hoardy-web-sas` does it") + _("; default"),
    )
    agrp.add_argument("--no-fallback", dest="fallback", action="store_false",
        help=_(f"... don't write anything to disk, don't touch the index, return an `HTTP` error to the submitter; enabling this will prevent `HTTP` clients from submitting garbage to this archiving server instance, but it will also make it impossible to archive perfectly correct `WRR`-dumps in situations when `cbor2` library or `WRR` parsing code of `{__prog__}` itself fail to parse them properly (which does happen, rarely)"),
    )
    cmd.set_defaults(fallback=True)  # --fallback

    agrp = cmd.add_argument_group("when `--fallback` is in effect")
    agrp.add_argument("--fallback-output", metavar="OUTPUT_FORMAT", default="fallback", type=str,
        help=_("""... use this value as an `--output` format (which see) instead;
since this value will be evaluated with without an associated reqres, the following rules apply:
- all time-related substitutions (`qtime`, `stime`, `ftime`, `qyear`, `syear`, `fyear`, etc) will be set using current date and time,
- the `num` substitution will work as normal,
- all other substitutions will be filled with placeholders;
thus, when setting this option to a custom value, you should probably only use the first two;"""),
    )
    agrp.add_argument("--fallback-bucket-prefix", metavar="STR", default="fallback-", type=str,
        help=_("... prepend the following prefix to the submitted bucket value; default: `%(default)s`"),
    )

    # `--all` is the default
    add_mode(cmd, "serve", "for each URL, index and replay", (False, None))

    agrp = cmd.add_argument_group("replay how")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--web", dest="web_replay", action="store_true",
        help=_("replay `HTTP` responses as close as possible to their original captures; default"),
    )
    grp.add_argument("--mirror", dest="web_replay", action="store_false",
        help=_(f"replay `HTTP` responses like `{__prog__} mirror` does; setting this option will disable replay of all `HTTP` headers except for `Location` and enable `inline_headers` option in `scrub` calls used in default `EXPR`s, similar to `{__prog__} mirror`; i.e., enabling this option will, essentially, turn this subcommand into an on-demand `{__prog__} mirror` which you can query with `curl` or some such"),
    )
    cmd.set_defaults(web_replay=True)

    agrp = cmd.add_argument_group("while generating `/find/` page results, if neither of `/find/...,re/` or `/find/...,glob/` options are set but the requested URL can't be found in the index")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--implicit-similar", dest="implicit_similar", action="store_true",
        help=_("""... try searching for URLs similar to the requested one and include those results in the output too, as if `/find/...,similar/` option was set;
if your index contains a lot of distinct URLs, this will slow down generation of `/find/` pages quite a bit, which includes generation of empty "Not Found" pages, which can be quite annoying;
it could also make some of your generated `/find/` pages include spurious results;
on the other hand, this option can be awfully convenient when you regularly re-visit websites that add garbage query parameters to their URLs and you would rather make your `/find/` requests always ignore those automatically"""),
    )
    grp.add_argument("--implicit-similar-if-star", dest="implicit_similar", action="store_false",
        help=_('... try searching for similar URLs and include those results in the output only if the requested URL contains the "*" symbol; default'),
    )
    grp.add_argument("--no-implicit-similar", dest="implicit_similar", action="store_const", const=None,
        help=_("... don't do anything special"),
    )
    cmd.set_defaults(implicit_similar=False)  # --implicit-similar-if-star

    cmd.set_defaults(func=cmd_serve)
    # fmt: on

    return parser


def main() -> None:
    setup_result = setup_kisstdlib(__prog__, do_setup_delay_signals=False)
    setup_delay_signals(["SIGTERM", "SIGINT", "SIGBREAK", "SIGUSR1"])
    run_kisstdlib_main(
        setup_result,
        argparse.make_argparser_and_run,
        make_argparser,
        lambda cargs: cargs.func(cargs),
    )


if __name__ == "__main__":
    main()
