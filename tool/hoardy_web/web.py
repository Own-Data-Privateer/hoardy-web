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

class LinkType(_enum.Enum):
    JUMP = 0
    ACTION = 1
    REQ = 2

class RemapType(_enum.Enum):
    ID = 0
    VOID = 1
    OPEN = 2
    CLOSED = 3
    FALLBACK = 4

def get_void_url(link_type : LinkType) -> str:
    if link_type == LinkType.REQ:
        return "data:text/plain;base64,"
    else:
        return "javascript:void(0)"

URLRemapper = _t.Callable[[LinkType, list[str] | None, str], str | None] | None

HTML5Node = dict[str, _t.Any]
HTML5NN = tuple[str | None, str] # NN = namespaced name
HTML5NodeAttr = tuple[HTML5NN, HTML5NN] # tuple[namespaced token name, namespaced attribute name]
CSSNode : _t.TypeAlias = _tcss.ast.Node

htmlns = _h5.constants.namespaces["html"]
xlinkns = _h5.constants.namespaces["xlink"]
xmlns = _h5.constants.namespaces["xml"]

htmlns_html = (htmlns, "html")
htmlns_head = (htmlns, "head")
htmlns_body = (htmlns, "body")

def in_head(stack : list[HTML5NN]) -> bool:
    return stack == [htmlns_html, htmlns_head]

htmlns_a = (htmlns, "a")
htmlns_area = (htmlns, "area")
htmlns_audio = (htmlns, "audio")
htmlns_base = (htmlns, "base")
htmlns_blockquote = (htmlns, "blockquote")
htmlns_button = (htmlns, "button")
htmlns_del = (htmlns, "del")
htmlns_embed = (htmlns, "embed")
htmlns_form = (htmlns, "form")
htmlns_iframe = (htmlns, "iframe")
htmlns_img = (htmlns, "img")
htmlns_input = (htmlns, "input")
htmlns_ins = (htmlns, "ins")
htmlns_link = (htmlns, "link")
htmlns_meta= (htmlns, "meta")
htmlns_object = (htmlns, "object")
htmlns_q = (htmlns, "q")
htmlns_script = (htmlns, "script")
htmlns_source = (htmlns, "source")
htmlns_style = (htmlns, "style")
htmlns_title = (htmlns, "title")
htmlns_track = (htmlns, "track")
htmlns_video = (htmlns, "video")

def debug_walker(walker : _t.Iterator[HTML5Node]) -> _t.Iterator[HTML5Node]:
    for token in walker:
        print(token)
        yield token

# HTML elements that must preserve space
_spacePreserveElements = _h5ws.Filter.spacePreserveElements
# HTML elements that ignore space completely (and so it can be added or removed arbitrarily)
_space_okElements = frozenset(["html", "head", "frameset"])

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
        if tp in _space_okElements:
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

RelRefType = tuple[LinkType, list[str]]
jump_ref : RelRefType = (LinkType.JUMP, page_mime)
action_ref : RelRefType = (LinkType.ACTION, page_mime)

ref_types_of_node_attrs : dict[HTML5NodeAttr, RelRefType]
ref_types_of_node_attrs = {
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

link_node_attrs : frozenset[HTML5NodeAttr]
link_node_attrs = frozenset([
    (htmlns_link, href_attr),
])

rel_ref_types : dict[str, RelRefType]
rel_ref_types = {
    "stylesheet": (LinkType.REQ, stylesheet_mime),
    "icon":       (LinkType.REQ, image_mime),
    "shortcut":   (LinkType.REQ, image_mime),
}

srcset_node_attrs = frozenset([
    (htmlns_img,  srcset_attr),
])

tracking_node_attrs = frozenset([
    (htmlns_a,    ping_attr),
    (htmlns_area, ping_attr),
])

prefetch_link_rels = frozenset([
    "dns-prefetch", "preconnect", "prefetch", "prerender", "preload", "modulepreload",
])

stylesheet_link_rels = frozenset([
    "stylesheet", "ie-optimized-stylesheet-desk", "ie-optimized-onevent-stylesheet",
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

ie_pragma_re = _re.compile(r"^\s*(\[if IE [^]]*\].*\[endif\]|\[if !IE\]><!|<!\[endif\])\s*$")

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
    verbose : bool = _dc.field(default=False)
    whitespace : bool = _dc.field(default=False)
    optional_tags : bool = _dc.field(default=True)
    indent : bool = _dc.field(default=False)
    indent_step : int = _dc.field(default=2)
    debug : bool = _dc.field(default=False)

ScrubbingReferenceOptions = ["jumps", "actions", "reqs"]
ScrubbingDynamicOpts = ["styles", "scripts", "iepragmas", "iframes", "prefetches", "tracking", "navigations"]

Scrubbers = tuple[
    _t.Callable[[str, URLRemapper, Headers, _t.Iterator[HTML5Node]], _t.Iterator[HTML5Node]],
    _t.Callable[[str, URLRemapper, Headers, _t.Iterator[CSSNode]], list[CSSNode]],
]

class CSSScrubbingError(Failure): pass

def make_scrubbers(opts : ScrubbingOptions) -> Scrubbers:
    attr_blacklist : set[HTML5NodeAttr] = set()
    attr_blacklist.update(cors_node_attrs)
    attr_blacklist.update(sri_node_attrs)
    if not opts.tracking:
        attr_blacklist.update(tracking_node_attrs)

    link_rel_blacklist : set[str] = set()
    if not opts.styles:
        link_rel_blacklist.update(stylesheet_link_rels)
    if not opts.prefetches:
        link_rel_blacklist.update(prefetch_link_rels)

    jumps = opts.jumps
    actions = opts.actions
    reqs = opts.reqs
    not_styles = not opts.styles
    not_scripts = not opts.scripts
    not_iepragmas = not opts.iepragmas
    not_iframes = not opts.iframes
    yes_navigations = opts.navigations
    yes_verbose = opts.verbose
    not_verbose = not opts.verbose
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
            # the `url` is malformed
            return None

        if url.startswith("javascript:"):
            if not_scripts:
                return "javascript:void(0)"
            else:
                return url
        elif url.startswith("data:"):
            return url

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

    def remap_link(base_url : str,
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

        # walk the AST tree recursively
        for node in nodes:
            if isinstance(node, (_tcss.ast.QualifiedRule, _tcss.ast.AtRule)):
                emit_indent()
                node.prelude = scrub_css(base_url, remap_url, node.prelude)
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
                url = remap_link(base_url, LinkType.REQ, css_url_mime, remap_url, node.value)
                rep = f"url({_tcss.serializer.serialize_url(url)})"
                node.value = url
                node.representation = rep
            elif isinstance(node, _tcss.ast.FunctionBlock):
                if node.lower_name == "url":
                    # technically, this is a bug in the CSS we are processing, but browsers work around this, so do we
                    url = remap_link(base_url, LinkType.REQ, css_url_mime, remap_url, "".join([n.value for n in node.arguments if n.type == "string"]))
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

    def goes_before_inlines(nn : HTML5NN, attrs : _c.OrderedDict[HTML5NN, str]) -> bool:
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
        rparts = word_re.findall(rels)
        return [r for r in rparts if r not in link_rel_blacklist]

    def rel_ref_type_of(link_rels : list[str]) -> RelRefType:
        slink_type = None
        cts = []
        for rel in link_rels:
            link_type_, cts_ = rel_ref_types.get(rel, jump_ref)
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

        assembling = False
        contents : list[str] = []

        # `inline_headers` handling
        inline_headers_undone = True

        # `<base>` tag handling
        base_url = orig_base_url
        base_url_unset = True

        def emit_censored(why : str) -> _t.Iterator[HTML5Node]:
            if yes_verbose:
                yield {"type": "Comment", "data": f" hoardy-web censored out {why} from here "}

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

            if assembling and (typ == "Characters" or typ == "SpaceCharacters"):
                contents.append(token["data"])
                continue

            censoring = censor_lvl != 0
            if censoring and len(contents) > 0:
                yield from emit_censored("character data")
                contents = []

            if typ == "StartTag" or typ == "EmptyTag":
                nn = (token["namespace"], token["name"])
                attrs : _c.OrderedDict[HTML5NN, str] = token["data"]

                # Handle HTTP header inlining.
                # Put them after `<base>`, `<title>`, and charset-controlling `<meta>` headers.
                if inline_headers_undone and \
                   not goes_before_inlines(nn, attrs) and \
                   in_head(stack):
                    # inline them before this token
                    backlog = list(headers_to_meta_http_equiv(headers)) + [token] + backlog
                    inline_headers_undone = False
                    continue

                # handle <base ...> tag
                if base_url_unset and \
                   nn == htmlns_base and \
                   in_head(stack):
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
                    censoring = True

                if not censoring and nn == htmlns_meta and http_equiv_attr in attrs:
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
                                    if href is not None:
                                        attrs[content_attr] = str(osecs) + ";url=" + href
                                    else:
                                        censoring = True
                            else:
                                censoring = True
                        else:
                            censoring = True
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
                            censoring = True
                    else:
                        # censor all others
                        censoring = True
                    # TODO XXX: also parse and remap `content-security-policy`

                link_rels = []
                if not censoring:
                    if not_scripts and nn == htmlns_script or \
                       not_iframes and nn == htmlns_iframe or \
                       not_styles and nn == htmlns_style:
                        # censor the whole tag
                        censoring = True
                    elif nn == htmlns_link:
                        # censor link rel attributes
                        link_rels = map_optionals(link_rels_of, attrs.get(rel_attr, None))
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
                        ref = ref_types_of_node_attrs.get(nnann, None)
                        if ref is not None:
                            # turn relative URLs into absolute ones, and then mangle them with remap_url
                            link_type, cts = ref
                            attrs[ann] = remap_link(base_url, link_type, cts, remap_url, value.strip())
                        elif nnann in link_node_attrs:
                            # similarly for `link`s, except `link_type` and `fallbacks` depend on `rel` attribute value
                            link_type, cts = rel_ref_type_of(link_rels)
                            attrs[ann] = remap_link(base_url, link_type, cts, remap_url, value.strip())
                        elif nnann in srcset_node_attrs:
                            # similarly
                            srcset = parse_srcset_attr(value)
                            new_srcset = []
                            for url, cond in srcset:
                                url = remap_link(base_url, LinkType.REQ, image_mime, remap_url, url)
                                new_srcset.append((url, cond))
                            attrs[ann] = unparse_srcset_attr(new_srcset)
                            del srcset, new_srcset
                        elif ann == style_attr:
                            attrs[ann] = _tcss.serialize(scrub_css(base_url, remap_url, _tcss.parse_blocks_contents(value), 0 if yes_indent else None))

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
                if in_head(stack):
                    # as a fallback, dump inlines here
                    if inline_headers_undone:
                        backlog = list(headers_to_meta_http_equiv(headers)) + [token] + backlog
                        inline_headers_undone = False
                        continue
                    base_url_unset = False
                # scrub <style> contents
                elif assembling:
                    assembling = False
                    data = "".join(contents)
                    contents = []
                    stack_len = len(stack)
                    data = _tcss.serialize(scrub_css(base_url, remap_url, _tcss.parse_stylesheet(data), stack_len if not_whitespace else None))
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
              protocol_encoding : str | None) -> str:
    if isinstance(body, str):
        nodes = _tcss.parse_stylesheet(body)
    else:
        nodes, encoding = _tcss.parse_stylesheet_bytes(body, protocol_encoding=protocol_encoding)
    res = scrubbers[1](base_url, remap_url, headers, nodes)
    return _tcss.serialize(res) # type: ignore

_html5treebuilder = _h5.treebuilders.getTreeBuilder("etree", fullTree=True)
_html5parser = _h5.html5parser.HTMLParser(_html5treebuilder)
_html5walker = _h5.treewalkers.getTreeWalker("etree")
_html5serializer = _h5.serializer.HTMLSerializer(strip_whitespace = False, omit_optional_tags = False)

def scrub_html(scrubbers : Scrubbers,
               base_url : str,
               remap_url : URLRemapper,
               headers : Headers,
               body : str | bytes,
               protocol_encoding : str | None) -> str:
    dom = _html5parser.parse(body, likely_encoding=protocol_encoding)
    charEncoding = _html5parser.tokenizer.stream.charEncoding[0]
    walker = scrubbers[0](base_url, remap_url, headers, _html5walker(dom))
    return _html5serializer.render(walker, charEncoding.name) # type: ignore
