# Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
#
# This file is a part of pwebarc project.
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

"""Parsing and scrubbing of HTML data.
"""

import dataclasses as _dc
import re as _re
import traceback as _traceback
import typing as _t
import urllib.parse as _up

import html5lib as _h5
import html5lib.filters.base as _h5fb
import html5lib.filters.whitespace as _h5ws
import html5lib.filters.optionaltags as _h5ot

from kisstdlib.exceptions import *

HTML5Token = dict[str, _t.Any]

# HTML elements that must preserve space
_spacePreserveElements = _h5ws.Filter.spacePreserveElements
# HTML elements that ignore space completely (and so it can be added or removed arbitrarily)
_space_okElements = frozenset(["html", "head", "frameset"])

def prettify_html(walker : _t.Iterator[HTML5Token], indent : int = 2, relaxed : bool = False) \
        -> _t.Iterator[HTML5Token]:
    """HTML prettification html5lib.Filter that adds lots of indent.
    """

    stack : list[str] = []
    preserve : int = 0
    current : int = 0
    on_space : bool = True
    newline : bool = True

    prev_token : HTML5Token | None = None
    token : HTML5Token | None = None

    def space_ok() -> bool:
        try: tp = stack[-1]
        except IndexError: tp = None
        if tp in _space_okElements:
            return True
        return False

    def emit_indent() -> _t.Generator[HTML5Token, None, bool]:
        if on_space or relaxed or space_ok():
            if newline:
                chars = " " * (indent * current)
            else:
                chars = "\n" + " " * (indent * current)
            yield {"type": "SpaceCharacters", "data": chars}
            return current == 0
        else:
            return False

    for token in walker:
        typ = token["type"]
        if typ == "Doctype":
            yield token
            on_space = False
            newline = False
        elif typ == "EmptyTag":
            tn = token["name"]
            #if tn == "input":
            #    breakpoint()
            if preserve == 0:
                yield from emit_indent()
            yield token
            on_space = False
            newline = False
        elif typ == "StartTag":
            tn = token["name"]
            stack.append(tn)
            if preserve == 0:
                yield from emit_indent()
            current += 1
            if (preserve != 0 or tn in _spacePreserveElements):
                preserve += 1
            yield token
            on_space = False
            newline = False
        elif typ == "EndTag":
            stack.pop()
            current -= 1
            if preserve == 0:
                yield from emit_indent()
            else:
                preserve -= 1
            yield token
            on_space = False
            newline = False
        else:
            if preserve == 0:
                if typ == "SpaceCharacters":
                    # skip useless whitespace
                    on_space = True
                    continue
                newline = yield from emit_indent()
            yield token
            if typ == "SpaceCharacters":
                on_space = True
                newline = token["data"][-1:] == "\n"
            else:
                on_space = False
                newline = False
        prev_token = token

class RegsecParseError(Failure):
    pass

class Regsec:
    """Parser combinator with regexes."""

    def __init__(self, data : str) -> None:
        self._buffer = data

    def unread(self, data : str) -> None:
        self._buffer = data + self._buffer

    def is_eof(self) -> bool:
        return len(self._buffer) == 0

    def eof(self) -> None:
        if len(self._buffer) != 0:
            raise RegsecParseError("expected EOF, got %s", repr(self._buffer[0]))

    def regex(self, regexp : _re.Pattern[str], allow_empty : bool = False) -> tuple[str | _t.Any, ...]:
        m = regexp.match(self._buffer)
        if m is None:
            raise RegsecParseError("failed to advance via %s, buffer is %s", regexp, repr(self._buffer))
        pos = m.span()[1]
        if pos == 0:
            if not allow_empty:
                raise RegsecParseError("matched nothing via %s, buffer is %s", regexp, repr(self._buffer))
        else:
            self._buffer = self._buffer[pos:]
        return m.groups()

    def opt_regex(self, regexp : _re.Pattern[str]) -> tuple[str | _t.Any, ...]:
        return self.regex(regexp, True)

word_re = _re.compile(r"\S+")
opt_whitespace_re = _re.compile(r"^\s*")

# URL double-slash scheme
uds_str       = r"http|https|ftp|ftps"
# URL auth
uauth_str     = r"\S+(?::\S*)?"
# URL hostname
uhostname_str = r"[^:/?#\s]+"
# URL port
uport_str     = r":\d+"
# URL path component
upath_str     = r"/[^?#\s]*"
# URL relative path
urel_str      = r"[^?#\s]+"
# URL query
uquery_str    = r"[^#\s]*"
# URL fragment/hash
ufragment_str = r"[^\s]*"

# Regexp describing a URL, the second case is for common malformed path-less
# URLs like "https://example.com" (which should actually be given as
# "https://example.com/", but this is almost a universal mistake). The order
# of cases matters, since `_re.match` and co are greedy.
url_re_str = rf"""(
(
(?:(?:{uds_str}):)?
//
(?:{uauth_str}@)?
(?:{uhostname_str})
(?:{uport_str})?
(?:{upath_str})
|
(?:(?:{uds_str}):)?
//
(?:{uauth_str}@)?
(?:{uhostname_str})
(?:{uport_str})?
|
(?:{upath_str})
|
(?:{urel_str})
)
(\?{uquery_str})?
(#{ufragment_str})?
)""".replace("\n", "")
url_re = _re.compile(url_re_str)

#print(url_re_str)

opt_srcset_condition = _re.compile(r"^(?:\s+([0-9]+(?:\.[0-9]+)?[xw]))?")
opt_srcset_sep = _re.compile(r"^(\s*,)?")

def parse_srcset_attr(value : str) -> list[tuple[str, str]]:
    """Parse HTML5 srcset attribute"""
    res = []
    p = Regsec(value)
    p.opt_regex(opt_whitespace_re)
    while not p.is_eof():
        grp = p.regex(url_re)
        if grp[1].endswith(","):
            url = grp[1][:-1]
            p.unread(",")
        else:
            url = grp[1]
        grp = p.opt_regex(opt_srcset_condition)
        cond = grp[0]
        p.opt_regex(opt_whitespace_re)
        p.opt_regex(opt_srcset_sep)
        p.opt_regex(opt_whitespace_re)
        if url != "":
            res.append((url, cond))
        #else: ignore it
    return res

def unparse_srcset_attr(value : list[tuple[str, str]]) -> str:
    """Unparse HTML5 srcset attribute"""
    return ", ".join([(f"{url} {cond}" if cond is not None else url) for url, cond in value])

ie_pragma_re = _re.compile(r"^\s*\[if IE [^]]*\].*\[endif\]\s*$")

htmlns = _h5.constants.namespaces["html"]
xlinkns = _h5.constants.namespaces["xlink"]
xmlns = _h5.constants.namespaces["xml"]
in_head = [(htmlns, "html"), (htmlns, "head")]

htmlns_base = (htmlns, "base")
htmlns_script = (htmlns, "script")
htmlns_iframe = (htmlns, "iframe")
htmlns_style = (htmlns, "style")
htmlns_link = (htmlns, "link")

style_attr = (None, "style")
rel_attr = (None, "rel")
href_attr = (None, "href")

NS = tuple[str | None, str]

jumps_attrs : frozenset[tuple[NS, NS]]
jumps_attrs = frozenset([
    ((htmlns, "a"),      (None, "href")),
    ((htmlns, "area"),   (None, "href")),
    (htmlns_base,        (None, "href")),
    ((htmlns, "blockquote"), (None, "cite")),
    ((htmlns, "del"),    (None, "cite")),
    ((htmlns, "ins"),    (None, "cite")),
    ((htmlns, "object"), (None, "data")),
    ((htmlns, "q"),      (None, "cite")),
])

actions_attrs : frozenset[tuple[NS, NS]]
actions_attrs = frozenset([
    ((htmlns, "a"),      (None, "ping")),
    ((htmlns, "area"),   (None, "ping")),
    ((htmlns, "button"), (None, "formaction")),
    ((htmlns, "form"),   (None, "action")),
    ((htmlns, "input"),  (None, "formaction")),
])

srcs_attrs : frozenset[tuple[NS, NS]]
srcs_attrs = frozenset([
    ((htmlns, "audio"),  (None, "src")),
    ((htmlns, "embed"),  (None, "src")),
    ((htmlns, "iframe"), (None, "src")),
    ((htmlns, "img"),    (None, "src")),
    ((htmlns, "input"),  (None, "src")),
    (htmlns_link,        (None, "href")),
    ((htmlns, "script"), (None, "src")),
    ((htmlns, "source"), (None, "src")),
    ((htmlns, "track"),  (None, "src")),
    ((htmlns, "video"),  (None, "poster")),
    ((htmlns, "video"),  (None, "src")),
])

refs_attrs : frozenset[tuple[NS, NS]]
refs_attrs = frozenset(list(jumps_attrs) + list(actions_attrs) + list(srcs_attrs))

srcset_attrs = frozenset([
    ((htmlns, "img"),    (None, "srcset")),
])

tracking_attrs = frozenset([
    ((htmlns, "a"),      (None, "ping")),
    ((htmlns, "area"),   (None, "ping")),
])

prefetch_link_rels = frozenset([
    "dns-prefetch", "preconnect", "prefetch", "prerender", "preload", "modulepreload",
])

stylesheet_link_rels = frozenset([
    "stylesheet", "ie-optimized-stylesheet-desk", "ie-optimized-onevent-stylesheet",
])

@_dc.dataclass
class ScrubOpts:
    unknown : bool = _dc.field(default=True)
    jumps : bool = _dc.field(default=True)
    actions : bool = _dc.field(default=False)
    srcs : bool = _dc.field(default=False)
    scripts : bool = _dc.field(default=False)
    iframes : bool = _dc.field(default=False)
    styles : bool = _dc.field(default=False)
    iepragmas : bool = _dc.field(default=False)
    prefetches : bool = _dc.field(default=False)
    tracking : bool = _dc.field(default=False)
    verbose : bool | int = _dc.field(default=True)
    whitespace : bool = _dc.field(default=False)
    optional_tags : bool = _dc.field(default=True)
    indent : bool = _dc.field(default=False)
    debug : bool = _dc.field(default=False)

ScrubReferenceOpts = ["jumps", "actions", "srcs"]
ScrubDynamicOpts = ["scripts", "iframes", "styles", "iepragmas", "prefetches", "tracking"]

RemapUrlType = _t.Callable[[int, str], str]

def make_scrubber(opts : ScrubOpts) \
        -> _t.Callable[[str, RemapUrlType, _t.Iterator[HTML5Token]], _t.Iterator[HTML5Token]]:
    """Generates a function that produces html5lib.Filter that scrubs HTML
      documents, rewriting links, and removing scripts, styles, etc, as
      requested.
    """

    attr_blacklist : set[tuple[NS, NS]] = set()
    if not opts.tracking:
        attr_blacklist.update(tracking_attrs)

    link_rel_blacklist : set[str] = set()
    if not opts.styles:
        link_rel_blacklist.update(stylesheet_link_rels)
    if not opts.prefetches:
        link_rel_blacklist.update(prefetch_link_rels)

    not_scripts = not opts.scripts
    not_iframes = not opts.iframes
    not_styles = not opts.styles
    not_jumps = not opts.jumps
    not_actions = not opts.actions
    not_srcs = not opts.srcs
    not_iepragmas = not opts.iepragmas

    def scrub_html(base_url : str,
                   remap_url : RemapUrlType,
                   walker : _t.Iterator[HTML5Token]) -> _t.Iterator[HTML5Token]:
        orig_base_url = base_url
        base_url_unset = True

        censor_lvl : int = 0
        stack : list[tuple[str | None, str]] = []

        def emit_censored(what : str) -> _t.Iterator[HTML5Token]:
            if opts.verbose:
                yield {"type": "Comment", "data": f"wrrarms censored out a {what} from here"}

        for token in walker:
            typ = token["type"]
            censoring = censor_lvl != 0

            if typ == "StartTag" or typ == "EmptyTag":
                nn = (token["namespace"], token["name"])
                attrs = token["data"]

                # handle <base ...> tag
                if base_url_unset and \
                   nn == htmlns_base and \
                   stack == in_head:
                    href = attrs.get(href_attr, None)
                    if href is not None:
                        # add root slash to the URL if it's missing one
                        purl = _up.urlsplit(href.strip())
                        if purl.netloc != "" and purl.path == "":
                            href = _up.urlunsplit((purl.scheme, purl.netloc, "/", purl.query, purl.fragment))
                        else:
                            href = purl.geturl()
                        href = _up.urljoin(orig_base_url, href)
                        #attrs[href_attr] = remap_url(href) # if no censorship
                        # set new base_url
                        base_url = href
                        # can only be set once
                        base_url_unset = False
                    # censor the original tag for simplicity
                    censoring = True

                if not censoring:
                    if not_scripts and nn == htmlns_script or \
                       not_iframes and nn == htmlns_iframe or \
                       not_styles and nn == htmlns_style:
                        # censor the whole tag
                        censoring = True
                    elif nn == htmlns_link:
                        # censor link rel attributes
                        rels_ = attrs.get(rel_attr, None)
                        if rels_ is not None:
                            rels = word_re.findall(rels_)
                            allowed_rels = list(filter(lambda r: r not in link_rel_blacklist, rels))
                            if len(allowed_rels) > 0:
                                attrs[rel_attr] = " ".join(allowed_rels)
                            else:
                                # censor the whole tag in this case
                                censoring = True

                if not censoring:
                    # scrub attributes
                    to_remove = []
                    for ann in attrs:
                        nnann = (nn, ann)
                        if not_scripts and ann[0] is None and ann[1].startswith("on"):
                            # drop inline javascript on* attributes, e.g. `onclick`
                            to_remove.append(ann)
                            continue
                        elif not_styles and ann == style_attr:
                            # drop inline styles
                            to_remove.append(ann)
                            continue
                        elif nnann in attr_blacklist:
                            to_remove.append(ann)
                            continue

                        # turn relative URLs into absolute ones, and then mangle them with remap_url
                        value = attrs[ann]
                        if nnann in refs_attrs:
                            url = value.strip()
                            url = _up.urljoin(base_url, url)
                            if not_scripts and url.startswith("javascript:"):
                                url = "javascript:void(0)"
                            elif not (url.startswith("data:") or url.startswith("javascript:")):
                                if nnann in jumps_attrs:
                                    kind, minus = 0, not_jumps
                                elif nnann in actions_attrs:
                                    kind, minus = 1, not_actions
                                else:
                                    kind, minus = 2, not_srcs
                                # remap URL
                                if minus:
                                    url = remap_url_into_void(kind, url)
                                else:
                                    url = remap_url(kind, url)
                            attrs[ann] = url
                        elif nnann in srcset_attrs:
                            srcset = parse_srcset_attr(value)
                            new_srcset = []
                            for url, cond in srcset:
                                url = _up.urljoin(base_url, url)
                                if not_scripts and url.startswith("javascript:"):
                                    continue
                                elif not (url.startswith("data:") or url.startswith("javascript:")):
                                    # remap URL
                                    if not_srcs:
                                        url = remap_url_into_void(2, url)
                                    else:
                                        url = remap_url(2, url)
                                new_srcset.append((url, cond))
                            attrs[ann] = unparse_srcset_attr(new_srcset)
                            del srcset, new_srcset

                    # cleanup
                    for ann in to_remove:
                        del attrs[ann]

                if typ == "StartTag":
                    stack.append(nn)
                    if censoring:
                        censor_lvl += 1
            elif typ == "EndTag":
                # stop handling <base ...> tag
                if stack == in_head:
                    base_url_unset = False

                if censor_lvl != 0:
                    censor_lvl -= 1
                stack.pop()
                #print(stack)
            elif not_iepragmas and typ == "Comment" and ie_pragma_re.match(token["data"]):
                yield from emit_censored("comment with an IE pragma")
                continue

            if not censoring:
                yield token
            elif typ != "SpaceCharacters":
                if opts.verbose == 2:
                    tt = token.get("name", None)
                    tt = f"{tt} tag" if tt is not None else typ
                    yield from emit_censored(tt)
                elif typ == "StartTag" or typ == "EmptyTag":
                    tt = token.get("name", typ)
                    yield from emit_censored(tt)

    post_process1 : _h5fb.Filter
    if opts.whitespace:
        post_process1 = lambda x: x
    else:
        post_process1 = _h5ws.Filter

    post_process2 : _h5fb.Filter
    if opts.debug:
        post_process2 = lambda x: prettify_html(post_process1(x), 2, True)
    elif opts.indent:
        post_process2 = lambda x: prettify_html(post_process1(x), 2)
    else:
        post_process2 = post_process1

    post_process3 : _h5fb.Filter
    if opts.optional_tags:
        post_process3 = post_process2
    else:
        post_process3 = lambda x: _h5ot.Filter(post_process2(x))

    return lambda base_url, remap_url, walker: post_process3(scrub_html(base_url, remap_url, walker))

def remap_url_id(kind : int, url : str) -> str:
    return url

def remap_url_into_void(kind : int, url : str) -> str:
    if kind == 2:
        return "data:text/plain;base64,"
    else:
        return "javascript:void(0)"

_html5treebuilder = _h5.treebuilders.getTreeBuilder("etree", fullTree=True)
_html5parser = _h5.html5parser.HTMLParser(_html5treebuilder)
_html5walker = _h5.treewalkers.getTreeWalker("etree")
_html5serializer = _h5.serializer.HTMLSerializer(strip_whitespace = False, omit_optional_tags = False)

def scrub_html(scrubber : _t.Any,
               base_url : str,
               remap_url : RemapUrlType,
               data : str | bytes, *,
               likely_encoding : str | None = None) -> str:
    dom = _html5parser.parse(data, likely_encoding=likely_encoding)
    charEncoding = _html5parser.tokenizer.stream.charEncoding[0]
    walker = scrubber(base_url, remap_url, _html5walker(dom))
    return _html5serializer.render(walker, charEncoding.name) # type: ignore
