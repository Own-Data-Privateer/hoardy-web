# Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
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

import decimal as _dec
import time as _time
import typing as _t

from kisstdlib.exceptions import *

class Epoch(_dec.Decimal):
    def format(self, fmt : str = "%Y-%m-%d %H:%M:%S") -> str:
        return _time.strftime(fmt, _time.localtime(int(self))) + "." + format(int(self * 1000) % 1000, "03")

    def __repr__(self) -> str:
        return "<Epoch %s>" % (self.format(),)

def fmt_epoch_diff(from_epoch : Epoch, to_epoch : Epoch) -> str:
    value = int((to_epoch - from_epoch) * 1000)
    hours = value // 3600000
    value = value % 3600000
    minutes = value // 60000
    value = value % 60000
    seconds = value // 1000
    value = value % 1000
    return str(hours) + ":" + format(minutes, "02") + ":" + format(seconds, "02") + "." + format(value, "03")

def fmt_epoch_interval(from_epoch : Epoch, to_epoch : Epoch) -> str:
    return f"[{str(from_epoch)}]--[{str(to_epoch)}] => {fmt_epoch_diff(from_epoch, to_epoch)}"

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
    if isinstance(obj, Epoch):
        return float(obj)
    elif hasattr(obj, "__dataclass_fields__"):
        res = dict()
        for k in obj.__dataclass_fields__:
            res[k] = getattr(obj, k)
        return res
    else:
        raise Failure("can't plainify a value of type `%s`", type(obj).__name__)
