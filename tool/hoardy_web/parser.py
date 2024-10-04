# Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
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

"""Parsec-like parser combinator, but using regexes lots.
"""

import re as _re
import typing as _t

from kisstdlib.exceptions import *

word_re = _re.compile(r"(\S+)")
natural_re = _re.compile(r"([0-9]+)")
integer_re = _re.compile(r"(-?[0-9]+)")
decimal_re = _re.compile(r"(-?[0-9]+(.[0-9]+)?)")
opt_whitespace_re = _re.compile(r"(\s*)")

class ParseError(Failure):
    pass

class Parser:
    """Parser combinator with regexes."""

    def __init__(self, data : str) -> None:
        self._buffer = data

    def unread(self, data : str) -> None:
        self._buffer = data + self._buffer

    def is_eof(self) -> bool:
        return len(self._buffer) == 0

    def eof(self) -> None:
        if len(self._buffer) != 0:
            raise ParseError("expected EOF, got %s", repr(self._buffer[0]))

    def regex(self, regexp : _re.Pattern[str], allow_empty : bool = False) -> tuple[str | _t.Any, ...]:
        m = regexp.match(self._buffer)
        if m is None:
            raise ParseError("failed to advance via %s, buffer is %s", regexp, repr(self._buffer))
        pos = m.span()[1]
        if pos == 0:
            if not allow_empty:
                raise ParseError("matched nothing via %s, buffer is %s", regexp, repr(self._buffer))
        else:
            self._buffer = self._buffer[pos:]
        return m.groups()

    def opt_regex(self, regexp : _re.Pattern[str]) -> tuple[str | _t.Any, ...]:
        return self.regex(regexp, True)
