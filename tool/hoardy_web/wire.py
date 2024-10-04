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

"""Parsing and un-parsing of URLs, HTTP headers, HTML attributes, etc."""

import re as _re
import typing as _t

from kisstdlib.exceptions import *

from .parser import *
from .url import *

### HTTP Headers

Headers = list[tuple[str, bytes]]

def get_raw_headers(headers : Headers, name : str) -> list[bytes]:
    return [v for k, v in headers if k.lower() == name]

def get_raw_header(headers : Headers, name : str, default : bytes | None = None) -> bytes | None:
    res = get_raw_headers(headers, name)
    if len(res) == 0:
        return default
    else:
        return res[-1]

def get_header(headers : Headers, name : str, default : str | None = None) -> str | None:
    res = get_raw_header(headers, name)
    if res is None:
        return default
    else:
        return res.decode("ascii")

### HTTP Header values parsing

token_ends = r'\s\t()\[\]<>@,:;\/?="'
token_body_re = _re.compile(rf'([^{token_ends}]+)')
attribute_ends = token_ends + r"*'%"
attribute_body_re = _re.compile(rf'([^{attribute_ends}]+)')
extended_attribute_ends = token_ends + r"*'"
extended_attribute_body_re = _re.compile(rf'([^{extended_attribute_ends}]+)')
qcontent_body_re = _re.compile(rf'([^"\\]*)')

def parse_lexeme(p : Parser, body_re : _re.Pattern[str]) -> str:
    p.opt_whitespace()
    grp = p.regex(body_re)
    p.opt_whitespace()
    return grp[0]

def parse_token(p : Parser) -> str:
    return parse_lexeme(p, token_body_re)

def parse_attribute(p : Parser) -> str:
    return parse_lexeme(p, attribute_body_re)

def parse_extended_attribute(p : Parser) -> str:
    return parse_lexeme(p, extended_attribute_body_re)

def parse_value(p : Parser, ends : list[str]) -> str:
    ws = p.opt_whitespace()
    if p.at_eof() or p.at_string_in(ends):
        raise ParseError("expected attribute value, got %s", repr(ws[0]))
    try:
        p.string('"')
    except ParseError:
        token = parse_extended_attribute(p)
    else:
        res = []
        while not p.at_string('"'):
            if p.at_string('\\'):
                res.append(p.buffer[1:2])
                p.buffer = p.buffer[2:]
            else:
                grp = p.regex(qcontent_body_re)
                res.append(grp[0])
        p.string('"')
        token = "".join(res)
    return ws[0] + token

def parse_parameter(p : Parser, ends : list[str]) -> tuple[str, str]:
    key = parse_attribute(p)
    try:
        p.string("=")
    except ParseError:
        value = ""
    else:
        value = parse_value(p, ends)
    return key, value

def parse_invalid_parameter(p : Parser, ends : list[str]) -> tuple[str, str]:
    key = p.take_until_string_in(ends)
    return key, ""

Parameters = list[tuple[str, str]]

def parse_mime_parameters(p : Parser, ends : list[str] = []) -> Parameters:
    ends = [";"] + ends
    res = []
    while p.at_string(";"):
        p.string(";")
        p.opt_whitespace()
        if p.at_string(";"):
            # empty parameter
            continue
        save = p.pos
        try:
            token = parse_parameter(p, ends)
        except ParseError:
            p.pos = save
            token = parse_invalid_parameter(p, ends)
        res.append(token)
    return res

def parse_content_type_header(value : str) -> tuple[str, str, Parameters]:
    """Parse HTTP `Content-Type` header."""
    p = Parser(value)
    try:
        maintype = parse_token(p)
        p.string("/")
        subtype = parse_token(p)
        p.opt_whitespace()
    except ParseError as err:
        maintype = "text"
        subtype = "plain"
        p.take_until_string(";")
    params = parse_mime_parameters(p)
    p.opt_whitespace()
    p.eof()
    return maintype, subtype, params

def scheck(v : _t.Any, what : str, value : _t.Any, expected : _t.Any) -> None:
    if value != expected:
        raise CatastrophicFailure("while evaluating %s of %s, expected %s, got %s", what, repr(v), repr(expected), repr(value))

def test_parse_content_type_header() -> None:
    def check(cts : list[str], expected_maintype : str, expected_subtype : str, expected_params : Parameters) -> None:
        for ct in cts:
            maintype, subtype, params = parse_content_type_header(ct)
            scheck(ct, "maintype", maintype, expected_maintype)
            scheck(ct, "subtype", subtype, expected_subtype)
            scheck(ct, "params", params, expected_params)

    check(["text/plain"], "text", "plain", [])
    check(["text/html"], "text", "html", [])
    check([
        "text/html;charset=utf-8",
        "text/html ;charset=utf-8",
        "text/html; charset=utf-8",
        'text/html; charset="utf-8"',
    ], "text", "html", [("charset", "utf-8")])
    check([
        "text/html;charset=utf-8;lang=en",
        "text/html; charset=utf-8; lang=en",
        'text/html; charset="utf-8"; lang=en',
    ], "text", "html", [("charset", "utf-8"), ("lang", "en")])
    check(['text/html; charset="utf-8"; %%; lang=en'], "text", "html", [("charset", "utf-8"), ("%%", ""), ("lang", "en")])
    # because RFC says invalid content types are to be interpreted as `text/plain`
    check(["bla; charset=utf-8; lang=en"], "text", "plain", [("charset", "utf-8"), ("lang", "en")])

### HTML attribute parsing

opt_srcset_condition = _re.compile(r"(?:\s+([0-9]+(?:\.[0-9]+)?[xw]))?")
opt_srcset_sep = _re.compile(r"(\s*,)?")

def parse_srcset_attr(value : str) -> list[tuple[str, str]]:
    """Parse HTML5 srcset attribute"""
    res = []
    p = Parser(value)
    p.opt_whitespace()
    while not p.at_eof():
        grp = p.regex(url_re)
        if grp[1].endswith(","):
            url = grp[1][:-1]
            p.unread(",")
        else:
            url = grp[1]
        grp = p.opt_regex(opt_srcset_condition)
        cond = grp[0]
        p.opt_whitespace()
        p.opt_regex(opt_srcset_sep)
        p.opt_whitespace()
        if url != "":
            res.append((url, cond))
        #else: ignore it
    p.eof()
    return res

def unparse_srcset_attr(value : list[tuple[str, str]]) -> str:
    """Unparse HTML5 srcset attribute"""
    return ", ".join([(f"{url} {cond}" if cond is not None else url) for url, cond in value])

def test_parse_srcset_attr() -> None:
    def check(attr : str, expected_values : _t.Any) -> None:
        values = parse_srcset_attr(attr)
        for i in range(0, len(expected_values)):
            url, cond = values[i]
            expected_url, expected_cond = expected_values[i]
            scheck(attr, "url", url, expected_url)
            scheck(attr, "cond", cond, expected_cond)
        scheck(attr, "the whole", values, expected_values)

    check("https://example.org", [
        ("https://example.org", None),
    ])
    check("https://example.org/1.jpg, https://example.org/2.jpg", [
        ("https://example.org/1.jpg", None),
        ("https://example.org/2.jpg", None),
    ])
    check("https://example.org/1.jpg 2.5x, https://example.org/2.jpg", [
        ("https://example.org/1.jpg", "2.5x"),
        ("https://example.org/2.jpg", None),
    ])
    check("""
        https://example.org/1.jpg    2.5x
        ,
        https://example.org/2.jpg
    """, [
        ("https://example.org/1.jpg", "2.5x"),
        ("https://example.org/2.jpg", None),
    ])
