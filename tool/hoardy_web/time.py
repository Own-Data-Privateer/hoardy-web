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
import dataclasses as _dc
import decimal as _dec
import re as _re
import time as _time
import typing as _t

from kisstdlib.exceptions import *

import hoardy_web.parser as _p

class TimeStamp(_dec.Decimal):
    """Seconds since UNIX epoch, with arbitrary precision."""

    def format(self, fmt : str = "%Y-%m-%d %H:%M:%S", *, precision : int = 0, utc : bool = False) -> str:
        if self.is_infinite():
            if self < 0:
                return "-inf"
            else:
                return "+inf"

        i = int(self)
        r = self - i
        if fmt == "@":
            res = "@" + str(i)
        else:
            res = _time.strftime(fmt, _time.gmtime(i) if utc else _time.localtime(i))
        if precision > 0:
            x = str(r)[2:precision + 2]
            res += "." + x + "0" * (precision - len(x))
        return res

    def __repr__(self) -> str:
        return f"<TimeStamp {self.format(precision=9, utc=True)}>"

at_timestamp_re = _re.compile(r"@(\d+)(?:\.(\d+))?")
iso_timestamp_re = _re.compile(r"(\d\d\d\d)(?:[_-]?(\d\d)(?:[_-]?(\d\d)(?:[T_-]?\s*(\d\d)(?:[h:_-]?(\d\d)(?:[h:_-]?(\d\d)(?:[sd,.]?(\d+))?)?\s*(?:([_+-])?(\d\d)[:h]?(\d\d)m?)?)?)?)?)?")

def parse_TimeStamp(value : str, *, utc : bool = False) -> tuple[tuple[TimeStamp, TimeStamp], str]:
    """Parse a given string `value` into a pair of `TimeStamp` values which
       represent the start and the end (non-inclusive) of the continiuous time
       interval for which all timestamps can be described as being part of
       given `value`.

       E.g.
       - `parse_TimeStamp("2024") == (timestamp("2024-01-01 00:00:00"), timestamp("2025-01-01 00:00:00")), ""`
       - `parse_TimeStamp("2024-12") == (timestamp("2024-12-01 00:00:00"), timestamp("2025-01-01 00:00:00")), ""`
       - `parse_TimeStamp("2024-12-01 12:00:16") == (timestamp("2024-12-01 12:00:16"), timestamp("2024-12-01 12:00:17")), ""`
       - `parse_TimeStamp("2024-12-01 12:00:16.5") == (timestamp("2024-12-01 12:00:16.5"), timestamp("2024-12-01 12:00:16.6")), ""`

       Also, return leftover part of `value`.

       When the `value` includes no time zone information, it is interpreted as local time, unless `utc` is set.
    """

    ending = True
    m = at_timestamp_re.match(value)
    if m is not None:
        hs_, rs = m.groups()
        hs = es = int(hs_)
    else:
        m = iso_timestamp_re.match(value)
        if m is not None:
            year, month, day, hour, minute, second, rs, sign, tzhour, tzminute = m.groups()
            res = (int(year),
                   int(month) if month is not None else 1,
                   int(day) if day is not None else 1,
                   int(hour) if hour is not None else 0,
                   int(minute) if minute is not None else 0,
                   int(second) if second is not None else 0,
                   0, 1, -1)

            hts = _time.struct_time(res)

            if month is None:
                ets = _time.struct_time((res[0] + 1, *res[1:]))
                ending = False
            elif day is None:
                if res[1] < 12:
                    ets = _time.struct_time((res[0], res[1] + 1, *res[2:]))
                else:
                    ets = _time.struct_time((res[0] + 1, 1, *res[2:]))
                ending = False

            if tzhour is not None:
                offset = (1 if sign == "+" else -1) * (3600 * int(tzhour) + 60 * int(tzminute))
                utc = True
            else:
                offset = 0

            if utc:
                hs = int(_calendar.timegm(hts)) - offset
                es = hs if ending else int(_calendar.timegm(ets)) - offset
            else:
                hs = int(_time.mktime(hts))
                es = hs if ending else int(_time.mktime(ets))

            if ending:
                if hour is None:
                    es += 86400
                    ending = False
                elif minute is None:
                    es += 3600
                    ending = False
                elif second is None:
                    es += 60
                    ending = False
        else:
            raise _p.ParseError("failed to parse `%s` as a timestamp", value)

    if rs is not None:
        r, rp = int(rs), len(rs)
    else:
        r, rp = 0, 0

    hrem = _dec.Decimal(r) / (10 ** rp)
    erem = _dec.Decimal(r + 1) / (10 ** rp) if ending else _dec.Decimal(0)

    return (TimeStamp(_dec.Decimal(hs) + hrem), TimeStamp(_dec.Decimal(es) + erem)), value[m.span()[1]:]

def timestamp(value : str, start : bool = True, *, utc : bool = False) -> TimeStamp:
    """A simple wrapper over `parse_TimeStamp`."""
    (sres, eres), left = parse_TimeStamp(value, utc=utc)
    if len(left) > 0:
        raise _p.ParseError("failed to parse `%s` as a timestamp", value)
    return sres if start else eres

def test_parse_TimeStamp() -> None:
    def check(xs : str | list[str], value : TimeStamp, leftover : str = "") -> None:
        if isinstance(xs, str):
            xs = [xs]
        for x in xs:
            (res, _), left = parse_TimeStamp(x, utc=True)
            if (res, left) != (value, leftover):
                raise CatastrophicFailure("while parsing `%s`, expected %s, got %s", x, (value, leftover), (res, left))

    check("@123",                       TimeStamp(123))
    check("@123.456",                   TimeStamp("123.456"))
    check("2024",                       TimeStamp(1704067200))
    check(["2024-12", "202412"],        TimeStamp(1733011200))
    check(["2024-12-31", "20241231"],   TimeStamp(1735603200))

    check(["2024-12-31 12:07",
           "202412311207"],             TimeStamp(1735646820))

    check(["2024-12-31 12:07:16",
           "2024-12-31_12:07:16",
           "20241231120716"],           TimeStamp(1735646836))

    check(["2024-12-31 12:07:16.456",
           "20241231_120716.456",
           "20241231120716.456",
           "20241231120716456"],        TimeStamp("1735646836.456"))

    check(["2024-12-31 12:07:16 -01:00",
           "2024-12-31T12:07:16-01:00",
           "2024-12-31 12:07:16-01:00",
           "2024-12-31_12:07:16-0100",
           "20241231120716-0100"],      timestamp("2024-12-31 13:07:16", utc=True))

    check(["2024-12-31 12:07:16.456 -01:00",
           "2024-12-31T12:07:16.456-01:00",
           "2024-12-31T12:07:16,456-01:00",
           "2024-12-31T12:07:16,456000000-01:00",
           "20241231 120716.456 -0100",
           "20241231120716.456 -0100",
           "20241231120716.456-0100",
           "20241231120716456-0100"],   timestamp("2024-12-31 13:07:16.456", utc=True))

    check("2022-11-20 23:32:16+00:30",  timestamp("2022-11-20 23:02:16", utc=True))
    check("2022-11-20 23:32:16 -00:30", timestamp("2022-11-21 00:02:16", utc=True))

    check("20241231120716456-0100 or so",     TimeStamp("1735650436.456"), " or so")
    check("2024-12-31 12:07:16 -0100 or so",  TimeStamp(1735650436), " or so")

def test_format_TimeStamp() -> None:
    assert timestamp("2024-12-31 12:07:16.456789", utc=True).format(precision=3, utc=True) == "2024-12-31 12:07:16.456"
    assert timestamp("2024-12-31 12:07:16.450", utc=True).format(precision=3, utc=True) == "2024-12-31 12:07:16.450"
    assert timestamp("2024-12-31 12:07:16", utc=True).format(precision=3, utc=True) == "2024-12-31 12:07:16.000"

def test_parse_TimeStamp_end() -> None:
    def check(x : str, value : TimeStamp, leftover : str = "") -> None:
        (_, res), left = parse_TimeStamp(x, utc=True)
        if (res, left) != (value, leftover):
            raise CatastrophicFailure("while parsing `%s`, expected %s, got %s", x, (value, leftover), res)

    check("@123",                       TimeStamp(124))
    check("@123.456",                   TimeStamp("123.457"))
    check("2024",                       timestamp("2025-01-01", utc=True))
    check("2024-11",                    timestamp("2024-12-01", utc=True))
    check("2024-12",                    timestamp("2025-01-01", utc=True))
    check("2024-10-30",                 timestamp("2024-10-31", utc=True))
    check("2024-11-30",                 timestamp("2024-12-01", utc=True))
    check("2024-12-31",                 timestamp("2025-01-01", utc=True))
    check("2024-12-31 12",              timestamp("2024-12-31 13:00", utc=True))
    check("2024-11-30 23",              timestamp("2024-12-01 00:00", utc=True))
    check("2024-12-31 23",              timestamp("2025-01-01 00:00", utc=True))
    check("2024-12-31 23:30",           timestamp("2024-12-31 23:31", utc=True))
    check("2024-12-31 23:59",           timestamp("2025-01-01 00:00", utc=True))
    check("2024-12-31 23:59:30",        timestamp("2024-12-31 23:59:31", utc=True))
    check("2024-12-31 23:59:59",        timestamp("2025-01-01 00:00", utc=True))
    check("2024-12-31 23:59:59.5",      timestamp("2024-12-31 23:59:59.6", utc=True))
    check("2024-12-31 23:59:59.9",      timestamp("2025-01-01 00:00", utc=True))

timerange_pre_re = _re.compile(r"[([{<]?")
timerange_post_re = _re.compile(r"[)\]}>]?")
timerange_delimiter_re = _re.compile("--?")

@_dc.dataclass
class TimeRange:
    """Continious time interval between two `TimeStamp` timestamps."""

    start : TimeStamp
    end : TimeStamp
    includes_start : bool = _dc.field(default = True)
    includes_end : bool = _dc.field(default = False)

    def __contains__(self, value : TimeStamp) -> bool:
        if self.includes_start and value == self.start or \
           self.includes_end and value == self.end:
            return True
        return self.start < value < self.end

    @property
    def middle(self) -> TimeStamp:
        return TimeStamp((self.start + self.end) / 2)

    @property
    def delta(self) -> _dec.Decimal:
        return self.end - self.start

    def format(self, fmt : str = "%Y-%m-%d %H:%M:%S", *, precision : int = 0, utc : bool = False) -> str:
        return self.start.format(fmt, precision=precision, utc=utc) + "--" + self.end.format(fmt, precision=precision, utc=utc)

    def __repr__(self) -> str:
        return f"<TimeRange {'[' if self.includes_start else '('}{self.format(precision=9, utc=True)}{']' if self.includes_end else ')'}>"

    def format_org_delta(self, precision : int = 0) -> str:
        r = self.delta
        hours = r // 3600
        r = r % 3600
        minutes = r // 60
        r = r % 60
        seconds = int(r)
        r = r - seconds
        res = str(hours) + ":" + format(minutes, "02") + ":" + format(seconds, "02")
        if precision > 0:
            x = str(r)[2:precision + 2]
            res += "." + x + "0" * (precision - len(x))
        return res

    def format_org(self, *, precision : int = 0, utc : bool = False) -> str:
        return f"[{self.start.format(precision=precision, utc=utc)}]--[{self.end.format(precision=precision, utc=utc)}] => {self.format_org_delta(precision=precision)}"

anytime = TimeRange(TimeStamp("-inf"), TimeStamp("+inf"), True, True)

def parse_TimeRange(value : str, *, utc : bool = False) -> tuple[TimeRange, str]:
    """Parse a given string `value` into `TimeRange`."""
    p = _p.Parser(value)
    if p.opt_string("*"):
        return anytime, p.leftovers
    try:
        p.opt_regex(timerange_pre_re)
        start, end = p.chomp(parse_TimeStamp, utc=utc)
        stop = p.opt_string("*")
        p.opt_regex(timerange_post_re)
        if not stop:
            try:
                p.regex(timerange_delimiter_re)
            except _p.ParseError:
                pass
            else:
                p.opt_regex(timerange_pre_re)
                _, end = p.chomp(parse_TimeStamp, utc=utc)
                p.opt_regex(timerange_post_re)
        return TimeRange(start, end), p.leftovers
    except _p.ParseError:
        raise _p.ParseError("failed to parse `%s` as a time interval", value)

def timerange(value : str, utc : bool = False) -> TimeRange:
    """A simple wrapper over `parse_TimeRange`."""
    res, left = parse_TimeRange(value, utc=utc)
    if len(left) > 0:
        raise _p.ParseError("failed to parse `%s` as a time interval", value)
    return res

def test_parse_TimeRange() -> None:
    def check(xs : str | list[str], value : TimeRange, leftover : str = "") -> None:
        if isinstance(xs, str):
            xs = [xs]
        for x in xs:
            res = parse_TimeRange(x, utc=True)
            if res != (value, leftover):
                raise CatastrophicFailure("while parsing `%s`, expected %s, got %s", x, (value, leftover), res)

    check("*",                          anytime)
    check(["@123--@125",
           "<@123>--<@125>"],           TimeRange(TimeStamp(123), TimeStamp(126)))
    check(["2024-12-31",
           "2024-12-31*",
           "[2024-12-31]"],             TimeRange(timestamp("2024-12-31 00:00", utc=True),
                                                  timestamp("2025-01-01 00:00", utc=True)))
    check("2024-12-31 12",              TimeRange(timestamp("2024-12-31 12:00", utc=True),
                                                  timestamp("2024-12-31 13:00", utc=True)))
    check("2024-12-31 12:00",           TimeRange(timestamp("2024-12-31 12:00", utc=True),
                                                  timestamp("2024-12-31 12:01", utc=True)))
    check("2024-12-31 23:59",           TimeRange(timestamp("2024-12-31 23:59", utc=True),
                                                  timestamp("2025-01-01 00:00", utc=True)))
    check("[2024-12-31 23:59]--[2025-01-02]", TimeRange(timestamp("2024-12-31 23:59", utc=True),
                                                        timestamp("2025-01-03 00:00", utc=True)))
