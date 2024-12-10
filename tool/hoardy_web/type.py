# Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
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

import calendar as _calendar
import decimal as _dec
import re as _re
import time as _time
import typing as _t

from kisstdlib.exceptions import *

class Epoch(_dec.Decimal):
    def format(self, decimal : bool = True, fmt : str = "%Y-%m-%d %H:%M:%S") -> str:
        return _time.strftime(fmt, _time.localtime(int(self))) + \
            ("" if not decimal else "." + format(int(self * 1000) % 1000, "03"))

    def __repr__(self) -> str:
        return f"<Epoch {self.format()}>"

epoch_re = _re.compile(r"@(\d+)(?:\.(\d+))?")
iso_epoch_re = _re.compile(r"(\d\d\d\d+)(?:-(\d+)(?:-(\d+)(?:(?:T|\s+)(\d+):(\d+)(?::(\d+)(?:\.(\d+))?)?\s*(?:([+-])(\d\d):?(\d\d))?)?)?)?")

def parse_Epoch(value : str) -> Epoch:
    m = epoch_re.match(value)
    if m is not None:
        hs_, qs = m.groups()
        hs = int(hs_)
    else:
        m = iso_epoch_re.match(value)
        if m is not None:
            year, month, day, hour, minute, second, qs, sign, tzhour, tzminute = m.groups()
            res = _time.struct_time((int(year) if year is not None else 1900,
                                     int(month) if month is not None else 1,
                                     int(day) if day is not None else 1,
                                     int(hour) if hour is not None else 0,
                                     int(minute) if minute is not None else 0,
                                     int(second) if second is not None else 0,
                                     0, 1, -1))
            if tzhour is not None:
                offset = 3600 * int(tzhour) + 60 * int(tzminute)
                hs = _calendar.timegm(res) + (1 if sign == "+" else -1) * offset
            else:
                hs = int(_time.mktime(res))
        else:
            raise Failure("failed to parse `%s` as an Epoch value", value)

    if qs is not None:
        quotient = _dec.Decimal(int(qs)) / (10 ** len(qs))
    else:
        quotient = _dec.Decimal(0)
    return Epoch(_dec.Decimal(hs) + quotient)

def test_parse_Epoch() -> None:
    def check(x : str, value : Epoch) -> None:
        res = parse_Epoch(x)
        if res != value:
            raise CatastrophicFailure("while parsing `%s`, got %s, expected %s", x, res, value)

    check("@123",                       Epoch(123))
    check("@123.456",                   Epoch("123.456"))
    check("2024",                       Epoch(1704067200))
    check("2024-12",                    Epoch(1733011200))
    check("2024-12-31",                 Epoch(1735603200))
    check("2024-12-31 12:07",           Epoch(1735646820))
    check("2024-12-31 12:07:16",        Epoch(1735646836))
    check("2024-12-31 12:07:16.456",    Epoch("1735646836.456"))
    check("2024-12-31 12:07:16 +0100",  Epoch(1735650436))
    check("2024-12-31 12:07:16 -00:30", Epoch(1735645036))

def fmt_epoch_diff(from_epoch : Epoch, to_epoch : Epoch, decimal : bool = True) -> str:
    value = int((to_epoch - from_epoch) * 1000)
    hours = value // 3600000
    value = value % 3600000
    minutes = value // 60000
    value = value % 60000
    seconds = value // 1000
    value = value % 1000
    return str(hours) + ":" + format(minutes, "02") + ":" + format(seconds, "02") + \
        ("" if not decimal else "." + format(value, "03"))

def fmt_epoch_interval(from_epoch : Epoch, to_epoch : Epoch, decimal : bool = True) -> str:
    return f"[{from_epoch.format(decimal)}]--[{to_epoch.format(decimal)}] => {fmt_epoch_diff(from_epoch, to_epoch, decimal)}"
