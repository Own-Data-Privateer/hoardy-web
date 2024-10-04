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

import email._header_value_parser as _emlhp
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

Parameters = list[tuple[str, str]]

def parse_content_type_header(value : str) -> tuple[str, str, Parameters]:
    pct = _emlhp.parse_content_type_header(value)
    return pct.maintype, pct.subtype, list(pct.params)

def test_parse_content_type_header() -> None:
    def check(ct : str, expected_maintype : str, expected_subtype : str, expected_params : Parameters) -> None:
        def scheck(what : str, value : _t.Any, expected : _t.Any) -> None:
            if value != expected:
                raise CatastrophicFailure("while evaluating %s of %s, expected %s, got %s", what, repr(ct), repr(expected), repr(value))
        maintype, subtype, params = parse_content_type_header(ct)
        scheck("maintype", maintype, expected_maintype)
        scheck("subtype", subtype, expected_subtype)
        scheck("params", params, expected_params)

    check("text/plain", "text", "plain", [])
    check("text/html", "text", "html", [])
    check("text/html;charset=utf-8", "text", "html", [("charset", "utf-8")])
    check("text/html; charset=utf-8", "text", "html", [("charset", "utf-8")])
    check('text/html; charset="utf-8"', "text", "html", [("charset", "utf-8")])
    check("text/html;charset=utf-8;lang=en", "text", "html", [("charset", "utf-8"), ("lang", "en")])
    check("text/html; charset=utf-8; lang=en", "text", "html", [("charset", "utf-8"), ("lang", "en")])
    check('text/html; charset="utf-8"; lang=en', "text", "html", [("charset", "utf-8"), ("lang", "en")])
    # because RFC says invalid content types are to be interpreted as `text/plain`
    check("bla; charset=utf-8; lang=en", "text", "plain", [("charset", "utf-8"), ("lang", "en")])

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
        def scheck(what : str, value : _t.Any, expected : _t.Any) -> None:
            if value != expected:
                raise CatastrophicFailure("while evaluating %s of %s, expected %s, got %s", what, repr(attr), repr(expected), repr(value))

        values = parse_srcset_attr(attr)
        for i in range(0, len(expected_values)):
            url, cond = values[i]
            expected_url, expected_cond = expected_values[i]
            scheck("url", url, expected_url)
            scheck("cond", cond, expected_cond)

        scheck("the whole", values, expected_values)

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
