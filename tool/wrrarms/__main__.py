# Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
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
#
# This file is a part of pwebarc project.

import logging as _logging
import os as _os
import stat as _stat
import subprocess as _subprocess
import sys as _sys
import tempfile as _tempfile
import traceback as _traceback
import typing as _t

from gettext import gettext as _, ngettext

from kisstdlib import argparse
from kisstdlib.exceptions import *
from kisstdlib.io import *
from kisstdlib.logging import *

from .wrr import *
from .output import *

def is_filtered_out(rrexpr : ReqresExpr, cargs : _t.Any) -> bool:
    def eval_it(expr : str) -> bool:
        ev = rrexpr.eval(expr)
        if not isinstance(ev, bool):
            raise CatastrophicFailure("expression `%s` does not evaluate to `bool`, got `%s` instead", expr, repr(ev))
        return ev

    if len(cargs.anys) > 0:
        res = False
    else:
        res = True

    for expr in cargs.anys:
        res = res or eval_it(expr)

    for expr in cargs.alls:
        res = res and eval_it(expr)

    return not res

def cmd_pprint(cargs : _t.Any) -> None:
    def emit(reqres : Reqres, abs_path : str, rel_path : str) -> None:
        rrexpr = ReqresExpr(reqres, abs_path)
        if is_filtered_out(rrexpr, cargs): return

        wrr_pprint(stdout, reqres, abs_path, cargs.abridged)
        stdout.flush()

    for _ in wrr_map_paths(emit, cargs.paths, cargs.errors):
        pass

def load_wrr(path : str) -> ReqresExpr:
    abs_path = _os.path.abspath(_os.path.expanduser(path))
    reqres = wrr_loadf(abs_path)
    return ReqresExpr(reqres, abs_path)

def get_bytes(expr : str, rrexpr : ReqresExpr) -> bytes:
    value = rrexpr.eval(expr)

    if value is None or isinstance(value, (bool, int, float)):
        value = str(value)
    elif isinstance(value, EpochMsec):
        value = str(int(value))

    if isinstance(value, str):
        return value.encode(_sys.getdefaultencoding())
    elif isinstance(value, bytes):
        return value
    else:
        raise Failure("don't know how to print an expression of type `%s`", type(value).__name__)

def cmd_get(cargs : _t.Any) -> None:
    if len(cargs.exprs) == 0:
        cargs.exprs = ["response.body|es"]

    rrexpr = load_wrr(cargs.path)
    for expr in cargs.exprs:
        data = get_bytes(expr, rrexpr)
        stdout.write_bytes(data)
        stdout.write_bytes(cargs.terminator)

def cmd_run(cargs : _t.Any) -> None:
    if cargs.num_args < 1:
        raise Failure("must have at least one PATH")
    elif cargs.num_args - 1 > len(cargs.args):
        raise Failure("not enough arguments to satisfy `--num-args`")

    # move (num_args - 1) arguments from args to paths
    ntail = len(cargs.args) + 1 - cargs.num_args
    args = cargs.args[:ntail]
    paths = cargs.args[ntail:] + cargs.paths

    tmp_paths = []
    try:
        for path in paths:
            rrexpr = load_wrr(path)

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

def slurp_stdin0(cargs : _t.Any) -> None:
    if not cargs.stdin0: return
    paths = stdin.read_all_bytes().split(b"\0")
    last = paths.pop()
    if last != b"":
        raise Failure("`--stdin0` input format error")
    cargs.paths += paths

def cmd_find(cargs : _t.Any) -> None:
    slurp_stdin0(cargs)

    def emit(reqres : Reqres, abs_path : str, rel_path : str) -> None:
        rrexpr = ReqresExpr(reqres, abs_path)
        if is_filtered_out(rrexpr, cargs): return
        stdout.write_bytes(_os.fsencode(abs_path) + cargs.terminator)
        stdout.flush()

    for _ in wrr_map_paths(emit, cargs.paths, cargs.errors):
        pass

output_aliases = {
    "default":  "%(syear)d/%(smonth)02d/%(sday)02d/%(shour)02d%(sminute)02d%(ssecond)02d%(stime_msq)03d_%(qtime_ms)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s_%(hostname)s.%(num)d.wrr",
    "short": "%(syear)d/%(smonth)02d/%(sday)02d/%(stime_ms)d_%(qtime_ms)s.%(num)d.wrr",

    "surl":       "%(scheme)s/%(netloc)s/%(path)s%(oqm)s%(query)s",
    "url":                   "%(netloc)s/%(path)s%(oqm)s%(query)s",
    "surl_msn":   "%(scheme)s/%(netloc)s/%(path)s%(oqm)s%(query)s_%(method)s_%(status)s.%(num)d.wrr",
    "url_msn":               "%(netloc)s/%(path)s%(oqm)s%(query)s_%(method)s_%(status)s.%(num)d.wrr",

    "shpq":       "%(scheme)s/%(hostname)s/%(ipath|abbrev 120)s%(oqm)s%(query|abbrev 120)s.wrr",
    "hpq":                   "%(hostname)s/%(ipath|abbrev 120)s%(oqm)s%(query|abbrev 120)s.wrr",
    "shpq_msn":   "%(scheme)s/%(hostname)s/%(ipath|abbrev 120)s%(oqm)s%(query|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",
    "hpq_msn":               "%(hostname)s/%(ipath|abbrev 120)s%(oqm)s%(query|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",

    "shupq":      "%(scheme)s/%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 120)s.wrr",
    "hupq":                  "%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 120)s.wrr",
    "shupq_msn":  "%(scheme)s/%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",
    "hupq_msn":              "%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",

    "srhupq":     "%(scheme)s/%(rhostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s.wrr",
    "rhupq":                 "%(rhostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s.wrr",
    "srhupq_msn": "%(scheme)s/%(rhostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",
    "rhupq_msn":             "%(rhostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr",

    "shupnq":     "%(scheme)s/%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(nquery|unquote_plus|abbrev 120)s.wrr",
    "hupnq":                 "%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(nquery|unquote_plus|abbrev 120)s.wrr",
    "shupnq_msn": "%(scheme)s/%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(nquery|unquote_plus|abbrev 120)s_%(method)s_%(status)s.%(num)d.wrr",
    "hupnq_msn":             "%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(nquery|unquote_plus|abbrev 120)s_%(method)s_%(status)s.%(num)d.wrr",

    "flat":                  "%(hostname)s/%(ipath|unquote|replace / __|abbrev 120)s%(oqm)s%(nquery|unquote_plus|replace / __|abbrev 100)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s.wrr",
}

not_allowed = _("; this is not allowed to prevent accidental data loss")
variance_help = _("; your `--output` format fails to provide enough variance (did your forget to place a `%%(num)d` substitution in there?)") + not_allowed

def make_organize(cargs : _t.Any, destination : str) -> tuple[_t.Callable[[Reqres, str, str], None],
                                                              _t.Callable[[], None]]:
    destination = _os.path.expanduser(destination)

    action_func : _t.Any
    if cargs.action == "rename":
        action_desc = "renaming"
        action_func = _os.rename
    elif cargs.action == "hardlink":
        action_desc = "hardlinking"
        action_func = _os.link
    elif cargs.action == "symlink":
        action_desc = "symlinking"
        action_func = _os.symlink
    elif cargs.action == "symlink-update":
        action_desc = "updating symlink"
        action_func = _os.symlink
    else:
        assert False

    if cargs.dry_run:
        action_desc = _("dry-run: (not)") + " " + action_desc

    seen_count_state : dict[str, int] = {}
    def seen_count(value : str) -> int:
        try:
            count = seen_count_state[value]
        except KeyError:
            seen_count_state[value] = 0
            return 0
        else:
            count += 1
            seen_count_state[value] = count
            return count

    file_mtimes_ms : dict[str, int] = {}
    intent_log : dict[str, tuple[int, bool, str]] = {}
    def perform_updates() -> None:
        for abs_out_path in list(intent_log.keys()):
            _, need_to_unlink, abs_path = intent_log.pop(abs_out_path)

            if need_to_unlink:
                _os.unlink(abs_out_path)
            else:
                dirname = _os.path.dirname(abs_out_path)
                _os.makedirs(dirname, exist_ok = True)
            action_func(abs_path, abs_out_path)

            if cargs.terminator is not None:
                stdout.write_bytes(_os.fsencode(abs_out_path) + cargs.terminator)
                stdout.flush()

    def emit(reqres : Reqres, abs_path : str, rel_path : str) -> None:
        rrexpr = ReqresExpr(reqres, abs_path)
        if is_filtered_out(rrexpr, cargs): return

        rrexpr.items["num"] = 0
        ogprefix = _os.path.join(destination, cargs.output % rrexpr)
        prev_rel_out_path = None
        need_to_unlink = False
        while True:
            rrexpr.items["num"] = seen_count(ogprefix)
            rel_out_path = _os.path.join(destination, cargs.output % rrexpr)
            abs_out_path = _os.path.abspath(rel_out_path)
            if abs_path == abs_out_path:
                # trying to rename, hardlink, or symlink to itself
                return

            if abs_out_path in intent_log:
                # we have this path waiting in intent_log
                prev_modified_ms, prev_need_to_unlink, prev_abs_path = intent_log[abs_out_path]
                if cargs.action != "symlink-update":
                    if _os.path.samefile(abs_path, prev_abs_path):
                        # batched source and this are the same file
                        return
                    raise Failure(_(f"trying to {cargs.action} `%s` to `%s` which is already batched to be taken from `%s`") +
                                  variance_help, rel_path, rel_out_path, prev_abs_path)

                if prev_modified_ms >= rrexpr.stime_ms:
                    # batched source in newer
                    return

                need_to_unlink = prev_need_to_unlink
                break

            try:
                out_stat = _os.lstat(abs_out_path)
            except FileNotFoundError:
                break

            if _stat.S_ISLNK(out_stat.st_mode):
                # check that symlink target exists
                try:
                    out_stat_target = _os.stat(abs_out_path)
                except FileNotFoundError:
                    need_to_unlink = True
                    break

            if _os.path.samefile(abs_path, abs_out_path):
                # target already points to source
                return

            if cargs.action == "symlink-update":
                if not _stat.S_ISLNK(out_stat.st_mode):
                    raise Failure(_(f"trying to {cargs.action} `%s` to `%s` which already exists and is not a symlink") +
                                  not_allowed, rel_path, rel_out_path)

                # cache stime_ms for performance
                try:
                    file_modified_ms = file_mtimes_ms[abs_out_path]
                except KeyError:
                    file_modified_ms = ReqresExpr(wrr_loadf(abs_out_path), abs_out_path).stime_ms
                    file_mtimes_ms[abs_out_path] = file_modified_ms

                if file_modified_ms >= rrexpr.stime_ms:
                    # target in newer
                    return

                need_to_unlink = True
                break

            if prev_rel_out_path == rel_out_path:
                raise Failure(_(f"trying to {cargs.action} `%s` to `%s` which already exists and is not the same file") +
                              variance_help, rel_path, rel_out_path)
            prev_rel_out_path = rel_out_path
            continue

        if not cargs.quiet:
            stderr.write_str_ln(f"{action_desc}: {rel_path} -> {rel_out_path}")
            stderr.flush()

        if cargs.dry_run:
            return

        intent_log[abs_out_path] = (rrexpr.stime_ms, need_to_unlink, abs_path)
        if not cargs.lazy and len(intent_log) >= cargs.batch:
            perform_updates()

    return emit, perform_updates

def cmd_organize(cargs : _t.Any) -> None:
    if cargs.output in output_aliases:
        cargs.output = output_aliases[cargs.output]

    if cargs.destination is not None:
        # destination is set explicitly
        slurp_stdin0(cargs)

        emit, finish = make_organize(cargs, cargs.destination)
        for _ in wrr_map_paths(emit, cargs.paths, cargs.errors, follow_symlinks=False):
            pass
        finish()
    else:
        # each path is its own destination
        if cargs.stdin0:
            raise Failure("`--stdin0` but no `--to` is specified")

        for path in cargs.paths:
            try:
                fstat = _os.stat(_os.path.expanduser(path))
            except FileNotFoundError:
                raise Failure("%s does not exist", path)
            else:
                if cargs.destination is None and not _stat.S_ISDIR(fstat.st_mode):
                    raise Failure("%s is not a directory but no `--to` is specified", path)

        for path in cargs.paths:
            emit, finish = make_organize(cargs, path)
            for _ in wrr_map_paths(emit, [path], cargs.errors, follow_symlinks=False):
                pass
            finish()

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
    stream = get_StreamEncoder(cargs)

    def emit(reqres : Reqres, abs_path : str, rel_path : str) -> None:
        rrexpr = ReqresExpr(reqres, abs_path)
        if is_filtered_out(rrexpr, cargs): return

        values : list[_t.Any] = []
        for expr in cargs.exprs:
            values.append(rrexpr.eval(expr))
        stream.emit(abs_path, cargs.exprs, values)

    stream.start()
    for _ in wrr_map_paths(emit, cargs.paths, cargs.errors):
        pass
    stream.finish()

def add_doc(fmt : argparse.BetterHelpFormatter) -> None:
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
    fmt.add_code(f"""wrrarms organize --stdin0 --action symlink --to ~/pwebarc/all --output hupq_msn < changes""")
    fmt.add_text(_("and then, we can reuse `changes` again and use them to update `~/pwebarc/latest`, filling it with symlinks pointing to the latest `200 OK` complete reqres from `~/pwebarc/raw`, similar to what `wget -r` would produce (except `wget` would do network requests and produce responce bodies, while this will build a file system tree of symlinks to WRR files in `/pwebarc/raw`):"))
    fmt.add_code(f"""wrrarms organize --stdin0 --action symlink-update --to ~/pwebarc/latest --output hupq --and "status|== 200C" < changes""")
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

    fmt.add_text(_("# Handling binary data"))

    fmt.add_text(_(f"Trying to use response bodies produced by `{__package__} stream --format=json` is likely to result garbled data as JSON can't represent raw sequences of bytes, thus binary data will have to be encoded into UNICODE using replacement characters:"))
    fmt.add_code(f"{__package__} stream --format=json -ue . ../dumb_server/pwebarc-dump/path/to/file.wrr | jq .")
    fmt.add_text(_("The most generic solution to this is to use `--format=cbor` instead, which would produce a verbose CBOR representation equivalent to the one used by `--format=json` but with binary data preserved as-is:"))
    fmt.add_code(f"{__package__} stream --format=cbor -ue . ../dumb_server/pwebarc-dump/path/to/file.wrr | less")
    fmt.add_text(_("Or you could just dump raw response bodies separately:"))
    fmt.add_code(f"{__package__} stream --format=raw -ue response.body ../dumb_server/pwebarc-dump/path/to/file.wrr | less")
    fmt.add_code(f"{__package__} get ../dumb_server/pwebarc-dump/path/to/file.wrr | less")

def main() -> None:
    parser = argparse.BetterArgumentParser(
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

    def add_filters(cmd : _t.Any) -> None:
        grp = cmd.add_argument_group("filters")
        grp.add_argument("--or", dest="anys", metavar="EXPR", action="append", type=str, default = [],
                         help=_(f"only work on reqres which match any of these expressions..."))
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

    def add_paths(cmd : _t.Any) -> None:
        cmd.add_argument("paths", metavar="PATH", nargs="*", type=str, help=_("inputs, can be a mix of files and directories (which will be traversed recursively)"))

    # pprint
    cmd = subparsers.add_parser("pprint", help=_("pretty-print WRR files"),
                                description = _("""Pretty-print given WRR files to stdout."""))
    add_errors(cmd)
    add_filters(cmd)
    add_abridged(cmd)
    add_paths(cmd)
    cmd.set_defaults(func=cmd_pprint)

    # get
    cmd = subparsers.add_parser("get", help=_("print expressions computed from a WRR file to stdout"),
                                description = _(f"""Compute output values by evaluating expressions `EXPR`s on a given reqres stored at `PATH`, then print them to stdout (terminating each value as specified)."""))

    cmd.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action="append", type=str, default = [], help=_('an expression to compute; can be specified multiple times in which case computed outputs will be printed sequentially, see also "output" options below; (default: `response.body|es`); each EXPR describes a state-transformer (pipeline) which starts from value `None` and evaluates a script built from the following:') + "\n" + \
                     "- " + _("constants and functions:") + "\n" + \
                     "".join([f"  - `{name}`: {_(value[0]).replace('%', '%%')}\n" for name, value in linst_atoms.items()]) + \
                     "- " + _("reqres fields, these work the same way as constants above, i.e. they replace current value of `None` with field's value, if reqres is missing the field in question, which could happen for `response*` fields, the result is `None`:") + "\n" + \
                     "".join([f"  - `{name}`: {_(value).replace('%', '%%')}\n" for name, value in Reqres_fields.items()]) + \
                     "- " + _("derived attributes:") + "\n" + \
                     "".join([f"  - `{name}`: {_(value).replace('%', '%%')}\n" for name, value in Reqres_derived_attrs.items()]) + \
                     "- " + _("a compound expression built by piping (`|`) the above, for example:") + """
  - `net_url|sha256`
  - `net_url|sha256|prefix 4`
  - `path|unquote`
  - `query|unquote_plus|abbrev 128`
  - `response.complete`: this will print the value of `response.complete` or `None`, if there was no response
  - `response.complete|false`: this will print `response.complete` or `False`
  - `response.body|eb`: this will print `response.body` or an empty string, if there was no response
""")
    add_terminator(cmd)

    cmd.add_argument("path", metavar="PATH", type=str, help=_("input WRR file path"))
    cmd.set_defaults(func=cmd_get)

    # run
    cmd = subparsers.add_parser("run", help=_("spawn a process on generated temporary files produced from expressions computed on WRR files"),
                                description = _("""Compute output values by evaluating expressions `EXPR`s for each of `NUM` reqres stored at `PATH`s, dump the results into into newly generated temporary files (terminating each value as specified), spawn a given `COMMAND` with given arguments `ARG`s and the resulting temporary file paths appended as the last `NUM` arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process."""))

    cmd.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action="append", type=str, default=["response.body|es"], help=_("the expression to compute, can be specified multiple times, see `{__package__} get --expr` for more info; (default: `response.body|es`)"))
    add_terminator(cmd)

    cmd.add_argument("-n", "--num-args", metavar="NUM", type=int, default = 1, help=_("number of `PATH`s (default: `%(default)s`)"))
    cmd.add_argument("command", metavar="COMMAND", type=str, help=_("command to spawn"))
    cmd.add_argument("args", metavar="ARG", nargs="*", type=str, help=_("additional arguments to give to the COMMAND"))
    cmd.add_argument("paths", metavar="PATH", nargs="+", type=str, help=_("input WRR file paths to be mapped into new temporary files"))
    cmd.set_defaults(func=cmd_run)

    def add_stdin0(cmd : _t.Any) -> None:
        cmd.add_argument("--stdin0", action="store_true", help=_("read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments, requires specified `--to`"))

    # find
    cmd = subparsers.add_parser("find", help=_("print paths of WRR files matching specified criteria"),
                                description = _(f"""Print paths of WRR files matching specified criteria."""))
    add_errors(cmd)
    add_filters(cmd)

    agrp = cmd.add_argument_group("output")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("-l", "--lf-terminated", dest="terminator", action="store_const", const = b"\n", help=_("output absolute paths of matching WRR files terminated with `\\n` (LF) newline characters to stdout (default)"))
    grp.add_argument("-z", "--zero-terminated", dest="terminator", action="store_const", const = b"\0", help=_("output absolute paths of matching WRR files terminated with `\\0` (NUL) bytes to stdout"))
    cmd.set_defaults(terminator = b"\n")

    add_stdin0(cmd)
    add_paths(cmd)
    cmd.set_defaults(func=cmd_find)

    # organize
    cmd = subparsers.add_parser("organize", help=_("rename/hardlink/symlink WRR files based on their metadata"),
                                description = _(f"""Rename/hardlink/symlink given WRR files to `DESTINATION` based on their metadata.

Operations that could lead to accidental data loss are not permitted.
E.g. `{__package__} organize --action rename` will not overwrite any files, which is why the default `--output` contains `%(num)d`."""))
    add_errors(cmd)
    add_filters(cmd)

    grp = cmd.add_mutually_exclusive_group()
    grp.add_argument("--dry-run", action="store_true", help=_("perform a trial run without actually performing any changes"))
    grp.add_argument("-q", "--quiet", action="store_true", help=_("don't log computed updates to stderr"))

    agrp = cmd.add_argument_group("output")
    grp = agrp.add_mutually_exclusive_group()
    grp.add_argument("--no-output", dest="terminator", action="store_const", const = None, help=_("don't print anything to stdout (default)"))
    grp.add_argument("-l", "--lf-terminated", dest="terminator", action="store_const", const = b"\n", help=_("output absolute paths of newly produced files terminated with `\\n` (LF) newline characters to stdout"))
    grp.add_argument("-z", "--zero-terminated", dest="terminator", action="store_const", const = b"\0", help=_("output absolute paths of newly produced files terminated with `\\0` (NUL) bytes to stdout"))
    cmd.set_defaults(terminator = None)

    cmd.add_argument("-a", "--action", choices=["rename", "hardlink", "symlink", "symlink-update"], default="rename", help=_("""organize how:
- `rename`: rename source files under `DESTINATION`, will fail if target already exists (default)
- `hardlink`: create hardlinks from source files to paths under `DESTINATION`, will fail if target already exists
- `symlink`: create symlinks from source files to paths under `DESTINATION`, will fail if target already exists
- `symlink-update`: create symlinks from source files to paths under `DESTINATION`, will overwrite the target if `stime_ms` for the source reqres is newer than the same value for the target
"""))

    grp = cmd.add_mutually_exclusive_group()
    grp.add_argument("--batch-number", metavar = "INT", dest="batch", type=int, default=1024, help=_("batch at most this many `--action`s together (default: `%(default)s`), making this larger improves performance at the cost of increased memory consumption, setting it to zero will force all `--action`s to be applied immediately"))
    grp.add_argument("--lazy", action="store_true", help=_(f"sets `--batch-number` to positive infinity; most useful in combination with `--action symlink-update` in which case it will force `{__package__}` to compute the desired file system state first and then perform disk writes in a single batch"))

    cmd.add_argument("-o", "--output", metavar="FORMAT", default="default", type=str, help=_("format describing the generated output path, an alias name or a custom pythonic %%-substitution string:") + "\n" + \
                     "- " + _("available aliases and corresponding %%-substitutions:") + "\n" + \
                     "".join([f"  - `{name}`: `{value.replace('%', '%%')}`" + (" (default)" if name == "default" else "") + "\n" for name, value in output_aliases.items()]) + \
                     "- " + _("available substitutions:") + "\n" + \
                     "  - `num`: " + _("number of times an output path like this was seen; this value gets incremened for each new WRR file generating the same path with `num` set to `0` and when the file at the path generated with the current value of `num` already exists; i.e. adding this parameter to your `--output` format will ensure all generated file names will be unique") + "\n" + \
                     "  - " + _(f"all expressions of `{__package__} get --expr`, which see"))
    cmd.add_argument("-t", "--to", dest="destination", metavar="DESTINATION", type=str, help=_("target directory, when unset each source `PATH` must be a directory which will be treated as its own `DESTINATION`"))

    add_stdin0(cmd)
    add_paths(cmd)
    cmd.set_defaults(func=cmd_organize)

    # stream
    cmd = subparsers.add_parser("stream", help=_(f"produce a stream structured lists containing expressions computed from specified WRR files to stdout, a generalized `{__package__} get`"),
                                description = _("""Compute given expressions for each of given WRR files, encode them into a requested format, and print the result to stdout."""))
    add_errors(cmd)
    add_filters(cmd)
    add_abridged(cmd)

    cmd.add_argument("--format", choices=["py", "cbor", "json", "raw"], default="py", help=_("""generate output in:
- py: Pythonic Object Representation aka `repr` (default)
- cbor: CBOR (RFC8949)
- json: JavaScript Object Notation aka JSON (binary data can't be represented, UNICODE replacement characters will be used)
- raw: concatenate raw values (termination is controlled by `*-terminated` options)
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

    try:
        cargs.func(cargs)
    except KeyboardInterrupt:
        stderr.write_str_ln("Interrupted!")
        errorcnt.errors += 1
    except CatastrophicFailure as exc:
        stderr.write_str_ln("error: " + str(exc))
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
