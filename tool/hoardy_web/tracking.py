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

import collections as _c
import dataclasses as _dc
import typing as _t

@_dc.dataclass
class Memory:
    consumption : int = 0

mem = Memory()

@_dc.dataclass
class SeenCounter(_t.Generic[_t.AnyStr]):
    _state : _c.OrderedDict[_t.AnyStr, int] = _dc.field(default_factory=_c.OrderedDict)

    def __len__(self) -> int:
        return len(self._state)

    def count(self, value : _t.AnyStr) -> int:
        try:
            count = self._state[value]
        except KeyError:
            self._state[value] = 0
            mem.consumption += 16 + len(value)
            return 0
        else:
            count += 1
            self._state[value] = count
            return count

    def pop(self) -> tuple[_t.AnyStr, int]:
        res = self._state.popitem(False)
        value, _ = res
        mem.consumption -= 16 + len(value)
        return res
