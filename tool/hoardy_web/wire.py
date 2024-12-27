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

import base64 as _base64
import dataclasses as _dc
import idna as _idna
import logging as _logging
import os as _os
import re as _re
import typing as _t
import urllib.parse as _up

from kisstdlib.exceptions import *

from .parser import *

def scheck(v : _t.Any, what : str, value : _t.Any, expected : _t.Any) -> None:
    if value != expected:
        raise CatastrophicFailure("while evaluating %s of %s, expected %s, got %s", what, repr(v), repr(expected), repr(value))

### Escaping stuff

_miniquoters : dict[str, dict[str, str]] = {}

def miniquote(x : str, blacklist : str) -> str:
    """Like `urllib.parse.quote`, with a blacklist instead of whitelist."""
    miniquoter : dict[str, str]
    try:
        miniquoter = _miniquoters[blacklist]
    except KeyError:
        # build a dictionary from characters to their quotes
        miniquoter = {}
        for b in range(0, 32):
            miniquoter[chr(b)] = "%{:02X}".format(b)
        for c in "%" + blacklist:
            miniquoter[c] = "%{:02X}".format(ord(c))
        _miniquoters[blacklist] = miniquoter

    return "".join([miniquoter.get(c, c) for c in x])

def miniescape(x : str, blacklist : str) -> str:
    res = []
    for c in x:
        if c in blacklist:
            res.append("\\" + c)
        else:
            res.append(c)
    return "".join(res)

### URL parsing

# URL double-slash scheme
uds_str       = r"http|https|ftp|ftps"
# URL auth
uauth_str     = r"\S+(?::\S*)?"
# URL hostname
def uhostname_str(d : str) -> str:
    return rf"[^:/?#\s{d}]+"
# URL port
uport_str     = r":\d+"
# URL path
def upath_str(d : str) -> str:
    return rf"/[^?#\s{d}]*"
# URL relative path
def urel_str(d : str) -> str:
    return rf"[^?#\s{d}]+"
# URL query
def uquery_str(d : str) -> str:
    return rf"[^#\s{d}]*"
# URL fragment/hash
def ufragment_str(d : str) -> str:
    return rf"[^\s{d}]*"

# Regexp describing a URL, the second case is for common malformed path-less
# URLs like "https://example.com" (which should actually be given as
# "https://example.com/", but this is almost a universal mistake). The order
# of cases matters, since `_re.match` and co are greedy.
def url_re_str(d : str) -> str:
    return rf"""(
(
(?:(?:{uds_str}):)?
//
(?:{uauth_str}@)?
(?:{uhostname_str(d)})
(?:{uport_str})?
(?:{upath_str(d)})
|
(?:(?:{uds_str}):)?
//
(?:{uauth_str}@)?
(?:{uhostname_str(d)})
(?:{uport_str})?
|
(?:{upath_str(d)})
|
(?:{urel_str(d)})
)
(\?{uquery_str(d)})?
(#{ufragment_str(d)})?
)""".replace("\n", "")

#print(url_re_str(""))

url_re = _re.compile(url_re_str(""))

def parse_path(path : str, encoding : str = "utf-8", errors : str = "replace") -> list[str]:
    return [_up.unquote(e, encoding=encoding, errors=errors) for e in path.split("/")]

def unparse_path(path_parts : _t.Sequence[str], encoding : str = "utf-8", errors : str = "strict") -> str:
    return "/".join(map(lambda p: _up.quote(p, ":", encoding=encoding, errors=errors), path_parts))

def parse_query(query : str, encoding : str = "utf-8", errors : str = "replace") -> list[tuple[str, str | None]]:
    """Like `urllib.parse.parse_qsl`, but "a=" still parses into ("a", "") while
       just "a" parses into ("a", None). I.e. this keeps information about
       whether "=" was present.
    """
    parts = [s2 for s1 in query.split('&') for s2 in s1.split(';')]
    res : list[tuple[str, str | None]] = []
    for e in parts:
        eqp = e.find("=")
        if eqp == -1:
            name = _up.unquote_plus(e, encoding=encoding, errors=errors)
            res.append((name, None))
            continue
        n, v = e[:eqp], e[eqp+1:]
        name = _up.unquote_plus(n, encoding=encoding, errors=errors)
        value = _up.unquote_plus(v, encoding=encoding, errors=errors)
        res.append((name, value))
    return res

def unparse_query(qsl : _t.Sequence[tuple[str, str | None]], encoding : str = "utf-8", errors : str = "strict") -> str:
    """Like `urllib.parse.urlencode`, turns URL query components list back into a
       query, except works with our `parse_query`.
    """
    l = []
    for k, v in qsl:
        k = _up.quote_plus(k, encoding=encoding, errors=errors)
        if v is None:
            l.append(k)
        else:
            v = _up.quote_plus(v, encoding=encoding, errors=errors)
            l.append(k + "=" + v)
    return "&".join(l)

def pp_to_path(parts : list[str]) -> str:
    """Turn URL path components list into a minimally-quoted path."""
    return "/".join([miniquote(e, "/?") for e in parts])

def qsl_to_path(qsl : _t.Sequence[tuple[str, str | None]]) -> str:
    """Turn URL query components list into a minimally-quoted path."""
    l = []
    for k, v in qsl:
        k = miniquote(k, "/&=")
        if v is None:
            l.append(k)
        else:
            v = miniquote(v, "/&")
            l.append(k + "=" + v)
    return "&".join(l)

@_dc.dataclass
class ParsedURL:
    raw_url : str
    scheme : str
    user : str
    password : str
    brackets : bool
    raw_hostname : str
    net_hostname : str
    hostname : str
    opm : str
    port : str
    raw_path : str
    oqm : str
    raw_query : str
    ofm : str
    fragment : str

    @property
    def net_auth(self) -> str:
        if self.user != "":
            if self.password != "":
                return f"{self.user}:{self.password}@"
            else:
                return f"{self.user}@"
        else:
            return ""

    @property
    def rhostname(self) -> str:
        hparts = self.hostname.split(".")
        hparts.reverse()
        return ".".join(hparts)

    @property
    def netloc(self) -> str:
        hn = self.hostname
        if self.brackets: hn = "[" + hn + "]"
        return "".join([self.net_auth, hn, self.opm, self.port])

    @property
    def net_netloc(self) -> str:
        hn = self.net_hostname
        if self.brackets: hn = "[" + hn + "]"
        return "".join([self.net_auth, hn, self.opm, self.port])

    @property
    def path_parts(self) -> list[str]:
        return parse_path(self.raw_path)

    @property
    def path(self) -> str:
        return unparse_path(self.path_parts)

    @property
    def query_parts(self) -> list[tuple[str, str | None]]:
        return parse_query(self.raw_query)

    @property
    def query(self) -> str:
        return unparse_query(self.query_parts)

    @property
    def net_url(self) -> str:
        path = self.path
        if self.raw_hostname:
            nl = self.net_netloc
            if nl != "": nl = "//" + nl
            slash = "/" if path == "" else ""
            return _up.quote(f"{self.scheme}:{nl}{path}{slash}{self.oqm}{self.query}", safe="%/:=&?~#+!$,;'@()*[]|")
        else:
            return _up.quote(f"{self.scheme}:{path}{self.oqm}{self.query}", safe="%/:=&?~#+!$,;'@()*[]|")

    @property
    def url(self) -> str:
        return f"{self.net_url}{self.ofm}{self.fragment}"

    @property
    def npath_parts(self) -> list[str]:
        parts_insecure = [e for e in self.path_parts if e != ""]

        # remove dots and securely interpret double dots
        parts : list[str] = []
        for e in parts_insecure:
            if e == ".":
                continue
            elif e == "..":
                if len(parts) > 0:
                    parts.pop()
                continue
            parts.append(e)
        return parts

    def filepath_parts_ext(self, default : str, extensions : list[str]) -> tuple[list[str], str]:
        parts = self.npath_parts
        if len(parts) == 0 or self.raw_path.endswith("/"):
            return parts + [default], extensions[0] if len(extensions) > 0 else ".data"

        last = parts[-1].lower()
        last_name, last_ext = _os.path.splitext(last)
        if last_ext == "":
            return parts + [default], extensions[0] if len(extensions) > 0 else ".data"
        elif last_ext in extensions:
            return parts[:-1] + [last_name], last_ext
        elif len(extensions) > 0:
            return parts[:-1] + [last], extensions[0]
        elif last_ext == ".data":
            return parts[:-1] + [last_name], ".data"
        else:
            return parts[:-1] + [last], ".data"

    @property
    def query_nparts(self) -> list[tuple[str, str]]:
        res : list[tuple[str, str]] = []
        for e in self.query_parts:
            x = e[1]
            if x is not None and x != "":
                res.append(e) # type: ignore
        return res

    @property
    def mq_path(self) -> str:
        return pp_to_path(self.path_parts)

    @property
    def mq_npath(self) -> str:
        return pp_to_path(self.npath_parts)

    @property
    def mq_query(self) -> str:
        return qsl_to_path(self.query_parts)

    @property
    def mq_nquery(self) -> str:
        return qsl_to_path(self.query_nparts)

    @property
    def pretty_net_url(self) -> str:
        if self.raw_hostname:
            nl = self.netloc
            if nl != "": nl = "//" + nl
            slash = "/" if self.raw_path == "" else ""
            return f"{self.scheme}:{nl}{self.mq_path}{slash}{self.oqm}{self.mq_query}"
        else:
            return f"{self.scheme}:{self.mq_path}{self.oqm}{self.mq_query}"

    @property
    def pretty_url(self) -> str:
        return f"{self.pretty_net_url}{self.ofm}{self.fragment}"

    @property
    def pretty_net_nurl(self) -> str:
        mq_npath = self.mq_npath
        if self.raw_hostname:
            nl = self.netloc
            if nl != "": nl = "//" + nl
            slash = "/" if self.raw_path.endswith("/") and len(mq_npath) > 0 else ""
            return f"{self.scheme}:{nl}/{mq_npath}{slash}{self.oqm}{self.mq_nquery}"
        else:
            slash = "/" if self.raw_path.endswith("/") else ""
            return f"{self.scheme}:{mq_npath}{slash}{self.oqm}{self.mq_nquery}"

    @property
    def pretty_nurl(self) -> str:
        return f"{self.pretty_net_nurl}{self.ofm}{self.fragment}"

class URLParsingError(ValueError): pass

def parse_url(url : str) -> ParsedURL:
    try:
        scheme, netloc, path, query, fragment = _up.urlsplit(url)
    except Exception:
        raise URLParsingError(url)

    userinfo, has_user, hostinfo = netloc.rpartition("@")
    if has_user:
        user , _, password = userinfo.partition(":")
        user = _up.quote(_up.unquote(user), safe="")
        password = _up.quote(_up.unquote(password), safe="")
    else:
        user = ""
        password = ""
    if hostinfo.startswith("["):
        brackets = True
        raw_hostname, has_endbracket, port = hostinfo[1:].partition("]")
        if not has_endbracket or port != "" and not port.startswith(":"):
            raise URLParsingError(url)
        opm = ":"
        port = port[1:]
    else:
        brackets = False
        raw_hostname, opm, port = hostinfo.partition(":")

    if raw_hostname == "":
        net_hostname = hostname = ""
    else:
        # Fix common issues by rewriting hostnames like browsers do
        ehostname = _up.unquote(raw_hostname).strip().replace("_", "-")

        # Yes, this is a bit weird. `_idna.encode` and `_idna.decode` are not bijective.
        # So, we turn `raw_hostname` into unicode `str` first.
        try:
            dehostname = _idna.decode(ehostname, uts46=True)
        except _idna.IDNAError as err:
            if ehostname[2:4] == "--":
                _logging.warning("`parse_url` left `net_hostname` and related attrs of `%s` undecoded because `idna` module failed to decode `%s`: %s", url, ehostname, repr(err))
                net_hostname = hostname = ehostname
            else:
                raise URLParsingError(url)
        else:
            try:
                # Then encode it with uts46 enabled.
                net_hostname = _idna.encode(dehostname, uts46=True).decode("ascii")
                # And then decode it again to get the canonical unicode hostname for which
                # encoding and decoding will be bijective
                hostname = _idna.decode(net_hostname)
            except _idna.IDNAError:
                raise URLParsingError(url)

    oqm = "?" if query != "" or (query == "" and url.endswith("?")) else ""
    ofm = "#" if fragment != "" or (fragment == "" and url.endswith("#")) else ""
    return ParsedURL(url, scheme, user, password,
                     brackets, raw_hostname, net_hostname, hostname,
                     opm, port,
                     path, oqm, query, ofm, fragment)

def test_parse_url() -> None:
    def check(x : ParsedURL, name : str, value : _t.Any) -> None:
        if getattr(x, name) != value:
            raise CatastrophicFailure("while evaluating %s of %s, expected %s, got %s", name, x.raw_url, value, getattr(x, name))

    example_org = [
        "http://example.org/",
        "http://example.org/",
        "http://example.org/",
        "http://example.org/",
        "http://example.org/",
        "http://example.org/",
    ]

    example_org_hash = [
        "http://example.org/",
        "http://example.org/#hash",
        "http://example.org/#hash",
        "http://example.org/",
        "http://example.org/#hash",
        "http://example.org/",
    ]

    tests1 : list[list[str]]
    tests1 = [
        ["http://example.org"] + example_org,
        ["http://example.org/"] + example_org,

        ["http://example.org#hash"] + example_org_hash,
        ["http://example.org/#hash"] + example_org_hash,

        # work-around for common typos
        ["http://%20example.org"] + example_org,
        ["http://%20example.org/"] + example_org,

        ["http://example.org/one+two#hash",
         "http://example.org/one%2Btwo",
         "http://example.org/one%2Btwo#hash",
         "http://example.org/one+two#hash",
         "http://example.org/one+two",
         "http://example.org/one+two#hash",
         "http://example.org/one+two"],

        ["http://example.org/web/2/http://archived.example.org/one+two#hash",
         "http://example.org/web/2/http://archived.example.org/one%2Btwo",
         "http://example.org/web/2/http://archived.example.org/one%2Btwo#hash",
         "http://example.org/web/2/http://archived.example.org/one+two#hash",
         "http://example.org/web/2/http://archived.example.org/one+two",
         "http://example.org/web/2/http:/archived.example.org/one+two#hash",
         "http://example.org/web/2/http:/archived.example.org/one+two"],
    ]

    for raw_url, net_url, url, purl, pnet_url, pnurl, pnet_nurl in tests1:
        x = parse_url(raw_url)
        check(x, "raw_url", raw_url)
        check(x, "net_url", net_url)
        check(x, "url", url)
        check(x, "pretty_net_url", pnet_url)
        check(x, "pretty_url", purl)
        check(x, "pretty_net_nurl", pnet_nurl)
        check(x, "pretty_nurl", pnurl)

    tests2 : list[list[str| None]]
    tests2 = [
        ["http://example.org/", None],
        ["http://example.org/test", None],
        ["http://example.org/test/", None],
        ["http://example.org/unfinished/query?", None],

        ["http://example.org/unfinished/query?param",
         "http://example.org/unfinished/query?"],

        ["http://example.org/unfinished/query?param=",
         "http://example.org/unfinished/query?"],

        ["http://example.org/unfinished/query?param=0", None],
        ["http://example.org/unfinished/query?param=0&param=1", None],

        ["http://example.org/web/2/https://archived.example.org",
         "http://example.org/web/2/https:/archived.example.org"],

        ["http://example.org/web/2/https://archived.example.org/",
         "http://example.org/web/2/https:/archived.example.org/"],

        ["http://example.org/web/2/https://archived.example.org/test",
         "http://example.org/web/2/https:/archived.example.org/test"],

        ["http://example.org/web/2/https://archived.example.org/test/",
         "http://example.org/web/2/https:/archived.example.org/test/"],

        ["http://example.org/web/2/https://archived.example.org/unfinished/query?",
         "http://example.org/web/2/https:/archived.example.org/unfinished/query?"],

        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param",
         "http://example.org/web/2/https:/archived.example.org/unfinished/query?"],

        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param=",
         "http://example.org/web/2/https:/archived.example.org/unfinished/query?"],

        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param=0",
         "http://example.org/web/2/https:/archived.example.org/unfinished/query?param=0"],

        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param=0&param=",
         "http://example.org/web/2/https:/archived.example.org/unfinished/query?param=0"],

        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param=0&param=1",
         "http://example.org/web/2/https:/archived.example.org/unfinished/query?param=0&param=1"],

        # work-arounds for hostnames that `idna` module fails to parse
        ["http://ab-cd-xxxxxxxxx-yyyy.example.org/", None],
        ["http://ab--cd-xxxxxxxxx-yyyy.example.org/", None],
        ["http://ab---cd-xxxxxxxxx-yyyy.example.org/", None],
    ]

    for murl, xurl in tests2:
        assert murl is not None
        url = murl
        x = parse_url(url)
        check(x, "raw_url", url)
        check(x, "net_url", url)
        check(x, "url", url)
        check(x, "pretty_net_url", url)
        check(x, "pretty_url", url)

        nurl = xurl if xurl is not None else url
        check(x, "pretty_net_nurl", nurl)
        check(x, "pretty_nurl", nurl)

### MIME valuess

Parameters = list[tuple[str, str]]

ParamValueDefaultType = _t.TypeVar("ParamValueDefaultType", str, None)
def get_parameter_value(ps : Parameters, name : str, default : ParamValueDefaultType) -> str | ParamValueDefaultType:
    for n, v in ps:
        if n == name:
            return v
    return default

def set_parameter(ps : Parameters, name : str, value : str) -> Parameters:
    res = []
    not_done = True
    for n, v in ps:
        if n == name:
            if not_done:
                res.append((name, value))
                not_done = False
            continue
        res.append((n, v))
    if not_done:
        res.append((name, value))
    return res

token_ends = r'\s\t()\[\]<>@,:;\/?="'
token_body_re = _re.compile(rf'([^{token_ends}]+)')

def parse_token(p : Parser) -> str:
    return p.lexeme(token_body_re)

def parse_mime_type(p : Parser, ends : list[str] = []) -> str:
    ends = [";"] + ends
    try:
        maintype = parse_token(p)
        p.string("/")
        subtype = parse_token(p)
        p.opt_whitespace()
        return maintype + "/" + subtype
    except ParseError as err:
        p.take_until_string_in(ends)
        # RFC says invalid content types are to be interpreted as `text/plain`
        return "text/plain"

attribute_ends = token_ends + "*'%"
attribute_body_re = _re.compile(rf'([^{attribute_ends}]+)')

def parse_attribute(p : Parser) -> str:
    return p.lexeme(attribute_body_re)

extended_attribute_ends = token_ends + "*'"
extended_attribute_body_re = _re.compile(rf'([^{extended_attribute_ends}]+)')

def parse_extended_attribute(p : Parser) -> str:
    return p.lexeme(extended_attribute_body_re)

qcontent_body_re = _re.compile(rf'([^"\\]*)')
qcontent_ends_str = '"\\'

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
                p.skip(1)
                res.append(p.take(1))
            else:
                grp = p.regex(qcontent_body_re)
                res.append(grp[0])
        p.string('"')
        p.opt_whitespace()
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
    return key.rstrip(), ""

def parse_mime_parameters(p : Parser, ends : list[str] = []) -> Parameters:
    ends = [";"] + ends
    res = []
    while p.at_string(";"):
        p.skip(1)
        p.opt_whitespace()
        if p.at_eof() or p.at_string_in(ends):
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

def unparse_mime_parameters(params : Parameters) -> str:
    return "".join(map(lambda v: "; " + v[0] + '="' + v[1].replace('"', '\\"') + '"', params))

### `data:` URLs

def parse_data_url(value : str) -> tuple[str, Parameters, bytes]:
    p = Parser(value)
    p.string("data:")
    if p.at_string(","):
        # MDN says:
        # > If omitted, defaults to `text/plain;charset=US-ASCII`
        mime_type = "text/plain"
        params = [("charset", "US-ASCII")]
    else:
        mime_type = parse_mime_type(p, [","])
        params = parse_mime_parameters(p, [","])
    p.string(",")

    base64 = False
    if len(params) > 0 and params[-1][0] == "base64":
        params = params[:-1]
        base64 = True

    data : str | bytes
    if base64:
        data = _base64.b64decode(p.leftovers)
    else:
        data = _up.unquote_to_bytes(p.leftovers)
    return mime_type, params, data

def unparse_data_url(mime_type : str, params : Parameters, data : bytes) -> str:
    res = [
        "data:",
        mime_type,
    ]
    for n, v in params:
        res.append(";")
        res.append(n)
        if len(v) == 0:
            continue
        res.append('="')
        res.append(miniescape(v, qcontent_ends_str))
        res.append('"')
    res += [
        ";base64,",
        _base64.b64encode(data).decode("ascii"),
    ]
    return "".join(res)

def test_parse_data_url() -> None:
    def check(values : list[str], expected_mime_type : str, expected_params : Parameters, expected_data : bytes) -> None:
        for value in values:
            mime_type, params, data = parse_data_url(value)
            scheck(value, "mime_type", mime_type, expected_mime_type)
            scheck(value, "params", params, expected_params)
            scheck(value, "data", data, expected_data)

    check(["data:,Hello%2C%20World%21",], "text/plain", [("charset", "US-ASCII")], b"Hello, World!")
    check(["data:text/plain,Hello%2C%20World%21"], "text/plain", [], b"Hello, World!")
    check([
        "data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==",
        "data:text/plain; base64,SGVsbG8sIFdvcmxkIQ==",
        "data:text/plain; base64 ,SGVsbG8sIFdvcmxkIQ==",
    ], "text/plain", [], b"Hello, World!")
    check([
        "data:text/plain;charset=UTF-8;base64,SGVsbG8sIFdvcmxkIQ==",
        "data:text/plain; charset=UTF-8;base64,SGVsbG8sIFdvcmxkIQ==",
        "data:text/plain; charset=UTF-8 ;base64,SGVsbG8sIFdvcmxkIQ==",
    ], "text/plain", [("charset", "UTF-8")], b"Hello, World!")
    # because RFC says invalid content types are to be interpreted as `text/plain`
    check([
        "data: ,Hello%2C%20World%21",
        "data:bla,Hello%2C%20World%21",
    ], "text/plain", [], b"Hello, World!")

def test_unparse_data_url() -> None:
    def check(value : str, *args : _t.Any) -> None:
        res = unparse_data_url(*args)
        scheck(args, "unparse", value, res)
        back = parse_data_url(res)
        scheck(value, "re-parse", back, args)

    check('data:text/plain;base64,', "text/plain", [], b"")
    check('data:text/html;base64,TllB', "text/html", [], b"NYA")
    check('data:text/plain;charset="utf-8";base64,QUJD', "text/plain", [("charset", "utf-8")], b"ABC")
    check('data:text/plain;charset="US-ASCII";token="\\"";token="\'A";base64,ZGF0YQ==', "text/plain", [("charset", 'US-ASCII'), ("token", '"'), ("token", "'A")], b"data")

### HTTP Headers

Headers = list[tuple[str, bytes]]

def get_raw_headers(headers : Headers) -> list[tuple[str, bytes]]:
    # split because browsers frequently squish headers together
    return [(k, e) for k, v in headers for e in v.split(b"\n")]

def get_headers(headers : Headers) -> list[tuple[str, str]]:
    return [(k, v.decode("ascii")) for k, v in get_raw_headers(headers)]

def get_raw_headers_bytes(headers : Headers) -> list[bytes]:
    return [k.encode("ascii") + b": " + v for k, v in get_raw_headers(headers)]

def get_raw_header_values(headers : Headers, name : str) -> list[bytes]:
    # similarly
    return [e for k, v in headers if k.lower() == name for e in v.split(b"\n")]

def get_header_values(headers : Headers, name : str) -> list[str]:
    return [v.decode("ascii") for v in get_raw_header_values(headers,name)]

HeaderValueDefaultType = _t.TypeVar("HeaderValueDefaultType", str, None)
def get_header_value(headers : Headers, name : str, default : HeaderValueDefaultType) -> str | HeaderValueDefaultType:
    res = get_header_values(headers, name)
    if len(res) == 0:
        return default
    else:
        return res[0]

def parse_content_type_header(value : str) -> tuple[str, Parameters]:
    """Parse HTTP `Content-Type` header."""
    p = Parser(value)
    mime_type = parse_mime_type(p)
    params = parse_mime_parameters(p)
    p.opt_whitespace()
    p.eof()
    return mime_type, params

def test_parse_content_type_header() -> None:
    def check(cts : list[str], expected_mime_type : str, expected_params : Parameters) -> None:
        for ct in cts:
            mime_type, params = parse_content_type_header(ct)
            scheck(ct, "mime_type", mime_type, expected_mime_type)
            scheck(ct, "params", params, expected_params)

    check(["text/plain"], "text/plain", [])
    check(["text/html"], "text/html", [])
    check([
        "text/html;charset=utf-8",
        "text/html ;charset=utf-8",
        "text/html; charset=utf-8",
        'text/html; charset="utf-8"',
        'text/html; charset="utf-8";',
        'text/html;; charset="utf-8";; ',
        'text/html; ; charset="utf-8"; ; ',
    ], "text/html", [("charset", "utf-8")])
    check([
        "text/html;charset=utf-8;lang=en",
        "text/html; charset=utf-8; lang=en",
        'text/html; charset="utf-8"; lang=en',
        'text/html; charset="utf-8"; lang=en;',
        'text/html;; charset="utf-8"; lang=en;; ',
        'text/html; ; charset="utf-8"; lang=en; ; ',
    ], "text/html", [("charset", "utf-8"), ("lang", "en")])
    check([
        'text/html;charset="\\"utf-8\\"";lang=en',
        'text/html; charset="\\"utf-8\\""; lang=en',
    ], "text/html", [("charset", '"utf-8"'), ("lang", "en")])
    check([
        'text/html; charset="utf-8"; %%; lang=en',
        'text/html; charset="utf-8"; %% ; lang=en',
    ], "text/html", [("charset", "utf-8"), ("%%", ""), ("lang", "en")])
    # because RFC says invalid content types are to be interpreted as `text/plain`
    check(["bla; charset=utf-8; lang=en"], "text/plain", [("charset", "utf-8"), ("lang", "en")])

link_url_re = _re.compile(url_re_str("<>"))

def parse_link_value(p : Parser) -> tuple[str, Parameters]:
    """Parse single sub-value of HTTP `Link` header.
    """
    p.string("<")
    p.opt_whitespace()
    grp = p.regex(link_url_re)
    p.opt_whitespace()
    p.string(">")
    p.opt_whitespace()
    params = parse_mime_parameters(p, [","])
    return grp[0], params

ParsedLinkHeader = list[tuple[str, Parameters]]

def parse_link_header(value : str) -> ParsedLinkHeader:
    """Parse HTTP `Link` header."""
    p = Parser(value)
    res = []
    p.opt_whitespace()
    token = parse_link_value(p)
    res.append(token)
    while p.at_string(","):
        p.skip(1)
        p.opt_whitespace()
        if p.at_eof() or p.at_string(","):
            # empty link value
            continue
        token = parse_link_value(p)
        res.append(token)
    return res

def unparse_link_header(links : ParsedLinkHeader) -> str:
    return ", ".join(map(lambda v: "<" + v[0] + ">" + unparse_mime_parameters(v[1]), links))

def test_parse_link_header() -> None:
    def check(lhs : list[str], expected_values : _t.Any) -> None:
        for lh in lhs:
            values = parse_link_header(lh)
            for i in range(0, len(expected_values)):
                url, params = values[i]
                expected_url, expected_params = expected_values[i]
                scheck(lh, "url", url, expected_url)
                scheck(lh, "params", params, expected_params)
            scheck(lh, "the whole", values, expected_values)

    check([
        "<https://example.org>",
        " <https://example.org>",
        "<https://example.org> ",
        " <https://example.org> ",
        " < https://example.org > ",
    ], [
        ("https://example.org", [])
    ])
    check([
        "<https://example.org>;rel=me",
        "<https://example.org>; rel=me",
        " <https://example.org> ; rel=me",
    ], [
        ("https://example.org", [("rel", "me")])
    ])
    check([
        "<https://example.org>; rel=preconnect; crossorigin",
        "<https://example.org>; rel=preconnect ; crossorigin ",
        " <https://example.org> ; rel=preconnect ; crossorigin ,",
        " <https://example.org> ; rel=preconnect ; ; crossorigin ; , ,, ",
        #" , <https://example.org>; rel=preconnect; crossorigin , ",
    ], [
        ("https://example.org", [("rel", "preconnect"), ("crossorigin", "")])
    ])
    check([
        '<https://example.org/path/#hash>; rel=canonical; type="text/html"',
    ], [
        ("https://example.org/path/#hash", [("rel", "canonical"), ("type", "text/html")])
    ])
    check([
        '<https://example.org>; rel=preconnect, ' +
        '<https://example.org/index.css>; as=style; rel=preload; crossorigin, ' +
        '<https://example.org/index.js>;; as=script; ; rel = "preload" ;  ; crossorigin;  , ' +
        ', ' +
        '<https://example.org/main.js>; as=script; rel=preload;;',
    ], [
        ('https://example.org', [('rel', 'preconnect')]),
        ('https://example.org/index.css', [('as', 'style'), ('rel', 'preload'), ('crossorigin', '')]),
        ('https://example.org/index.js', [('as', 'script'), ('rel', ' preload'), ('crossorigin', '')]),
        ('https://example.org/main.js', [('as', 'script'), ('rel', 'preload')])
    ])

def test_unparse_link_header() -> None:
    def check(lh : _t.Any, expected_value : _t.Any) -> None:
        value = unparse_link_header(lh)
        scheck(lh, "unparse", value, expected_value)

    check([("https://example.org", [("rel", "me")])], '<https://example.org>; rel="me"')
    check([
        ('https://example.org', [('rel', 'preconnect')]),
        ('https://example.org/index.css', [('as', 'style'), ('rel', 'preload'), ('crossorigin', '')]),
        ('https://example.org/index.js', [('as', 'script'), ('rel', ' preload'), ('crossorigin', '')]),
        ('https://example.org/main.js', [('as', 'script'), ('rel', 'preload')])
    ], '<https://example.org>; rel="preconnect", <https://example.org/index.css>; as="style"; rel="preload"; crossorigin="", <https://example.org/index.js>; as="script"; rel=" preload"; crossorigin="", <https://example.org/main.js>; as="script"; rel="preload"')

def parse_refresh_header(value : str) -> tuple[int, str]:
    """Parse HTTP `Refresh` header."""
    p = Parser(value)
    p.opt_whitespace()
    ngrp = p.regex(natural_re)
    p.opt_whitespace()
    p.string(";")
    p.opt_whitespace()
    p.string("url=")
    ugrp = p.regex(url_re)
    return int(ngrp[0]), ugrp[0]

def unparse_refresh_header(secs : int, url : str) -> str:
    return f"{secs}; url={url}"

def test_parse_refresh_header() -> None:
    def check(rhs : list[str], expected_num : _t.Any, expected_url : _t.Any) -> None:
        for rh in rhs:
            num, url = parse_refresh_header(rh)
            scheck(rh, "num", num, expected_num)
            scheck(rh, "url", url, expected_url)

    check([
        "10;url=https://example.org/",
        "10; url=https://example.org/",
        "10 ;url=https://example.org/",
        " 10;url=https://example.org/",
        "10 ; url=https://example.org/",
    ], 10, "https://example.org/")

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
