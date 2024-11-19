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

import collections as _c
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

from .wire import *
from .mime import *
from .util import map_optional, map_optionals, make_func_pipe

def is_data_url(url : str) -> bool:
    return url.startswith("data:")

def is_script_url(url : str) -> bool:
    return url.startswith("javascript:")

def is_page_url(url : str) -> bool:
    return url.startswith("http:") or url.startswith("https:")

class LinkType(_enum.Enum):
    JUMP = 0
    ACTION = 1
    REQ = 2

def get_void_url(link_type : LinkType) -> str:
    if link_type == LinkType.REQ:
        return "data:text/plain,%20"
    else:
        return "javascript:void(0)"

RefType = tuple[LinkType, list[str]] # tuple[LinkType, possible mime types]
URLRemapper = _t.Callable[[LinkType, list[str] | None, str], str | None] | None

HTML5Node = dict[str, _t.Any]
HTML5NN = tuple[str | None, str] # NN = namespaced name
HTML5NodeAttr = tuple[HTML5NN, HTML5NN] # tuple[namespaced token name, namespaced attribute name]
HTML5NodeAttrValues = _c.OrderedDict[HTML5NN, str]
CSSNode : _t.TypeAlias = _tcss.ast.Node

def debug_walker(walker : _t.Iterator[HTML5Node]) -> _t.Iterator[HTML5Node]:
    for token in walker:
        print(token)
        yield token

htmlns = _h5.constants.namespaces["html"]
xlinkns = _h5.constants.namespaces["xlink"]
xmlns = _h5.constants.namespaces["xml"]

htmlns_a = (htmlns, "a")
htmlns_area = (htmlns, "area")
htmlns_audio = (htmlns, "audio")
htmlns_base = (htmlns, "base")
htmlns_blockquote = (htmlns, "blockquote")
htmlns_body = (htmlns, "body")
htmlns_button = (htmlns, "button")
htmlns_del = (htmlns, "del")
htmlns_embed = (htmlns, "embed")
htmlns_form = (htmlns, "form")
htmlns_frame = (htmlns, "frame")
htmlns_head = (htmlns, "head")
htmlns_html = (htmlns, "html")
htmlns_iframe = (htmlns, "iframe")
htmlns_img = (htmlns, "img")
htmlns_input = (htmlns, "input")
htmlns_ins = (htmlns, "ins")
htmlns_link = (htmlns, "link")
htmlns_meta= (htmlns, "meta")
htmlns_noscript = (htmlns, "noscript")
htmlns_object = (htmlns, "object")
htmlns_q = (htmlns, "q")
htmlns_script = (htmlns, "script")
htmlns_source = (htmlns, "source")
htmlns_style = (htmlns, "style")
htmlns_title = (htmlns, "title")
htmlns_track = (htmlns, "track")
htmlns_video = (htmlns, "video")

action_attr = (None, "action")
cite_attr = (None, "cite")
content_attr = (None, "content")
crossorigin_attr = (None, "crossorigin")
data_attr = (None, "data")
formaction_attr = (None, "formaction")
href_attr = (None, "href")
http_equiv_attr = (None, "http-equiv")
integrity_attr = (None, "integrity")
nonce_attr = (None, "nonce")
ping_attr = (None, "ping")
poster_attr = (None, "poster")
rel_attr = (None, "rel")
src_attr = (None, "src")
srcset_attr = (None, "srcset")
style_attr = (None, "style")

# HTML elements that must preserve whitespace
html_whitespace_preserve_tags = _h5ws.Filter.spacePreserveElements
# HTML elements that ignore whitespace completely (and so whitespeace can be added or removed arbitrarily)
html_whitespace_ignore_tags = frozenset(["html", "head", "frameset"])

def prettify_html(indent : int, relaxed : bool, walker : _t.Iterator[HTML5Node]) \
        -> _t.Iterator[HTML5Node]:
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
        if tp in html_whitespace_ignore_tags:
            return True
        return False

    def emit_indent() -> _t.Generator[HTML5Node, None, bool]:
        if on_space or relaxed or space_ok():
            if newline:
                chars = " " * (indent * current)
            else:
                chars = "\n" + " " * (indent * current)
            yield {"type": "SpaceCharacters", "data": chars}
            return current == 0
        else:
            return False

    prev_token : HTML5Node | None = None
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
            if (preserve != 0 or tn in html_whitespace_preserve_tags):
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

def headers_to_meta_http_equiv(headers : Headers) -> _t.Iterator[HTML5Node]:
    """Produce `<meta http-equiv>` tags from given `HTTP` headers."""

    def emit_http_eqiuv(typ : str, value : str) -> _t.Iterator[HTML5Node]:
        attrs = _c.OrderedDict()
        attrs[http_equiv_attr] = typ
        attrs[content_attr] = value
        yield {"type": "EmptyTag", "namespace": htmlns, "name": "meta", "data": attrs}

    # `Content-Type` headers are handled by `html5lib` and
    # `protocol_encoding` below, so we ignore them here.

    # `Content-Security-Policy` can be specified multiple times.
    for csph in get_headers(headers, "content-security-policy"):
        yield from emit_http_eqiuv("content-security-policy", csph)

    # These headers should be inlined verbatim.
    for name, value in headers:
        if name.lower() in ["x-ua-compatible", "default-style", "refresh"]:
            yield from emit_http_eqiuv(name, value.decode("ascii"))

    # `Link` can be specified multiple times.
    for lh in get_headers(headers, "link"):
        yield from emit_http_eqiuv("link", lh)

class RemapType(_enum.Enum):
    ID = 0
    VOID = 1
    OPEN = 2
    CLOSED = 3
    FALLBACK = 4

@_dc.dataclass
class ScrubbingOptions:
    jumps : RemapType = _dc.field(default=RemapType.OPEN)
    actions : RemapType = _dc.field(default=RemapType.FALLBACK)
    reqs : RemapType = _dc.field(default=RemapType.FALLBACK)
    unknown : bool = _dc.field(default=True)
    styles : bool = _dc.field(default=True)
    scripts : bool = _dc.field(default=False)
    iepragmas : bool = _dc.field(default=False)
    iframes : bool = _dc.field(default=True)
    prefetches : bool = _dc.field(default=False)
    tracking : bool = _dc.field(default=False)
    navigations : bool = _dc.field(default=False)
    interpret_noscript : bool = _dc.field(default=True)

    verbose : bool = _dc.field(default=False)
    whitespace : bool = _dc.field(default=False)
    optional_tags : bool = _dc.field(default=True)
    indent : bool = _dc.field(default=False)
    indent_step : int = _dc.field(default=2)
    debug : bool = _dc.field(default=False)

ScrubbingReferenceOptions = ["jumps", "actions", "reqs"]
ScrubbingDynamicOpts = ["styles", "scripts", "iepragmas", "iframes", "prefetches", "tracking", "navigations"]

class CSSScrubbingError(Failure): pass

Scrubbers = tuple[
    _t.Callable[[str, URLRemapper, Headers, _t.Iterator[HTML5Node]], _t.Iterator[HTML5Node]],
    _t.Callable[[str, URLRemapper, Headers, _t.Iterator[CSSNode]], list[CSSNode]],
]

ie_pragma_re = _re.compile(r"^\s*(\[if IE [^]]*\].*\[endif\]|\[if !IE\]><!|<!\[endif\])\s*$")

jump_ref : RefType = (LinkType.JUMP, page_mime)
action_ref : RefType = (LinkType.ACTION, page_mime)

attr_ref_type : dict[HTML5NodeAttr, RefType]
attr_ref_type = {
    (htmlns_a,      href_attr): jump_ref,
    (htmlns_area,   href_attr): jump_ref,
    #(htmlns_base,   href_attr): handled_separately,
    (htmlns_blockquote, cite_attr): jump_ref,
    (htmlns_del,    cite_attr): jump_ref,
    (htmlns_ins,    cite_attr): jump_ref,
    #(htmlns_link,   href_attr): handled_separately,
    (htmlns_object, data_attr): jump_ref,
    (htmlns_q,      cite_attr): jump_ref,

    (htmlns_a,      ping_attr): action_ref,
    (htmlns_area,   ping_attr): action_ref,
    (htmlns_button, formaction_attr): action_ref,
    (htmlns_form,   action_attr): action_ref,
    (htmlns_input,  formaction_attr): action_ref,

    (htmlns_audio,  src_attr): (LinkType.REQ, audio_mime + audio_video_mime),
    (htmlns_embed,  src_attr): (LinkType.REQ, ["application/octet-stream"]),
    (htmlns_frame,  src_attr): (LinkType.REQ, page_mime),
    (htmlns_iframe, src_attr): (LinkType.REQ, page_mime),
    (htmlns_img,    src_attr): (LinkType.REQ, image_mime),
    #(htmlns_img,    srcset_attr): handled_separately,
    (htmlns_input,  src_attr): (LinkType.REQ, image_mime),
    (htmlns_script, src_attr): (LinkType.REQ, script_mime),
    (htmlns_source, src_attr): (LinkType.REQ, media_mime),
    (htmlns_track,  src_attr): (LinkType.REQ, track_mime),
    (htmlns_video,  poster_attr): (LinkType.REQ, image_mime),
    (htmlns_video,  src_attr): (LinkType.REQ, video_mime + audio_video_mime),
}

prefetch_link_rels = frozenset([
    "dns-prefetch", "preconnect", "prefetch", "prerender", "preload", "modulepreload",
])

stylesheet_link_rels = frozenset([
    "stylesheet",
    "ie-optimized-stylesheet-desk", "ie-optimized-onevent-stylesheet",
    "kinetic-stylesheet",
])

icon_link_rels = frozenset([
    "icon", "shortcut",
    "apple-touch-icon", "apple-touch-startup-image", "apple-touch-icon-precomposed",
    "fluid-icon", "mask-icon", "rich-pin-icon",
])

link_rel_ref_type : dict[str, RefType]
link_rel_ref_type = {}
for e in stylesheet_link_rels:
    link_rel_ref_type[e] = (LinkType.REQ, stylesheet_mime)
for e in icon_link_rels:
    link_rel_ref_type[e] = (LinkType.REQ, image_mime)

tracking_node_attrs = frozenset([
    (htmlns_a,    ping_attr),
    (htmlns_area, ping_attr),
])

cors_node_attrs = frozenset([
    (htmlns_audio,  crossorigin_attr),
    (htmlns_img,    crossorigin_attr),
    (htmlns_link,   crossorigin_attr),
    (htmlns_script, crossorigin_attr),
    (htmlns_video,  crossorigin_attr),
])

sri_node_attrs = frozenset([
    (htmlns_link,   integrity_attr),
    (htmlns_script, integrity_attr),
    (htmlns_style,  integrity_attr),

    (htmlns_script, nonce_attr),
    (htmlns_style,  nonce_attr),
])

def make_scrubbers(opts : ScrubbingOptions) -> Scrubbers:
    attr_blacklist : set[HTML5NodeAttr] = set()
    if not opts.tracking:
        attr_blacklist.update(tracking_node_attrs)
    attr_blacklist.update(cors_node_attrs)
    attr_blacklist.update(sri_node_attrs)

    link_rel_blacklist : set[str] = set()
    if not opts.styles:
        link_rel_blacklist.update(stylesheet_link_rels)
    if not opts.prefetches:
        link_rel_blacklist.update(prefetch_link_rels)

    jumps = opts.jumps
    actions = opts.actions
    reqs = opts.reqs
    yes_styles = opts.styles
    not_styles = not yes_styles
    yes_scripts = opts.scripts
    not_scripts = not yes_scripts
    not_iepragmas = not opts.iepragmas
    not_iframes = not opts.iframes
    yes_navigations = opts.navigations
    yes_interpret_noscript = opts.interpret_noscript
    yes_verbose = opts.verbose
    not_verbose = not yes_verbose
    not_whitespace = not opts.whitespace
    yes_indent = opts.indent
    indent_step = opts.indent_step

    def remap_link_maybe(base_url : str,
                         link_type : LinkType,
                         fallbacks : list[str],
                         remap_url : URLRemapper,
                         url : str) -> str | None:
        try:
            url = _up.urljoin(base_url, url)
        except ValueError:
            return None

        if is_data_url(url):
            return url

        if is_script_url(url) and not_scripts:
            return None

        rt : RemapType
        if link_type == LinkType.JUMP:
            rt = jumps
        elif link_type == LinkType.ACTION:
            rt = actions
        else:
            rt = reqs

        if rt == RemapType.ID:
            return url
        elif rt == RemapType.VOID:
            return None

        rurl : str | None = None
        if remap_url is not None:
            rurl = remap_url(link_type, None if rt != RemapType.FALLBACK else fallbacks, url)

        if rurl is not None:
            return rurl
        elif rt == RemapType.OPEN:
            return url
        else: # rt == RemapType.CLOSED or rt == RemapType.FALLBACK
            return None

    def remap_link_or_void(base_url : str,
                           link_type : LinkType,
                           fallbacks : list[str],
                           remap_url : URLRemapper,
                           url : str) -> str:
        res = remap_link_maybe(base_url, link_type, fallbacks, remap_url, url)
        if res is None:
            return get_void_url(link_type)
        return res

    def scrub_css(base_url : str,
                  remap_url : URLRemapper,
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

        def at_import_prelude(nodes : _t.Iterator[CSSNode]) -> _t.Iterator[CSSNode]:
            # map `@import "url.css" rest` -> `@import url("url.css") rest`
            done = False
            for node in nodes:
                if done:
                    yield node
                    continue

                if isinstance(node, _tcss.ast.StringToken):
                    node = _tcss.ast.FunctionBlock(node.source_line, node.source_column, "url", [node])
                    done = True
                elif isinstance(node, (_tcss.ast.URLToken, _tcss.ast.FunctionBlock)):
                    done = True

                yield node

        # walk the AST tree recursively
        for node in nodes:
            if isinstance(node, (_tcss.ast.QualifiedRule, _tcss.ast.AtRule)):
                emit_indent()
                if isinstance(node, _tcss.ast.AtRule) and node.lower_at_keyword == "import":
                    prelude = at_import_prelude(node.prelude)
                else:
                    prelude = node.prelude
                node.prelude = scrub_css(base_url, remap_url, prelude)
                if node.content is not None:
                    if current is not None:
                        try:
                            content = scrub_css(base_url, remap_url, _tcss.parse_blocks_contents(node.content), current + 1, True)
                        except CSSScrubbingError:
                            # it does not parse, scrub the tokens instead
                            content = scrub_css(base_url, remap_url, node.content)
                        node.content = \
                            [_tcss.ast.WhitespaceToken(0, 0, "\n")] + \
                            content + \
                            [_tcss.ast.WhitespaceToken(0, 0, "\n" + " " * (indent_step * current))]
                        del content
                    else:
                        # NB: no need to parse with `_tcss.parse_blocks_contents` in this case
                        node.content = scrub_css(base_url, remap_url, node.content)
            elif isinstance(node, _tcss.ast.Declaration):
                emit_indent()
                node.value = scrub_css(base_url, remap_url, node.value)
            elif isinstance(node, _tcss.ast.URLToken):
                # remap the URL
                url = remap_link_or_void(base_url, LinkType.REQ, css_url_mime, remap_url, node.value)
                rep = f"url({_tcss.serializer.serialize_url(url)})"
                node.value = url
                node.representation = rep
            elif isinstance(node, _tcss.ast.FunctionBlock):
                if node.lower_name == "url":
                    # technically, this is a bug in the CSS we are processing, but browsers work around this, so do we
                    url = remap_link_or_void(base_url, LinkType.REQ, css_url_mime, remap_url, "".join([n.value for n in node.arguments if n.type == "string"]))
                    rep = f"url({_tcss.serializer.serialize_url(url)})"
                    res.append(_tcss.ast.URLToken(node.source_line, node.source_column, url, rep))
                    continue
                node.arguments = scrub_css(base_url, remap_url, node.arguments)
            elif isinstance(node, (_tcss.ast.ParenthesesBlock, _tcss.ast.SquareBracketsBlock, _tcss.ast.CurlyBracketsBlock)):
                node.content = scrub_css(base_url, remap_url, node.content)
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
                    newline = False
                    continue
                res.append(node)
                newline = node.value.endswith("\n")
                continue

            res.append(node)
            newline = False
        return res

    def goes_before_inlines(nn : HTML5NN, attrs : HTML5NodeAttrValues) -> bool:
        """Should this `<html><head>` tag go before the ones produced by `headers_to_meta_http_equiv`?"""
        if nn == htmlns_base or nn == htmlns_title:
            return True
        elif nn == htmlns_meta:
            if (None, "charset") in attrs:
                return True
            he = attrs.get(http_equiv_attr, None)
            if he is not None and he.lower() == "content-type":
                return True
        return False

    def link_rels_of(rels : str) -> list[str]:
        rparts = map(lambda x: x.lower(), word_re.findall(rels))
        return [r for r in rparts if r not in link_rel_blacklist]

    def rel_ref_type_of(link_rels : list[str]) -> RefType:
        slink_type = None
        cts = []
        for rel in link_rels:
            link_type_, cts_ = link_rel_ref_type.get(rel, jump_ref)
            if slink_type is None or link_type_ == LinkType.REQ:
                slink_type = link_type_
            cts += [e for e in cts_ if e not in cts]
        link_type = slink_type if slink_type is not None else LinkType.JUMP
        return link_type, cts

    def scrub_html(orig_base_url : str,
                   remap_url : URLRemapper,
                   headers : Headers,
                   walker : _t.Iterator[HTML5Node]) -> _t.Iterator[HTML5Node]:
        censor_lvl : int = 0
        stack : list[HTML5NN] = []

        assemble : HTML5Node | None
        assemble = None
        assemble_contents : list[str] = []

        # `inline_headers` handling
        inline_headers_undone = True

        # `<base>` tag handling
        base_url = orig_base_url
        base_url_unset = True

        def emit_censored_comment(what : str) -> _t.Iterator[HTML5Node]:
            yield {"type": "Comment", "data": f" hoardy-web censored out {what.replace('-->', '-- >')} from here "}

        def emit_censored_token(typ : str, token : HTML5Node) -> _t.Iterator[HTML5Node]:
            if not_verbose: return
            res = [typ]
            tn = token.get("name", None)
            if tn is not None:
                res.append(tn)
            if tn == "link":
                rels = token.get("data", {}).get(rel_attr, None)
                if rels is not None:
                    res.append(rels)
            yield from emit_censored_comment(" ".join(res))

        def emit_censored_other(what : str) -> _t.Iterator[HTML5Node]:
            if not_verbose: return
            yield from emit_censored_comment(what)

        backlog : list[HTML5Node] = []
        witer = iter(walker)

        while True:
            if len(backlog) > 0:
                token = backlog.pop(0)
            else:
                try:
                    token = next(witer)
                except StopIteration:
                    break

            typ = token["type"]

            if assemble is not None and (typ == "Characters" or typ == "SpaceCharacters"):
                assemble_contents.append(token["data"])
                continue
            elif not_iepragmas and typ == "Comment" and ie_pragma_re.match(token["data"]):
                yield from emit_censored_other("a comment with an IE pragma")
                continue

            in_head = stack == [htmlns_html, htmlns_head]
            censor = censor_lvl != 0

            if typ == "StartTag" or typ == "EmptyTag":
                nn = (token["namespace"], token["name"])
                attrs : HTML5NodeAttrValues = token["data"]

                if not_scripts and yes_interpret_noscript and nn == htmlns_noscript:
                    # ignore this
                    yield from emit_censored_token(typ, token)
                    continue

                # Handle HTTP header inlining.
                # Put them after `<base>`, `<title>`, and charset-controlling `<meta>` headers.
                if inline_headers_undone and \
                   not goes_before_inlines(nn, attrs) and \
                   in_head:
                    # inline them before this token
                    backlog = list(headers_to_meta_http_equiv(headers)) + [token] + backlog
                    inline_headers_undone = False
                    continue

                # handle <base ...> tag
                if base_url_unset and \
                   nn == htmlns_base and \
                   in_head:
                    href = map_optional(lambda x: x.strip(), attrs.get(href_attr, None))
                    if href is not None:
                        # add root slash to the URL if it's missing one
                        purl = _up.urlsplit(href)
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
                    censor = True

                if not censor and nn == htmlns_meta and http_equiv_attr in attrs:
                    kind = attrs[http_equiv_attr].lower()
                    content = attrs.get(content_attr, None)
                    # NB: These are always rebased onto `orig_base_url`, not the `base_url`.
                    if kind in ["content-type", "x-ua-compatible", "default-style"] and content is not None:
                        # simply accept these
                        pass
                    elif kind == "refresh" and content is not None:
                        if yes_navigations:
                            osecs, href = parse_refresh_header(content)
                            if osecs is not None:
                                if href is None:
                                    attrs[content_attr] = str(osecs)
                                else:
                                    href = remap_link_maybe(orig_base_url, LinkType.JUMP, page_mime, remap_url, href)
                                    if href is not None and is_page_url(href):
                                        attrs[content_attr] = str(osecs) + ";url=" + href
                                    else:
                                        censor = True
                            else:
                                censor = True
                        else:
                            censor = True
                    elif kind == "link" and content is not None:
                        # replace this header with a sequence of `<link>` headers
                        nbacklog = []
                        for url, params in parse_link_header(content):
                            try:
                                url = _up.urljoin(orig_base_url, url)
                            except ValueError:
                                # the `url` is malformed
                                pass
                            else:
                                tattrs = _c.OrderedDict()
                                for k, v in params:
                                    nk = (None, k)
                                    # only the first value matters, href_attr is not allowed
                                    if nk in tattrs or nk == href_attr:
                                        continue
                                    tattrs[nk] = v
                                tattrs[href_attr] = url
                                nbacklog.append({"type": "EmptyTag", "namespace": htmlns, "name": "link", "data": tattrs})

                        if len(nbacklog) > 0:
                            # reset
                            backlog = nbacklog + backlog
                            continue
                        else:
                            censor = True
                    else:
                        # censor all others
                        censor = True
                    # TODO XXX: also parse and remap `content-security-policy`

                if not censor and \
                   (not_styles and nn == htmlns_style or \
                    not_scripts and nn == htmlns_script or \
                    not_iframes and nn == htmlns_iframe):
                    # censor these out quickly
                    censor = True

                new_attrs : _c.OrderedDict[HTML5NN, str | None] = _c.OrderedDict()
                if not censor and nn == htmlns_link:
                    # scrub `link` `rel` attributes
                    link_rels = link_rels_of(attrs.get(rel_attr, ""))
                    if len(link_rels) > 0:
                        # scrub `link` `href` attributes
                        href = map_optional(lambda x: x.strip(), attrs.get(href_attr, None))
                        if href is not None:
                            link_rels_set = set(link_rels)
                            if is_data_url(href) and not link_rels_set.isdisjoint(stylesheet_link_rels):
                                # handle stylsheets given as `data:` URLs.
                                # yes, this is actually allowed =/
                                try:
                                    href_mime, href_params, href_data = parse_data_url(href)
                                    href_mime = canonical_mime_of.get(href_mime, href_mime)
                                    if href_mime not in stylesheet_mime:
                                        raise ValueError("not a stylesheet")
                                    href_protocol_encoding = get_parameter(href_params, "charset", "utf-8")
                                    href_nodes, href_encoding = _tcss.parse_stylesheet_bytes(href_data, protocol_encoding=href_protocol_encoding)
                                    href_charset = href_encoding.name
                                    href_params = set_parameter(href_params, "charset", href_charset)
                                    href = unparse_data_url(href_mime, href_params, _tcss.serialize(scrub_css(base_url, remap_url, href_nodes, None)).encode(href_charset))
                                except (ParseError, ValueError):
                                    href = None
                            else:
                                link_type, cts = rel_ref_type_of(link_rels)
                                href = remap_link_maybe(base_url, link_type, cts, remap_url, href)
                    else:
                        href = None

                    new_attrs[rel_attr] = " ".join(link_rels)
                    new_attrs[href_attr] = href
                    if href is None:
                        # censor the whole tag in this case
                        censor = True

                if not censor:
                    # scrub other attributes
                    for ann, value in attrs.items():
                        nnann = (nn, ann)
                        if nnann in attr_blacklist or \
                           not_scripts and ann[0] is None and ann[1].startswith("on"):
                            # censor out blacklisted attrs,
                            # censor out javascript on* attributes, e.g. `onclick`
                            new_attrs[ann] = None
                        elif ann == style_attr:
                            # scrub inline styles
                            if yes_styles:
                                new_attrs[ann] = _tcss.serialize(scrub_css(base_url, remap_url, _tcss.parse_blocks_contents(value), 0 if yes_indent else None))
                            elif yes_verbose:
                                new_attrs[ann] = "/* hoardy-web censored out a CSS data from here */"
                            else:
                                new_attrs[ann] = None
                        elif ann == srcset_attr:
                            # scrub `srcset` attributes
                            new_srcset = []
                            for url, cond in parse_srcset_attr(value):
                                href = remap_link_maybe(base_url, LinkType.REQ, image_mime, remap_url, url)
                                if href is not None:
                                    new_srcset.append((href, cond))
                            new_attrs[ann] = unparse_srcset_attr(new_srcset) if len(new_srcset) > 0 else None
                        else:
                            # handle other attributes containing URLs
                            ref = attr_ref_type.get(nnann, None)
                            if ref is not None:
                                link_type, cts = ref
                                new_attrs[ann] = remap_link_maybe(base_url, link_type, cts, remap_url, value.strip())

                    # apply changes
                    for ann, ovalue in new_attrs.items():
                        if ovalue is not None:
                            attrs[ann] = ovalue
                        else:
                            try:
                                del attrs[ann]
                            except KeyError: pass

                if typ == "StartTag":
                    stack.append(nn)
                    if censor:
                        censor_lvl += 1

                    if nn == htmlns_style or nn == htmlns_script:
                        # start assembling contents
                        assemble = token
                        continue
            elif typ == "EndTag":
                # stop handling <base ...> tag
                if in_head:
                    # as a fallback, dump inlines here
                    if inline_headers_undone:
                        backlog = list(headers_to_meta_http_equiv(headers)) + [token] + backlog
                        inline_headers_undone = False
                        continue
                    base_url_unset = False

                nn = (token["namespace"], token["name"])

                if not_scripts and yes_interpret_noscript and nn == htmlns_noscript:
                    # ignore this
                    yield from emit_censored_token(typ, token)
                    continue

                stack_len = len(stack)
                if censor:
                    censor_lvl -= 1
                stack.pop()
                #print(stack)

                # scrub tag contents
                if assemble is not None:
                    if not censor:
                        assemble_nn = (assemble["namespace"], assemble["name"])
                        #assemble_attrs : _c.OrderedDict[HTML5NN, str] = assemble["data"]
                        adata = "".join(assemble_contents)

                        if assemble_nn == htmlns_style:
                            adata = _tcss.serialize(scrub_css(base_url, remap_url, _tcss.parse_stylesheet(adata), stack_len if not_whitespace else None))
                        # TODO: scrub_js goes here

                        if opt_whitespace_re.fullmatch(adata):
                            adata = ""
                        elif yes_indent:
                            adata = "\n" + " " * (2 * stack_len) + adata.strip() + "\n" + " " * (2 * (stack_len - 1))
                        elif not_whitespace:
                            adata = adata.strip()

                        yield assemble
                        yield {"type": "Characters", "data": adata}
                    else:
                        token = assemble
                        typ = "AssembledTag"

                    assemble = None
                    assemble_contents = []

            if censor:
                if typ != "SpaceCharacters":
                    yield from emit_censored_token(typ, token)
                continue

            yield token

    stages : list[_h5fb.Filter]
    stages = []

    if not opts.whitespace:
        stages.append(_h5ws.Filter)
    if opts.debug:
        stages.append(lambda x: prettify_html(opts.indent_step, True, x))
    elif opts.indent:
        stages.append(lambda x: prettify_html(opts.indent_step, False, x))
    if not opts.optional_tags:
        stages.append(_h5ot.Filter)

    pipe = make_func_pipe(stages)

    process_html = lambda base_url, remap_url, headers, walker: pipe(scrub_html(base_url, remap_url, headers, walker))
    process_css = lambda base_url, remap_url, headers, nodes: scrub_css(base_url, remap_url, nodes, 0 if yes_indent else None)
    return process_html, process_css

def scrub_css(scrubbers : Scrubbers,
              base_url : str,
              remap_url : URLRemapper,
              headers : Headers,
              body : str | bytes,
              protocol_encoding : str | None) -> bytes:
    if isinstance(body, bytes):
        nodes, encoding = _tcss.parse_stylesheet_bytes(body, protocol_encoding=protocol_encoding)
        charset = encoding.name
    else:
        nodes = _tcss.parse_stylesheet(body)
        charset = "utf-8"
    res = scrubbers[1](base_url, remap_url, headers, nodes)
    return _tcss.serialize(res).encode(charset) # type: ignore

_html5treebuilder = _h5.treebuilders.getTreeBuilder("etree", fullTree=True)
_html5parser = _h5.html5parser.HTMLParser(_html5treebuilder)
_html5walker = _h5.treewalkers.getTreeWalker("etree")
_html5serializer = _h5.serializer.HTMLSerializer(strip_whitespace = False, omit_optional_tags = False)

def scrub_html(scrubbers : Scrubbers,
               base_url : str,
               remap_url : URLRemapper,
               headers : Headers,
               body : str | bytes,
               protocol_encoding : str | None) -> bytes:
    if isinstance(body, bytes):
        dom = _html5parser.parse(body, likely_encoding=protocol_encoding)
        charset = _html5parser.tokenizer.stream.charEncoding[0].name
    else:
        dom = _html5parser.parse(body)
        charset = "utf-8"
    walker = scrubbers[0](base_url, remap_url, headers, _html5walker(dom))
    return _html5serializer.render(walker, charset) # type: ignore
