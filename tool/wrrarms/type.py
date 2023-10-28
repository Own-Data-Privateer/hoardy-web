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
# This file is part of pwebarc project.

import time as _time
import typing as _t
from kisstdlib.exceptions import *

class CheckedDataClass:
    def __post_init__(self) -> None:
        """__instancecheck__ all fields after __init__"""
        dcf = self.__class__.__dataclass_fields__ # type: ignore
        for k in dcf:
            field = dcf[k]
            v = getattr(self, k)
            typ = field.type
            if not typ.__instancecheck__(v):
                raise TypeError("wrong type while constructing %s: field %s wants %s got %s", type(self), k, typ, type(v))

WrappedValueType = _t.TypeVar("WrappedValueType")
class WrappedValue(_t.Generic[WrappedValueType]):
    def __init__(self, value : WrappedValueType) -> None:
        self.value = value

    def __repr__(self) -> str:
        return "<%s %s>" % (self.__class__.__name__, repr(self.value))

class EpochMsec(WrappedValue[int]):
    @classmethod
    def __instancecheck__(cls, value : _t.Any) -> bool:
        return int.__instancecheck__(value)

    def format(self, fmt : str = "%Y-%m-%d %H:%M:%S") -> str:
        return _time.strftime(fmt, _time.localtime(self.value // 1000)) + "." + format(self.value % 1000, "03")

    def __str__(self) -> str:
        return self.format()

    def __repr__(self) -> str:
        return "<EpochMsec %s>" % (self.format(),)

    def __int__(self) -> int:
        return self.value

def fmt_msec_diff(from_msec : EpochMsec, to_msec : EpochMsec) -> str:
    value = to_msec.value - from_msec.value
    hours = value // 3600000
    value = value % 3600000
    minutes = value // 60000
    value = value % 60000
    seconds = value // 1000
    value = value % 1000
    return str(hours) + ":" + format(minutes, "02") + ":" + format(seconds, "02") + "." + format(value, "03")

def fmt_msec_interval(from_msec : EpochMsec, to_msec : EpochMsec) -> str:
    return f"[{str(from_msec)}]--[{str(to_msec)}] => {fmt_msec_diff(from_msec, to_msec)}"

def rec_get(obj : _t.Any, field : list[str]) -> _t.Any:
    if len(field) == 0:
        return obj

    this, *rest = field
    if isinstance(obj, dict) and this in obj:
        return rec_get(obj[this], rest)
    elif hasattr(obj, "__dataclass_fields__") and this in obj.__dataclass_fields__:
        return rec_get(getattr(obj, this), rest)
    else:
        raise Failure("object of type `%s` does not have an attribute named `%s'", type(obj).__name__, this)

def plainify(obj : _t.Any) -> _t.Any:
    if isinstance(obj, WrappedValue):
        return obj.value
    elif hasattr(obj, "__dataclass_fields__"):
        res = dict()
        for k in obj.__dataclass_fields__:
            res[k] = getattr(obj, k)
        return res
    else:
        raise Failure("can't plainify a value of type `%s`", type(obj).__name__)
