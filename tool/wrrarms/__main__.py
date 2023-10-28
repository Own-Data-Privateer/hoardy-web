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

def get_bytes(expr : str, path : str) -> bytes:
    abs_path = _os.path.abspath(_os.path.expanduser(path))
    reqres = wrr_loadf(abs_path)
    rrexpr = ReqresExpr(reqres, abs_path)
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
    data = get_bytes(cargs.expr, cargs.path)
    stdout.write_bytes(data)

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
            data = get_bytes(cargs.expr, path)

            # TODO: extension guessing
            fileno, tmp_path = _tempfile.mkstemp(prefix = "wrrarms_run_", suffix = ".tmp")
            tmp_paths.append(tmp_path)

            with TIOWrappedWriter(_os.fdopen(fileno, "wb")) as f:
                f.write_bytes(data)

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
        description=_("A tool to pretty-print, compute and print values from, search, (WIP: check, deduplicate, and edit) pWebArc WRR (WEBREQRES, Web REQuest+RESponse) archive files.") + "\n\n" +
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
        cmd.add_argument("--errors", choices=["fail", "skip", "ignore"], default="fail", help=_("""when an error occurs:
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
    cmd = subparsers.add_parser("get", help=_("print an expression computed from a WRR file to stdout"),
                                description = _(f"""Compute an expression EXPR for a reqres stored at PATH and then print it to stdout."""))
    cmd.add_argument("-e", "--expr", metavar="EXPR", default = "response.body|es", help=_('an expression to compute (default: `%(default)s`), a state-transformer (pipeline) which starts from value `None` and applies to it a program built from the following:') + "\n" + \
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

    cmd.add_argument("path", metavar="PATH", type=str, help=_("input WRR file path"))
    cmd.set_defaults(func=cmd_get)

    # run
    cmd = subparsers.add_parser("run", help=_("spawn a process on generated temporary files produced from expressions computed on WRR files"),
                                description = _("""Compute an expression EXPR for each of NUM reqres stored at PATHs, dump the results into into newly created temporary files, spawn a given COMMAND with given arguments ARGs and the resulting temporary file paths appended as the last NUM arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process."""))
    cmd.add_argument("-e", "--expr", metavar="EXPR", default = "response.body|es", help=_("the expression to compute, see `{__package__} get --expr` for more info  on expression format (default: `%(default)s`)"))
    cmd.add_argument("-n", "--num-args", metavar="NUM", type=int, default = 1, help=_("number of PATHs (default: `%(default)s`)"))
    cmd.add_argument("command", metavar="COMMAND", type=str, help=_("command to spawn"))
    cmd.add_argument("args", metavar="ARG", nargs="*", type=str, help=_("additional arguments to give to the COMMAND"))
    cmd.add_argument("paths", metavar="PATH", nargs="+", type=str, help=_("input WRR file paths to be mapped into new temporary files"))
    cmd.set_defaults(func=cmd_run)

    def add_stdin0(cmd : _t.Any) -> None:
        cmd.add_argument("--stdin0", action="store_true", help=_("read zero-terminated PATHs from stdin, these will be processed after PATHs specified as command-line arguments, requires specified `--to`"))

    # find
    cmd = subparsers.add_parser("find", help=_("print paths of WRR files matching specified criteria"),
                                description = _(f"""Print paths of WRR files matching specified criteria."""))
    add_errors(cmd)
    add_filters(cmd)
    add_stdin0(cmd)

    grp = cmd.add_mutually_exclusive_group()
    grp.add_argument("-l", "--lf-terminated", dest="terminator", action="store_const", const = b"\n", help=_("output absolute paths of matching WRR files terminated with `\\n` (LF) newline characters to stdout (default)"))
    cmd.add_argument("-z", "--zero-terminated", dest="terminator", action="store_const", const = b"\0", help=_("output absolute paths of matching WRR files terminated with `\\0` (NUL) bytes to stdout"))
    cmd.set_defaults(terminator = b"\n")

    add_paths(cmd)
    cmd.set_defaults(func=cmd_find)

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

    grp = cmd.add_mutually_exclusive_group()
    grp.add_argument("-l", "--lf-terminated", dest="terminator", action="store_const", const = b"\n", help=_("terminate `raw` output values with `\\n` (LF) newline characters (default)"))
    cmd.add_argument("-z", "--zero-terminated", dest="terminator", action="store_const", const = b"\0", help=_("terminate `raw` output values with `\\0` (NUL) bytes"))
    grp.add_argument("-n", "--not-terminated", dest="terminator", action="store_const", const = b"", help=_("don't terminate `raw` output values with anything, just concatenate them"))
    cmd.set_defaults(terminator = b"\n")

    cmd.add_argument("-e", "--expr", dest="exprs", metavar="EXPR", action="append", type=str, default = [], help=_(f'an expression to compute, see `{__package__} get --expr` for more info on expression format, can be specified multiple times (default: `%(default)s`); to dump all the fields of a reqres, specify "`.`"'))
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
