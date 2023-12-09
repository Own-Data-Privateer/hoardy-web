# Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
#
# This file is a part of pwebarc project.
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

   A caching translator that compiles expressions like "net_url|sha256|prefix 4"
   into Python functions.
"""

import hashlib as _hashlib
import typing as _t
import urllib.parse as _up

from kisstdlib.exceptions import *

LinstFunc = _t.Callable[[_t.Any, _t.Any], _t.Any]
LinstAtom = tuple[list[type], _t.Callable[..., LinstFunc]]

class LinstCompileError(Failure): pass
class LinstUnknownAtomError(LinstCompileError): pass

def linst_unknown_atom(name : str) -> LinstAtom:
    raise LinstUnknownAtomError("unknown atom `%s`", name)

def _run_pipe(pipe : list[LinstFunc]) -> LinstFunc:
    def sub(env : _t.Any, v : _t.Any) -> _t.Any:
        for func in pipe:
            v = func(env, v)
        return v
    return sub

_compile_cache : dict[str, LinstFunc] = {}

def linst_compile(expr : str, lookup : _t.Callable[[str], LinstAtom] = linst_unknown_atom) -> LinstFunc:
    try:
        return _compile_cache[expr]
    except KeyError:
        pass

    pipe = []
    for single in expr.split("|"):
        parts = single.strip().split(" ")
        cmd, *args = parts
        argtypes, func = lookup(cmd)

        atlen = len(argtypes)
        if atlen != len(args):
            raise LinstCompileError("wrong number of arguments to atom `%s`: expected %d, got %d", cmd, atlen, len(args))

        args_ : list[_t.Any] = []
        for i in range(0, atlen):
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
        res = _run_pipe(pipe)

    _compile_cache[expr] = res
    return res

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
        def envfunc(env : _t.Any, v : _t.Any) -> _t.Any:
            return v if v is not None else data
        return envfunc
    return [], args0

def linst_apply0(func : _t.Any) -> LinstAtom:
    def args0() -> _t.Callable[..., LinstFunc]:
        def envfunc(env : _t.Any, v : _t.Any) -> _t.Any:
            return func(v)
        return envfunc
    return [], args0

def linst_apply1(typ : _t.Any, func : _t.Any) -> LinstAtom:
    def args1(arg : _t.Any) -> _t.Callable[..., LinstFunc]:
        def envfunc(env : _t.Any, v : _t.Any) -> _t.Any:
            return func(v, arg)
        return envfunc
    return [typ], args1

def linst_apply2(typ1 : _t.Any, typ2 : _t.Any, func : _t.Any) -> LinstAtom:
    def args2(arg1 : _t.Any, arg2 : _t.Any) -> _t.Callable[..., LinstFunc]:
        def envfunc(env : _t.Any, v : _t.Any) -> _t.Any:
            return func(v, arg1, arg2)
        return envfunc
    return [typ1, typ2], args2

def linst_getenv(name : str) -> LinstAtom:
    def args0() -> _t.Callable[..., LinstFunc]:
        def envfunc(env : _t.Any, v : _t.Any) -> _t.Any:
            return v if v is not None else env(name)
        return envfunc
    return [], args0

# TODO this move somewhere else
def abbrev(v : _t.AnyStr, n : int) -> _t.AnyStr:
    vlen = len(v)
    if vlen > n:
        nn = n // 2
        v = v[:nn] + v[vlen - nn:]
    return v

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
    "quote": ("URL-percent-encoding quote value",
          linst_apply1(str, lambda v, arg: _up.quote(v, arg))),
    "quote_plus": ("URL-percent-encoding quote value and replace spaces with `+` symbols",
          linst_apply1(str, lambda v, arg: _up.quote_plus(v, arg))),
    "unquote": ("URL-percent-encoding unquote value",
          linst_apply0(lambda v: _up.unquote(v))),
    "unquote_plus": ("URL-percent-encoding unquote value and replace `+` symbols with spaces",
          linst_apply0(lambda v: _up.unquote_plus(v))),
    "sha256": ('compute `hex(sha256(value.encode("utf-8"))`',
          linst_apply0(lambda v: _hashlib.sha256(v if isinstance(v, bytes) else v.encode("utf-8")).hexdigest())),
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
    "prefix": ("take first `arg` characters",
          linst_apply1(int, lambda v, arg: v[:arg])),
    "suffix": ("take last `arg` characters",
          linst_apply1(int, lambda v, arg: v[len(v) - arg:])),
    "abbrev": ("leave the current value as if if its length is less or equal than `arg` characters, otherwise take first `arg/2` followed by last `arg/2` characters",
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
