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

import bisect as _bisect
import collections.abc as _abc
import dataclasses as _dc
import math as _math
import typing as _t

from sortedcontainers import SortedKeyList

from decimal import Decimal

SortedType = _t.TypeVar("SortedType", bound=Decimal|float|int)

def is_infinite(value : SortedType) -> bool:
    return isinstance(value, Decimal) and value.is_infinite() or \
           isinstance(value, float) and _math.isinf(value)

def nearer_to_than(ideal : SortedType, value : SortedType, other : SortedType) -> bool | None:
    """Check whether `value` is nearer to `ideal` than `other`.
       Return `None` if `other` and `value` are the same.
    """
    if other == value:
        return None
    elif is_infinite(ideal):
        return (ideal < 0)  ^ (other < value) # type: ignore
    else:
        return abs(ideal - value) < abs(ideal - other)  # type: ignore

def test_nearer_to_than() -> None:
    assert nearer_to_than(1, 0, 0) == None
    assert nearer_to_than(0, 10, 100)
    assert not nearer_to_than(0, 100, 10)

    inf : Decimal | float
    for inf in [Decimal("+inf"), _math.inf]: # type: ignore
        assert nearer_to_than(inf, 1, 0)
        assert nearer_to_than(-inf, 0, 1)
        assert not nearer_to_than(inf, 0, 1)
        assert not nearer_to_than(-inf, 1, 0)

SIKeyType = _t.TypeVar("SIKeyType")
SIValueType = _t.TypeVar("SIValueType")

def _fst(x : tuple[SortedType, SIValueType]) -> SortedType:
    return x[0]

@_dc.dataclass
class SortedIndex(_t.Generic[SIKeyType, SortedType, SIValueType]):
    """Essentially, `dict[SIKeyType, list[tuple[SortedType, SIValueType]]]` with
       the `list` sorted by `SortedType`, with some uselful operations on top.
    """

    ideal : SortedType | None = _dc.field(default = None)
    _index : dict[SIKeyType, _abc.MutableSequence[tuple[SortedType, SIValueType]]] = _dc.field(default_factory = dict)
    _size : int = _dc.field(default = 0)

    def __len__(self) -> int:
        return self._size

    def insert(self, key : SIKeyType, order : SortedType, value : SIValueType) -> bool:
        """`self[key].insert_sorted((order, value))`, except when `self.ideal` init
           param is set, the `list` will only store the single `value` for
           which the `order` is closest to `self.ideal`.

           Returns `True` when the `value` was inserted and `False` otherwise.
        """

        iobjs = self._index.get(key, None)
        if iobjs is None:
            # first time seeing this `key`
            self._index[key] = SortedKeyList([(order, value)], key=_fst)
            self._size += 1
        elif self.ideal is not None:
            if nearer_to_than(self.ideal, order, iobjs[0][0]):
                iobjs.clear()
                iobjs.add((order, value)) # type: ignore
            else:
                return False
        else:
            iobjs.add((order, value)) # type: ignore
            self._size += 1
        return True

    def iter_from_to(self, key : SIKeyType, start : SortedType, end : SortedType) \
        -> _t.Iterator[tuple[SortedType, SIValueType]]:
        """Iterate `self[key]` `list` values from `start` (including) to `end` (not including).
        """

        try:
            iobjs = self._index[key]
        except KeyError:
            # unavailable
            return

        left = _bisect.bisect_left(iobjs, start, key=lambda x: x[0])
        for i in range(left, len(iobjs)):
            cur = iobjs[i]
            if start <= cur[0] < end: # type: ignore
                yield cur
            else:
                return

    def iter_from_nearest(self, key : SIKeyType, ideal : SortedType) \
        -> _t.Iterator[tuple[SortedType, SIValueType]]:
        """Iterate `self[key]` `list` values in order of closeness to `ideal`.
        """

        try:
            iobjs = self._index[key]
        except KeyError:
            # unavailable
            return

        ilen = len(iobjs)
        if ilen == 1:
            yield iobjs[0]
            return
        elif is_infinite(ideal):
            # oldest or latest
            yield from iter(iobjs) if ideal < 0 else reversed(iobjs)
            return
        #else: # nearest to `ideal`

        right = _bisect.bisect_right(iobjs, ideal, key=lambda x: x[0])
        if right == 0:
            yield from iter(iobjs)
            return
        elif right >= ilen:
            yield from reversed(iobjs)
            return

        # the complicated case, when `right` is in the middle somewhere
        left = right - 1
        if left >= 0 and right < ilen:
            ileft = iobjs[left]
            iright = iobjs[right]
            while True:
                if nearer_to_than(ideal, ileft[0], iright[0]):
                    yield ileft
                    left -= 1
                    if left >= 0:
                        ileft = iobjs[left]
                    else:
                        break
                else:
                    yield iright
                    right += 1
                    if right < ilen:
                        iright = iobjs[right]
                    else:
                        break

        # yield any leftovers
        if left < 0:
            for i in range(right, ilen):
                yield iobjs[i]
        elif right >= ilen:
            for i in range(left - 1, -1, -1):
                yield iobjs[i]

    def iter_nearest(self, key : SIKeyType, ideal : SortedType,
                     predicate : _t.Callable[[SortedType, SIValueType], bool] | None = None) \
                     -> _t.Iterator[tuple[SortedType, SIValueType]]:
        if predicate is None:
            yield from self.iter_from_nearest(key, ideal)
        else:
            for e in self.iter_from_nearest(key, ideal):
                if predicate(*e):
                    yield e

    def get_nearest(self, key : SIKeyType, ideal : SortedType,
                    predicate : _t.Callable[[SortedType, SIValueType], bool] | None = None) \
                    -> tuple[SortedType, SIValueType] | None:
        """Get the closest to `ideal` `self[key]` `list` value that also satisfies `predicate`.
        """
        for e in self.iter_nearest(key, ideal, predicate):
            return e
        return None
