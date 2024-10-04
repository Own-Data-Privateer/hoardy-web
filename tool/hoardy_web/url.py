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

"""Parsing and un-parsing of URLs."""

import dataclasses as _dc
import idna as _idna
import logging as _logging
import os as _os
import re as _re
import typing as _t
import urllib.parse as _up

from kisstdlib.exceptions import *

from .parser import *

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

def pp_to_path(parts : list[str]) -> str:
    """Turn URL path components list into a minimally-quoted path."""
    return "/".join([miniquote(e, "/?") for e in parts])

def qsl_to_path(query : list[tuple[str, str]]) -> str:
    """Turn URL query components list into a minimally-quoted path."""
    l = []
    for k, v in query:
        k = miniquote(k, "/&=")
        v = miniquote(v, "/&")
        if v == "":
            l.append(k)
        else:
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
    def net_url(self) -> str:
        raw_path = self.raw_path
        if self.raw_hostname:
            nl = self.net_netloc
            if nl != "": nl = "//" + nl
            slash = "/" if raw_path == "" else ""
            return _up.quote(f"{self.scheme}:{nl}{raw_path}{slash}{self.oqm}{self.raw_query}", safe="%/:=&?~#+!$,;'@()*[]|")
        else:
            return _up.quote(f"{self.scheme}:{raw_path}{self.oqm}{self.raw_query}", safe="%/:=&?~#+!$,;'@()*[]|")

    @property
    def url(self) -> str:
        return f"{self.net_url}{self.ofm}{self.fragment}"

    @property
    def raw_path_parts(self) -> list[str]:
        return [_up.unquote(e) for e in self.raw_path.split("/")]

    @property
    def npath_parts(self) -> list[str]:
        parts_insecure = [e for e in self.raw_path_parts if e != ""]

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
    def query_parts(self) -> list[tuple[str, str]]:
        return _up.parse_qsl(self.raw_query, keep_blank_values=True)

    @property
    def query_ne_parts(self) -> list[tuple[str, str]]:
        return [e for e in self.query_parts if e[1] != ""]

    @property
    def mq_raw_path(self) -> str:
        return pp_to_path(self.raw_path_parts)

    @property
    def mq_npath(self) -> str:
        return pp_to_path(self.npath_parts)

    @property
    def mq_query(self) -> str:
        return qsl_to_path(self.query_parts)

    @property
    def mq_nquery(self) -> str:
        return qsl_to_path(self.query_ne_parts)

    @property
    def pretty_net_url(self) -> str:
        if self.raw_hostname:
            nl = self.netloc
            if nl != "": nl = "//" + nl
            slash = "/" if self.raw_path == "" else ""
            return f"{self.scheme}:{nl}{self.mq_raw_path}{slash}{self.oqm}{self.mq_query}"
        else:
            return f"{self.scheme}:{self.mq_raw_path}{self.oqm}{self.mq_query}"

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
            raise CatastrophicFailure("while evaluating %s of %s, got %s, expected %s", name, x.raw_url, getattr(x, name), value)

    tests1 : list[list[str| None]]
    tests1 = [
        ["http://example.org", "http://example.org/", "http://example.org/"],
        ["http://example.org/", None, None],
        ["http://example.org/test", None, None],
        ["http://example.org/test/", None, None],
        ["http://example.org/unfinished/query?", None, None],
        ["http://example.org/unfinished/query?param", None, "http://example.org/unfinished/query?"],
        ["http://example.org/unfinished/query?param=0", None, None],
        ["http://example.org/unfinished/query?param=0&param=1", None, None],
        ["http://example.org/web/2/https://archived.example.org", None, "http://example.org/web/2/https:/archived.example.org"],
        ["http://example.org/web/2/https://archived.example.org/", None, "http://example.org/web/2/https:/archived.example.org/"],
        ["http://example.org/web/2/https://archived.example.org/test", None, "http://example.org/web/2/https:/archived.example.org/test"],
        ["http://example.org/web/2/https://archived.example.org/test/", None, "http://example.org/web/2/https:/archived.example.org/test/"],
        ["http://example.org/web/2/https://archived.example.org/unfinished/query?", None, "http://example.org/web/2/https:/archived.example.org/unfinished/query?"],
        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param", None, "http://example.org/web/2/https:/archived.example.org/unfinished/query?"],
        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param=0", None, "http://example.org/web/2/https:/archived.example.org/unfinished/query?param=0"],
        ["http://example.org/web/2/https://archived.example.org/unfinished/query?param=0&param=1", None, "http://example.org/web/2/https:/archived.example.org/unfinished/query?param=0&param=1"],

        # work-around for common typos
        ["http://%20example.org/", "http://example.org/", None],

        # work-arounds for hostnames that `idna` module fails to parse
        ["http://ab-cd-xxxxxxxxx-yyyy.example.org/", None, None],
        ["http://ab--cd-xxxxxxxxx-yyyy.example.org/", None, None],
        ["http://ab---cd-xxxxxxxxx-yyyy.example.org/", None, None],
    ]

    url : str | None
    rest : list[str | None]
    for url, *rest in tests1:
        assert url is not None
        x = parse_url(url)
        check(x, "raw_url", url)

        curl = rest[0] if rest[0] is not None else url
        check(x, "net_url", curl)
        check(x, "pretty_net_url", curl)
        check(x, "pretty_url", curl)

        nurl = rest[1] if rest[1] is not None else curl
        check(x, "pretty_net_nurl", nurl)
        check(x, "pretty_nurl", nurl)

    tests2 : list[list[str| None]]
    tests2 = [
        ["http://example.org#hash", "http://example.org/#hash", "http://example.org/"],
        ["http://example.org/#hash", "http://example.org/#hash", "http://example.org/"],
    ]

    for url, *rest in tests2:
        assert url is not None
        x = parse_url(url)
        check(x, "raw_url", url)

        curl = rest[0] if rest[0] is not None else url
        check(x, "pretty_url", curl)
        check(x, "pretty_nurl", curl)

        nurl = rest[1] if rest[1] is not None else url
        check(x, "net_url", nurl)
        check(x, "pretty_net_url", nurl)
        check(x, "pretty_net_nurl", nurl)
