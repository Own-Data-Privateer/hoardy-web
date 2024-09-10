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

"""Parsing and scrubbing of HTML data.
"""

import dataclasses as _dc
import enum as _enum
import re as _re
import traceback as _traceback
import typing as _t
import urllib.parse as _up

import html5lib as _h5
import html5lib.filters.base as _h5fb
import html5lib.filters.whitespace as _h5ws
import html5lib.filters.optionaltags as _h5ot

import tinycss2 as _tcss

from kisstdlib.exceptions import *

class LinkType(_enum.Enum):
    JUMP = 0
    ACTION = 1
    REQ = 2

LinkRemapper = _t.Callable[[LinkType, str], str]

def remap_link_id(link_type : LinkType, url : str) -> str:
    return url

def remap_link_into_void(link_type : LinkType, url : str) -> str:
    if link_type == LinkType.REQ:
        return "data:text/plain;base64,"
    else:
        return "javascript:void(0)"

HTML5Token = dict[str, _t.Any]
CSSNode : _t.TypeAlias = _tcss.ast.Node

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

    def space_ok() -> bool:
        if len(stack) == 0:
            return True
        tp = stack[-1]
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

    prev_token : HTML5Token | None = None
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
            current -= 1
            if preserve == 0:
                yield from emit_indent()
            else:
                preserve -= 1
            stack.pop()
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

ie_pragma_re = _re.compile(r"^\s*(\[if IE [^]]*\].*\[endif\]|\[if !IE\]><!|<!\[endif\])\s*$")

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

link_attrs : frozenset[tuple[NS, NS]]
link_attrs = frozenset([
    (htmlns_link,        (None, "href")),
])

link_reqs_rels : frozenset[str]
link_reqs_rels = frozenset(["stylesheet", "icon", "shortcut"])

reqs_attrs : frozenset[tuple[NS, NS]]
reqs_attrs = frozenset([
    ((htmlns, "audio"),  (None, "src")),
    ((htmlns, "embed"),  (None, "src")),
    ((htmlns, "iframe"), (None, "src")),
    ((htmlns, "img"),    (None, "src")),
    ((htmlns, "input"),  (None, "src")),
    ((htmlns, "script"), (None, "src")),
    ((htmlns, "source"), (None, "src")),
    ((htmlns, "track"),  (None, "src")),
    ((htmlns, "video"),  (None, "poster")),
    ((htmlns, "video"),  (None, "src")),
])

refs_attrs : frozenset[tuple[NS, NS]]
refs_attrs = frozenset(list(jumps_attrs) + list(actions_attrs) + list(link_attrs) + list(reqs_attrs))

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
class ScrubbingOptions:
    unknown : bool = _dc.field(default=True)
    jumps : bool = _dc.field(default=True)
    actions : bool = _dc.field(default=False)
    reqs : bool = _dc.field(default=False)
    styles : bool = _dc.field(default=False)
    scripts : bool = _dc.field(default=False)
    iepragmas : bool = _dc.field(default=False)
    iframes : bool = _dc.field(default=False)
    prefetches : bool = _dc.field(default=False)
    tracking : bool = _dc.field(default=False)
    verbose : bool = _dc.field(default=False)
    whitespace : bool = _dc.field(default=False)
    optional_tags : bool = _dc.field(default=True)
    indent : bool = _dc.field(default=False)
    indent_step : int = _dc.field(default=2)
    debug : bool = _dc.field(default=False)

ScrubbingReferenceOptions = ["jumps", "actions", "reqs"]
ScrubbingDynamicOpts = ["scripts", "iframes", "styles", "iepragmas", "prefetches", "tracking"]

Scrubbers = tuple[
    _t.Callable[[str, LinkRemapper, _t.Iterator[HTML5Token]], _t.Iterator[HTML5Token]],
    _t.Callable[[str, LinkRemapper, _t.Iterator[CSSNode]], list[CSSNode]],
]

class CSSScrubbingError(Failure): pass

def make_scrubbers(opts : ScrubbingOptions) -> Scrubbers:
    attr_blacklist : set[tuple[NS, NS]] = set()
    if not opts.tracking:
        attr_blacklist.update(tracking_attrs)

    link_rel_blacklist : set[str] = set()
    if not opts.styles:
        link_rel_blacklist.update(stylesheet_link_rels)
    if not opts.prefetches:
        link_rel_blacklist.update(prefetch_link_rels)

    not_jumps = not opts.jumps
    not_actions = not opts.actions
    not_reqs = not opts.reqs
    not_styles = not opts.styles
    not_scripts = not opts.scripts
    not_iepragmas = not opts.iepragmas
    not_iframes = not opts.iframes
    yes_verbose = opts.verbose
    not_verbose = not opts.verbose
    not_whitespace = not opts.whitespace
    yes_indent = opts.indent
    indent_step = opts.indent_step

    def remap_url(base_url : str,
                  remap_link : LinkRemapper,
                  url : str) -> str:
        url = _up.urljoin(base_url, url)
        if not_scripts and url.startswith("javascript:"):
            url = "javascript:void(0)"
        elif not (url.startswith("data:") or url.startswith("javascript:")):
            url = remap_link(LinkType.REQ, url)
        return url

    def scrub_css(base_url : str,
                  remap_link : LinkRemapper,
                  nodes : _t.Iterator[CSSNode],
                  current : int | None = None,
                  errors : bool = False) -> list[CSSNode]:
        if not_styles:
            if not_verbose:
                node = _tcss.ast.Comment(0, 0, f" hoardy-web censored out CSS data from here ")
                return [node]
            else:
                return []

        res = []
        newline : bool = True

        def emit_indent() -> None:
            if current is not None:
                if newline:
                    chars = " " * (indent_step * current)
                else:
                    chars = "\n" + " " * (indent_step * current)
                res.append(_tcss.ast.WhitespaceToken(0, 0, chars))

        # walk the AST tree recursively
        for node in nodes:
            if isinstance(node, (_tcss.ast.QualifiedRule, _tcss.ast.AtRule)):
                emit_indent()
                node.prelude = scrub_css(base_url, remap_link, node.prelude)
                if node.content is not None:
                    if current is not None:
                        try:
                            content = scrub_css(base_url, remap_link, _tcss.parse_blocks_contents(node.content), current + 1, True)
                        except CSSScrubbingError:
                            # it does not parse, scrub the tokens instead
                            content = scrub_css(base_url, remap_link, node.content)
                        node.content = \
                            [_tcss.ast.WhitespaceToken(0, 0, "\n")] + \
                            content + \
                            [_tcss.ast.WhitespaceToken(0, 0, "\n" + " " * (indent_step * current))]
                        del content
                    else:
                        # NB: no need to parse with `_tcss.parse_blocks_contents` in this case
                        node.content = scrub_css(base_url, remap_link, node.content)
            elif isinstance(node, _tcss.ast.Declaration):
                emit_indent()
                node.value = scrub_css(base_url, remap_link, node.value)
            elif isinstance(node, _tcss.ast.URLToken):
                # remap the URL
                url = remap_url(base_url, remap_link, node.value)
                rep = f"url({_tcss.serializer.serialize_url(url)})"
                node.value = url
                node.representation = rep
            elif isinstance(node, _tcss.ast.FunctionBlock):
                if node.lower_name == "url":
                    # technically, this is a bug in the CSS we are processing, but browsers work around this, so do we
                    url = remap_url(base_url, remap_link, "".join([n.value for n in node.arguments if n.type == "string"]))
                    rep = f"url({_tcss.serializer.serialize_url(url)})"
                    res.append(_tcss.ast.URLToken(node.source_line, node.source_column, url, rep))
                    continue
                node.arguments = scrub_css(base_url, remap_link, node.arguments)
            elif isinstance(node, (_tcss.ast.ParenthesesBlock, _tcss.ast.SquareBracketsBlock, _tcss.ast.CurlyBracketsBlock)):
                node.content = scrub_css(base_url, remap_link, node.content)
            elif isinstance(node, _tcss.ast.Comment):
                emit_indent()
            elif isinstance(node, _tcss.ast.ParseError):
                if errors:
                    raise CSSScrubbingError("tinycss2.ast.ParseError: %s: %s", node.kind, node.message)
                # replace errors with comments explaining what failed to parse
                emit_indent()
                node = _tcss.ast.Comment(node.source_line, node.source_column,
                                         f" hoardy-web CSS parsing error: {node.kind}: {node.message} ")
            elif isinstance(node, _tcss.ast.WhitespaceToken):
                if not_whitespace or current is not None:
                    # minimize away
                    res.append(_tcss.ast.WhitespaceToken(node.source_line, node.source_column, " "))
                    continue
                res.append(node)
                if node.value.endswith("\n"):
                    newline = True
                continue

            res.append(node)
            newline = False
        return res

    def scrub_html(base_url : str,
                   remap_link : LinkRemapper,
                   walker : _t.Iterator[HTML5Token]) -> _t.Iterator[HTML5Token]:
        orig_base_url = base_url
        base_url_unset = True

        remap_src_url : LinkRemapper
        if not_reqs:
            remap_src_url = remap_link_into_void
        else:
            remap_src_url = remap_link

        censor_lvl : int = 0
        stack : list[tuple[str | None, str]] = []

        assembling : bool = False
        contents : list[str] = []

        def emit_censored(what : str) -> _t.Iterator[HTML5Token]:
            if yes_verbose:
                yield {"type": "Comment", "data": f" hoardy-web censored out {what} from here "}

        for token in walker:
            typ = token["type"]

            if assembling and (typ == "Characters" or typ == "SpaceCharacters"):
                contents.append(token["data"])
                continue

            censoring = censor_lvl != 0
            if censoring and len(contents) > 0:
                yield from emit_censored("character data")
                contents = []

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
                        #attrs[href_attr] = remap_link(href) # if no censorship
                        # set new base_url
                        base_url = href
                        # can only be set once
                        base_url_unset = False
                    # censor the original tag for simplicity
                    censoring = True

                link_rels = []
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
                            link_rels = list(filter(lambda r: r not in link_rel_blacklist, rels))
                            if len(link_rels) > 0:
                                attrs[rel_attr] = " ".join(link_rels)
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
                            if not_verbose:
                                # drop inline styles
                                to_remove.append(ann)
                            else:
                                attrs[ann] = "/* hoardy-web censored out a CSS data from here */"
                            continue
                        elif nnann in attr_blacklist:
                            to_remove.append(ann)
                            continue

                        value = attrs[ann]
                        if nnann in refs_attrs:
                            # turn relative URLs into absolute ones, and then mangle them with remap_link
                            url = value.strip()
                            url = _up.urljoin(base_url, url)
                            if not_scripts and url.startswith("javascript:"):
                                url = "javascript:void(0)"
                            elif not (url.startswith("data:") or url.startswith("javascript:")):
                                if nnann in jumps_attrs:
                                    link_type, minus = LinkType.JUMP, not_jumps
                                elif nnann in actions_attrs:
                                    link_type, minus = LinkType.ACTION, not_actions
                                elif nnann in link_attrs:
                                    if any([rel in link_reqs_rels for rel in link_rels]):
                                        link_type, minus = LinkType.REQ, not_reqs
                                    else:
                                        link_type, minus = LinkType.JUMP, not_jumps
                                else:
                                    link_type, minus = LinkType.REQ, not_reqs
                                # remap the URL
                                if minus:
                                    url = remap_link_into_void(link_type, url)
                                else:
                                    url = remap_link(link_type, url)
                            attrs[ann] = url
                        elif nnann in srcset_attrs:
                            # similarly
                            srcset = parse_srcset_attr(value)
                            new_srcset = []
                            for url, cond in srcset:
                                if not_scripts and url.startswith("javascript:"):
                                    continue
                                elif not(url.startswith("data:") or url.startswith("javascript:")):
                                    # remap the URL
                                    url = _up.urljoin(base_url, url)
                                    url = remap_src_url(LinkType.REQ, url)
                                new_srcset.append((url, cond))
                            attrs[ann] = unparse_srcset_attr(new_srcset)
                            del srcset, new_srcset
                        elif ann == style_attr:
                            attrs[ann] = _tcss.serialize(scrub_css(base_url, remap_src_url, _tcss.parse_blocks_contents(value), 0 if yes_indent else None))

                    # cleanup
                    for ann in to_remove:
                        del attrs[ann]

                if typ == "StartTag":
                    stack.append(nn)
                    if censoring:
                        censor_lvl += 1
                    elif nn == htmlns_style:
                        # start assembling <style> contents
                        assembling = True
            elif typ == "EndTag":
                # stop handling <base ...> tag
                if stack == in_head:
                    base_url_unset = False
                # scrub <style> contents
                elif assembling:
                    assembling = False
                    data = "".join(contents)
                    contents = []
                    stack_len = len(stack)
                    data = _tcss.serialize(scrub_css(base_url, remap_src_url, _tcss.parse_stylesheet(data), stack_len))
                    if yes_indent:
                        data = "\n" + " " * (2 * stack_len) + data.strip() + "\n" + " " * (2 * (stack_len - 1))
                    elif not_whitespace:
                        data = data.strip()
                    yield {"type": "Characters", "data": data}

                stack.pop()
                #print(stack)

                if censoring:
                    censor_lvl -= 1
            elif not_iepragmas and typ == "Comment" and ie_pragma_re.match(token["data"]):
                yield from emit_censored("a comment with an IE pragma")
                continue

            if not censoring:
                yield token
            elif typ != "SpaceCharacters":
                tt = token.get("name", None)
                tt = f"{typ} {tt}" if tt is not None else typ
                yield from emit_censored(tt)

    post_process1 : _h5fb.Filter
    if opts.whitespace:
        post_process1 = lambda x: x
    else:
        post_process1 = _h5ws.Filter

    post_process2 : _h5fb.Filter
    if opts.debug:
        post_process2 = lambda x: prettify_html(post_process1(x), indent_step, True)
    elif opts.indent:
        post_process2 = lambda x: prettify_html(post_process1(x), indent_step)
    else:
        post_process2 = post_process1

    post_process3 : _h5fb.Filter
    if opts.optional_tags:
        post_process3 = post_process2
    else:
        post_process3 = lambda x: _h5ot.Filter(post_process2(x))

    process_html = lambda base_url, remap_link, walker: post_process3(scrub_html(base_url, remap_link, walker))
    process_css = lambda base_url, remap_link, nodes: scrub_css(base_url, remap_link, nodes, 0 if yes_indent else None)
    return process_html, process_css

_html5treebuilder = _h5.treebuilders.getTreeBuilder("etree", fullTree=True)
_html5parser = _h5.html5parser.HTMLParser(_html5treebuilder)
_html5walker = _h5.treewalkers.getTreeWalker("etree")
_html5serializer = _h5.serializer.HTMLSerializer(strip_whitespace = False, omit_optional_tags = False)

def scrub_css(scrubber : Scrubbers,
              base_url : str,
              remap_link : LinkRemapper,
              data : str | bytes,
              protocol_encoding : str | None = None) -> str:
    if isinstance(data, str):
        nodes = _tcss.parse_stylesheet(data)
    else:
        nodes, encoding = _tcss.parse_stylesheet_bytes(data, protocol_encoding=protocol_encoding)
    res = scrubber[1](base_url, remap_link, nodes)
    return _tcss.serialize(res) # type: ignore

def scrub_html(scrubber : Scrubbers,
               base_url : str,
               remap_link : LinkRemapper,
               data : str | bytes,
               protocol_encoding : str | None = None) -> str:
    dom = _html5parser.parse(data, likely_encoding=protocol_encoding)
    charEncoding = _html5parser.tokenizer.stream.charEncoding[0]
    walker = scrubber[0](base_url, remap_link, _html5walker(dom))
    return _html5serializer.render(walker, charEncoding.name) # type: ignore
