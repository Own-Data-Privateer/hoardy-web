# Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
#
# This file is a part of `hoardy-web` project.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

"""LINear State Transformer Domain Specific Language (DSL).

   A caching translator that compiles expressions like "net_url|sha256|take_prefix 2|to_hex"
   into Python functions.
"""

import hashlib as _hashlib
import re as _re
import shlex as _shlex
import typing as _t
import urllib.parse as _up

from kisstdlib.exceptions import *

from .util import make_envfunc_pipe

LinstEnv = _t.Any # TODO: _t.Callable[[str], _t.Any]
LinstFunc = _t.Callable[[LinstEnv, _t.Any], _t.Any]
LinstAtom = tuple[list[type], _t.Callable[..., LinstFunc]]

class LinstCompileError(Failure): pass
class LinstUnknownAtomError(LinstCompileError): pass

def linst_unknown_atom(name : str) -> LinstAtom:
    raise LinstUnknownAtomError("unknown atom `%s`", name)

_compile_cache : dict[str, LinstFunc] = {}

def _linst_compile(expr : str, lookup : _t.Callable[[str], LinstAtom]) -> LinstFunc:
    if expr == "":
        return lambda e, v: v

    try:
        return _compile_cache[expr]
    except KeyError:
        pass

    pipe = []
    for single in expr.split("|"):
        cmd, *args = _shlex.split(single)
        argtypes, func = lookup(cmd)
        arglen = len(argtypes)

        if arglen != len(args):
            raise LinstCompileError("wrong number of arguments to atom `%s`: expected %d, got %d", cmd, arglen, len(args))

        args_ : list[_t.Any] = []
        for i in range(0, arglen):
            if argtypes[i] is None:
                args_.append(args[i])
            else:
                args_.append(argtypes[i](args[i]))

        func_ = func(*args_)
        pipe.append(func_)

    if len(pipe) == 0:
        raise LinstCompileError("empty pipe")
    elif len(pipe) == 1:
        res = pipe[0]
    else:
        res = make_envfunc_pipe(pipe)

    _compile_cache[expr] = res
    return res

def linst_compile(expr : str, lookup : _t.Callable[[str], LinstAtom] = linst_unknown_atom) -> LinstFunc:
    try:
        return _linst_compile(expr, lookup)
    except Failure as exc:
        exc.elaborate("while compiling `%s`", expr)
        raise exc

def linst_cast(typ : type, arg : _t.Any) -> _t.Any:
    atyp = type(arg)
    if atyp == typ:
        return arg

    if typ is str:
        if atyp is bool or atyp is int or atyp is float:
            return str(arg)
        elif atyp is bytes:
            return arg.decode("utf-8")
    elif atyp is str:
        if typ is bool:
            return bool(arg)
        elif typ is int:
            return int(arg)
        elif typ is float:
            return float(arg)
        elif typ is bytes:
            return arg.encode("utf-8")

    raise AssertionError("can't cast %s to %s", atyp.__name__, typ.__name__)

def linst_cast_val(v : _t.Any, arg : _t.Any) -> _t.Any:
    return linst_cast(type(v), arg)

def linst_const(data : _t.Any) -> LinstAtom:
    def args0() -> _t.Callable[..., LinstFunc]:
        def envfunc(env : LinstEnv, v : _t.Any) -> _t.Any:
            return v if v is not None else data
        return envfunc
    return [], args0

def linst_apply0(func : _t.Any) -> LinstAtom:
    def args0() -> _t.Callable[..., LinstFunc]:
        def envfunc(env : LinstEnv, v : _t.Any) -> _t.Any:
            return func(v)
        return envfunc
    return [], args0

def linst_apply1(typ : _t.Any, func : _t.Any) -> LinstAtom:
    def args1(arg : _t.Any) -> _t.Callable[..., LinstFunc]:
        def envfunc(env : LinstEnv, v : _t.Any) -> _t.Any:
            return func(v, arg)
        return envfunc
    return [typ], args1

def linst_apply2(typ1 : _t.Any, typ2 : _t.Any, func : _t.Any) -> LinstAtom:
    def args2(arg1 : _t.Any, arg2 : _t.Any) -> _t.Callable[..., LinstFunc]:
        def envfunc(env : LinstEnv, v : _t.Any) -> _t.Any:
            return func(v, arg1, arg2)
        return envfunc
    return [typ1, typ2], args2

def linst_getenv(name : str) -> LinstAtom:
    def args0() -> _t.Callable[..., LinstFunc]:
        def envfunc(env : LinstEnv, v : _t.Any) -> _t.Any:
            return v if v is not None else env.get_value(name) # TODO: env(name)
        return envfunc
    return [], args0

# TODO this move somewhere else
def abbrev(v : _t.AnyStr, n : int) -> _t.AnyStr:
    vlen = len(v)
    if vlen > n:
        nn = n // 2
        v = v[:nn] + v[vlen - nn:]
    return v

def linst_re_match(arg : _t.Any) -> _t.Callable[..., LinstFunc]:
    rec = _re.compile(arg)
    def envfunc(env : LinstEnv, v : _t.Any) -> _t.Any:
        m = rec.match(v)
        if m:
            return True
        return False
    return envfunc

linst_atoms : dict[str, tuple[str, LinstAtom]] = {
    "es": ('replace `None` value with an empty string `""`',
          linst_const("")),
    "eb": ('replace `None` value with an empty byte string `b""`',
          linst_const(b"")),
    "false": ('replace `None` value with `False`',
          linst_const(False)),
    "true": ('replace `None` value with `True`',
          linst_const(True)),
    "missing": ('`True` if the value is `None`',
          linst_apply0(lambda v: True if v is None else False)),
    "0": ('replace `None` value with `0`',
          linst_const(0)),
    "1": ('replace `None` value with `1`',
          linst_const(1)),
    "not": ("apply logical `not` to value",
          linst_apply0(lambda v: not v)),
    "len": ("apply `len` to value",
          linst_apply0(lambda v: len(v))),
    "str": ("cast value to `str` or fail",
          linst_apply0(lambda v: linst_cast(str, v))),
    "bytes": ("cast value to `bytes` or fail",
          linst_apply0(lambda v: linst_cast(bytes, v))),
    "bool": ("cast value to `bool` or fail",
          linst_apply0(lambda v: linst_cast(bool, v))),
    "int": ("cast value to `int` or fail",
          linst_apply0(lambda v: linst_cast(int, v))),
    "float": ("cast value to `float` or fail",
          linst_apply0(lambda v: linst_cast(float, v))),
    "echo": ("replace the value with the given string",
          linst_apply1(str, lambda v, arg: arg)),
    "quote": ("URL-percent-encoding quote value",
          linst_apply1(str, lambda v, arg: _up.quote(v, arg))),
    "quote_plus": ("URL-percent-encoding quote value and replace spaces with `+` symbols",
          linst_apply1(str, lambda v, arg: _up.quote_plus(v, arg))),
    "unquote": ("URL-percent-encoding unquote value",
          linst_apply0(lambda v: _up.unquote(v))),
    "unquote_plus": ("URL-percent-encoding unquote value and replace `+` symbols with spaces",
          linst_apply0(lambda v: _up.unquote_plus(v))),
    "to_ascii": ('encode `str` value into `bytes` with "ascii" codec, do nothing if the value is already `bytes`',
          linst_apply0(lambda v: v.encode("ascii") if isinstance(v, str) else v)),
    "to_utf8": ('encode `str` value into `bytes` with "utf-8" codec, do nothing if the value is already `bytes`',
          linst_apply0(lambda v: v.encode("utf-8") if isinstance(v, str) else v)),
    "to_hex": ('replace `bytes` value with its hexadecimal `str` representation',
          linst_apply0(lambda v: v.hex())),
    "from_hex": ('replace hexadecimal `str` value with its decoded `bytes` value',
          linst_apply0(lambda v: bytes.fromhex(v))),
    "sha256": ('replace `bytes` value with its `sha256` hash digest',
          linst_apply0(lambda v: _hashlib.sha256(v).digest())),
    "~=": ("check if the current value matches the regular exprission `arg`",
          ([str], linst_re_match)),
    "==": ("apply `== arg`, `arg` is cast to the same type as the current value",
          linst_apply1(None, lambda v, arg: v == linst_cast_val(v, arg))),
    "!=": ("apply `!= arg`, similarly",
          linst_apply1(None, lambda v, arg: v != linst_cast_val(v, arg))),
    "<": ("apply `< arg`, similarly",
          linst_apply1(None, lambda v, arg: v < linst_cast_val(v, arg))),
    "<=": ("apply `<= arg`, similarly",
          linst_apply1(None, lambda v, arg: v <= linst_cast_val(v, arg))),
    ">": ("apply `> arg`, similarly",
          linst_apply1(None, lambda v, arg: v > linst_cast_val(v, arg))),
    ">=": ("apply `>= arg`, similarly",
          linst_apply1(None, lambda v, arg: v >= linst_cast_val(v, arg))),
    "add_prefix": ("add prefix to the current value",
          linst_apply1(str, lambda v, arg: arg + v)),
    "add_suffix": ("add suffix to the current value",
          linst_apply1(str, lambda v, arg: v + arg)),
    "take_prefix": ("take first `arg` characters or list elements from the current value",
          linst_apply1(int, lambda v, arg: v[:arg])),
    "take_suffix": ("take last `arg` characters or list elements  from the current value",
          linst_apply1(int, lambda v, arg: v[len(v) - arg:])),
    "abbrev": ("leave the current value as-is if if its length is less or equal than `arg` characters, otherwise take first `arg/2` followed by last `arg/2` characters",
          linst_apply1(int, abbrev)),
    "abbrev_each": ("`abbrev arg` each element in a value `list`",
          linst_apply1(int, lambda v, arg: list(map(lambda e: abbrev(e, arg), v)))),
    "replace": ("replace all occurences of the first argument in the current value with the second argument, casts arguments to the same type as the current value",
          linst_apply2(str, str, lambda v, arg1, arg2: v.replace(linst_cast_val(v, arg1), linst_cast_val(v, arg2)))),
}

def linst_custom_or_env(atoms : dict[str, tuple[str, LinstAtom]]) -> _t.Callable[[str], LinstAtom]:
    def atom_or_env(name : str) -> LinstAtom:
        try:
            return atoms[name][1]
        except KeyError:
            return linst_getenv(name)
    return atom_or_env

linst_atom_or_env = linst_custom_or_env(linst_atoms)

class LinstEvaluator:
    lookup : _t.Callable[[str], LinstAtom]
    values : dict[str, _t.Any]

    def __init__(self, lookup : _t.Callable[[str], LinstAtom] = linst_atom_or_env, values : dict[str, _t.Any] | None = None) -> None:
        self.lookup = lookup
        if values is not None:
            self.values = values
        else:
            self.values = dict()

    def get_attr(self, name : str) -> _t.Any:
        raise ValueError(name)

    def get_value(self, name : str) -> _t.Any:
        if name.startswith("."):
            name = name[1:]

        try:
            return self.values[name]
        except KeyError:
            pass

        return self.get_attr(name)

    def __getattr__(self, name : str) -> _t.Any:
        return self.get_value(name)

    def eval_func(self, func : LinstFunc, v : _t.Any = None) -> _t.Any:
        return func(self, v) # TODO: func(self.get_value, v)

    def eval_expr(self, expr : str) -> _t.Any:
        try:
            return self.values[expr]
        except KeyError:
            pass

        func = linst_compile(expr, self.lookup)
        return func(self, None) # TODO: func(self.get_value, None)

    def __getitem__(self, expr : str) -> _t.Any:
        # this is used in `format_string % self` expressions
        res = self.eval_expr(expr)
        if res is None:
            raise Failure("expression `%s` evaluated to `None`", expr)
        return res
