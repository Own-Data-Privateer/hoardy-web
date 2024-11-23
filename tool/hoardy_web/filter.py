# Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
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

import dataclasses as _dc
import logging as _logging
import re as _re
import typing as _t

from gettext import gettext

@_dc.dataclass
class ConditionUsage:
    evaluated : int
    matched : int

ConditionsKeyType = _t.TypeVar("ConditionsKeyType")
ConditionsValueType = _t.TypeVar("ConditionsValueType")
Conditions = dict[ConditionsKeyType, tuple[ConditionsValueType, ConditionUsage]]

def mk_conditions(fk : _t.Callable[[str], ConditionsKeyType],
                  fv : _t.Callable[[str], ConditionsValueType],
                  attrs : _t.Iterable[str]) -> Conditions[ConditionsKeyType, ConditionsValueType]:
    res : Conditions[ConditionsKeyType, ConditionsValueType] = dict()
    for v in attrs:
        res[fk(v)] = fv(v), ConditionUsage(0, 0)
    return res

ConditionsGivenType = _t.TypeVar("ConditionsGivenType")

PredicateMatchesType : _t.TypeAlias = \
    _t.Callable[[_t.Callable[[ConditionsKeyType, ConditionsValueType, ConditionsGivenType], bool],
                 Conditions[ConditionsKeyType, ConditionsValueType],
                 ConditionsGivenType], bool]

def matches_all(predicate : _t.Callable[[ConditionsKeyType, ConditionsValueType, ConditionsGivenType], bool],
                c : Conditions[ConditionsKeyType, ConditionsValueType],
                given : ConditionsGivenType) -> bool:
    for k, vu in c.items():
        v, usage = vu
        usage.evaluated += 1
        if not predicate(k, v, given):
            return False
        usage.matched += 1
    return True

def matches_any(predicate : _t.Callable[[ConditionsKeyType, ConditionsValueType, ConditionsGivenType], bool],
                c : Conditions[ConditionsKeyType, ConditionsValueType],
                given : ConditionsGivenType) -> bool:
    for k, vu in c.items():
        v, usage = vu
        usage.evaluated += 1
        if predicate(k, v, given):
            usage.matched += 1
            return True
    return False

def matches_key_in(c : Conditions[ConditionsKeyType, ConditionsValueType],
                   keys : _t.Iterable[ConditionsKeyType]) -> bool:
    for k in keys:
        vu = c.get(k, None)
        if vu is not None:
            _u, usage = vu
            usage.matched += 1
            return True
    return False

def str_id(x : str) -> str:
    return x

FilterNameType : _t.TypeAlias = str
FilterValueType = _t.TypeVar("FilterValueType")
FilterType = tuple[int, _t.Callable[[FilterValueType], bool], _t.Callable[[], None]]

def mk_simple_filter(get_attr : _t.Callable[[FilterNameType], list[str]],
                     get_optname : _t.Callable[[FilterNameType], str],
                     name : FilterNameType,
                     yes : bool,
                     fv : _t.Callable[[str], ConditionsValueType],
                     matches : _t.Callable[[Conditions[str, ConditionsValueType], FilterValueType], bool]) \
                     -> FilterType[FilterValueType]:
    cmps = mk_conditions(str_id, fv, get_attr(name))
    num = len(cmps)

    def allows(v : FilterValueType) -> bool:
        res = matches(cmps, v)
        return res if yes else not res

    def warn() -> None:
        warn_redundant(get_optname(name), yes, cmps)

    return num, allows, warn

def str_lower(x : str) -> str:
    return x.lower()

def re_compile(x : str) -> _re.Pattern[str]:
    return _re.compile(x)

def pred_has_prefix(k : _t.Any, p : str, vs : _t.Iterable[str]) -> bool:
    for v in vs:
        if v.startswith(p):
              return True
    return False

def pred_fullmatch_re(k : _t.Any, p : _re.Pattern[str], vs : _t.Iterable[str]) -> bool:
    for v in vs:
        if p.fullmatch(v):
              return True
    return False

OptionallyDeferredList = list[ConditionsValueType] | _t.Callable[[], list[ConditionsValueType]]
StrFilterInputType = tuple[list[str],
                           OptionallyDeferredList[str]]

def mk_str_filter(get_attr : _t.Callable[[FilterNameType], list[str]],
                  get_optname : _t.Callable[[FilterNameType], str],
                  name : FilterNameType,
                  yes : bool,
                  fk : _t.Callable[[str], str],
                  fp : _t.Callable[[str], str],
                  get_inputs : _t.Callable[[FilterValueType], StrFilterInputType]) \
                  -> FilterType[FilterValueType]:
    name_p = name + "_prefix"
    name_re = name + "_re"

    exacts = mk_conditions(fk, str_id, get_attr(name))
    prefixes = mk_conditions(str_id, fp, get_attr(name_p))
    reres = mk_conditions(str_id, re_compile, get_attr(name_re))
    num = len(exacts) + len(prefixes) + len(reres)

    def allows(v : FilterValueType) -> bool:
        ks, rs = get_inputs(v)
        res = len(exacts) > 0 and matches_key_in(exacts, ks) or \
              len(prefixes) > 0 and matches_any(pred_has_prefix, prefixes, ks) or \
              len(reres) > 0 and matches_any(pred_fullmatch_re, reres, rs if isinstance(rs, list) else rs())
        return res if yes else not res

    def warn() -> None:
        warn_unmatched(get_optname(name), exacts)
        warn_redundant(get_optname(name_p), yes, prefixes)
        warn_redundant(get_optname(name_re), yes, reres)

    return num, allows, warn

PatternSB = tuple[_re.Pattern[str], _re.Pattern[bytes]]
IterSB : _t.TypeAlias = _t.Iterable[str | bytes]

def pred_grep(k : _t.Any, rere : PatternSB, vs : IterSB) -> bool:
    rec, brec = rere
    for v in vs:
        if isinstance(v, str):
            if rec.search(v) is not None:
                return True
        else:
            if brec.search(v) is not None:
                return True
    return False

def mk_grep_filter(get_attr : _t.Callable[[FilterNameType], list[str]],
                   get_optname : _t.Callable[[FilterNameType], str],
                   name : FilterNameType,
                   yes : bool,
                   ignore_case : bool | None,
                   matches : PredicateMatchesType[str, PatternSB, IterSB],
                   get_inputs : _t.Callable[[FilterValueType], IterSB]) \
                   -> FilterType[FilterValueType]:
    def grep_re_compile(x : str) -> tuple[_re.Pattern[str], _re.Pattern[bytes]]:
        flags = _re.IGNORECASE if ignore_case is True or ignore_case is None and x.islower() else 0 # smart case
        return _re.compile(x, flags), _re.compile(x.encode("utf-8"), flags)

    def grep_str_compile(x : str) -> tuple[_re.Pattern[str], _re.Pattern[bytes]]:
        return grep_re_compile(_re.escape(x))

    name_re = name + "_re"

    pieces = mk_conditions(str_id, grep_str_compile, get_attr(name))
    reres = mk_conditions(str_id, grep_re_compile, get_attr(name_re))
    num = len(pieces) + len(reres)

    def allows(v : FilterValueType) -> bool:
        ms = get_inputs(v)
        res = len(pieces) > 0 and matches(pred_grep, pieces, ms) or \
              len(reres) > 0 and matches(pred_grep, reres, ms)
        return res if yes else not res

    def warn() -> None:
        warn_redundant(get_optname(name), yes, pieces)
        warn_redundant(get_optname(name_re), yes, reres)

    return num, allows, warn

FilterParamSpec = _t.ParamSpec("FilterParamSpec")
def add_yn_filter(dest : list[FilterType[FilterValueType]],
                  get_attr : _t.Callable[[FilterNameType], list[str]],
                  get_optname : _t.Callable[[FilterNameType], str],
                  name : FilterNameType,
                  mk_filter : _t.Callable[_t.Concatenate[_t.Callable[[FilterNameType], list[str]],
                                                         _t.Callable[[FilterNameType], str],
                                                         FilterNameType, bool, FilterParamSpec],
                                          FilterType[FilterValueType]],
                  *args : FilterParamSpec.args, **kwargs : FilterParamSpec.kwargs) -> None:
    dest.append(mk_filter(get_attr, get_optname, name, True, *args, **kwargs))
    dest.append(mk_filter(get_attr, get_optname, "not_" + name, False, *args, **kwargs))

def merge_non_empty_filters(filters : list[FilterType[FilterValueType]]) -> FilterType[FilterValueType]:
    non_empty = list(filter(lambda e: e[0] > 0, filters))
    num = sum(map(lambda e: e[0], non_empty))

    if num == 0:
        def allows(v : FilterValueType) -> bool:
            return True
    else:
        def allows(v : FilterValueType) -> bool:
            return all(map(lambda e: e[1](v), non_empty))

    def warn() -> None:
        for e in non_empty:
            e[2]()

    return num, allows, warn

never_matched = gettext("filter `%s` `%s` is redundant: it matched no inputs")
def warn_unmatched(opt : str, m : Conditions[_t.Any, _t.Any]) -> None:
    for _u, rest in m.items():
        what, usage = rest
        if usage.matched == 0:
            _logging.warning(never_matched, opt, what)

never_evaluated = gettext("filter `%s` `%s` is redundant: it was never even evaluated")
none_match = gettext("filter `%s` `%s` is redundant: it matched no inputs it was evaluated on")
every_match = gettext("filter `%s` `%s` is redundant: it matched all inputs it was evaluated on")
def warn_redundant(opt : str, yes : bool, m : Conditions[_t.Any, _t.Any]) -> None:
    if yes:
        none = none_match
        every = every_match
    else:
        none = every_match
        every = none_match

    for what, rest in m.items():
        _u, usage = rest
        if usage.evaluated == 0:
            _logging.warning(never_evaluated, opt, what)
        elif usage.matched == 0:
            _logging.warning(none, opt, what)
        elif usage.evaluated == usage.matched:
            _logging.warning(every, opt, what)
