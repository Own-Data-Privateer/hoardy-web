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

class ParseError(Failure, ValueError):
    pass

ParsedValueType = _t.TypeVar("ParsedValueType")
ParserParamSpec = _t.ParamSpec("ParserParamSpec")

class Parser:
    """Parser combinator with regexes."""

    def __init__(self, data : str) -> None:
        self.buffer = data
        self.pos = 0

    def unread(self, data : str) -> None:
        self.buffer = self.buffer[:self.pos] + data + self.buffer[self.pos:]

    @property
    def leftovers(self) -> str:
        return self.buffer[self.pos:]

    def at_eof(self) -> bool:
        return self.pos >= len(self.buffer)

    def eof(self) -> None:
        if self.at_eof():
            return
        raise ParseError("while parsing %s: expected EOF, got %s", repr(self.buffer), repr(self.leftovers))

    def chomp(self,
              parser : _t.Callable[_t.Concatenate[str, ParserParamSpec],
                                   tuple[ParsedValueType, str]],
              *args : ParserParamSpec.args, **kwargs : ParserParamSpec.kwargs) \
              -> ParsedValueType:
        if self.pos == 0:
            res, leftovers = parser(self.buffer, *args, **kwargs)
        else:
            res, leftovers = parser(self.buffer[self.pos:], *args, **kwargs)
            self.pos = 0
        self.buffer = leftovers
        return res

    def have_at_least(self, n : int) -> bool:
        return self.pos + n <= len(self.buffer)

    def ensure_have(self, n : int) -> None:
        if self.have_at_least(n):
            return
        raise ParseError("while parsing %s: expected %d more characters, got EOF", repr(self.buffer), n)

    def skip(self, n : int) -> None:
        self.ensure_have(n)
        self.pos += n

    def take(self, n : int) -> str:
        self.ensure_have(n)
        old_pos = self.pos
        new_pos = old_pos + n
        self.pos = new_pos
        return self.buffer[old_pos:new_pos]

    def at_string(self, s : str) -> bool:
        return self.buffer.startswith(s, self.pos)

    def opt_string(self, s : str) -> bool:
        if self.at_string(s):
            self.pos += len(s)
            return True
        return False

    def string(self, s : str) -> None:
        if self.opt_string(s):
            return
        raise ParseError("while parsing %s: expected %s, got %s", repr(self.buffer), repr(s), repr(self.leftovers))

    def at_string_in(self, ss : list[str]) -> bool:
        for s in ss:
            if self.buffer.startswith(s, self.pos):
                return True
        return False

    def opt_string_in(self, ss : list[str]) -> bool:
        for s in ss:
            if self.at_string(s):
                self.pos += len(s)
                return True
        return False

    def string_in(self, ss : list[str]) -> None:
        if self.opt_string_in(ss):
            return
        raise ParseError("while parsing %s: expected one of %s, got %s", repr(self.buffer), repr(ss), repr(self.leftovers))

    def take_until_p(self, p : _t.Callable[[_t.Any], bool]) -> str:
        start = self.pos
        blen = len(self.buffer)
        while self.pos < blen:
            if p(self):
                break
            self.pos += 1
        return self.buffer[start:self.pos]

    def take_until_string(self, s : str) -> str:
        return self.take_until_p(lambda p: p.at_string(s))

    def take_until_string_in(self, ss : list[str]) -> str:
        return self.take_until_p(lambda p: p.at_string_in(ss))

    def at_regex(self, regexp : _re.Pattern[str]) -> bool:
        m = regexp.match(self.buffer, self.pos)
        return m is not None

    def regex(self, regexp : _re.Pattern[str], allow_empty : bool = False) -> tuple[str | _t.Any, ...]:
        m = regexp.match(self.buffer, self.pos)
        if m is None:
            raise ParseError("while parsing %s: expected %s, got %s", repr(self.buffer), repr(regexp), repr(self.leftovers))
        pos = m.span()[1]
        if pos == self.pos and not allow_empty:
            raise ParseError("while parsing %s: matched nothing via %s, buffer is %s", repr(self.buffer), repr(regexp), repr(self.leftovers))
        self.pos = pos
        return m.groups()

    def opt_regex(self, regexp : _re.Pattern[str]) -> tuple[str | _t.Any, ...]:
        return self.regex(regexp, True)

    def opt_whitespace(self) -> tuple[str | _t.Any, ...]:
        return self.opt_regex(opt_whitespace_re)

    def lexeme(self, body_re : _re.Pattern[str]) -> str:
        self.opt_whitespace()
        grp = self.regex(body_re)
        self.opt_whitespace()
        return grp[0]
