# Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
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

"""MIME types normalization and sniffing.

  In general, this follows https://mimesniff.spec.whatwg.org/ but
  usually does more than mimesniff requires.
"""

import enum as _enum
import re as _re
import typing as _t

from kisstdlib.exceptions import *

from .wire import parse_content_type_header

canonical_mime_of : dict[str, str]
canonical_mime_of = {
    "application/x-grip": "application/gzip",

    "application/rar-compressed": "application/rar",
    "application/x-rar": "application/rar",
    "application/x-rar-compressed": "application/rar",

    "application/font-cff": "font/otf",
    "application/font-off": "font/otf",
    "application/font-sfnt": "font/otf",
    "application/vnd.ms-fontobject": "font/otf",
    "application/vnd.ms-opentype": "font/otf",
    "font/sfnt": "font/otf",

    "application/font-ttf": "font/ttf",

    "application/font-woff": "font/woff",
    "application/font-woff2": "font/woff2",

    "image/jpg": "image/jpeg",

    "application/ecmascript": "text/javascript",
    "application/javascript": "text/javascript",
    "application/x-ecmascript": "text/javascript",
    "application/x-javascript": "text/javascript",
    "text/ecmascript": "text/javascript",
    "text/javascript1.0": "text/javascript",
    "text/javascript1.1": "text/javascript",
    "text/javascript1.2": "text/javascript",
    "text/javascript1.3": "text/javascript",
    "text/javascript1.4": "text/javascript",
    "text/javascript1.5": "text/javascript",
    "text/jscript": "text/javascript",
    "text/livescript": "text/javascript",
    "text/x-ecmascript": "text/javascript",
    "text/x-javascript": "text/javascript",

    "application/json": "text/json",

    "application/xml": "text/xml",
}

def canonicalize_mime(mime : str) -> str:
    return canonical_mime_of.get(mime, mime)

mime_info_of : dict[str, tuple[list[str], list[str]]]
mime_info_of = {
    "application/gzip": (["archive"], [".gz", ".gzip"]),
    "application/ogg": (["audio", "video"], [".ogg"]),
    "application/pdf": (["dyndoc"], [".pdf"]),
    "application/postscript": (["dyndoc"], [".ps"]),
    "application/rar": (["archive"], [".rar"]),
    "application/zip": (["archive", "dyndoc"], [".zip", ".epub", ".apk"]), # "dyndoc" because of EPUB
    "audio/aiff": (["audio"], [".aif", ".aiff", ".aifc"]),
    "audio/midi": (["audio"], [".mid", ".midi"]),
    "audio/mpeg": (["audio"], [".mp3"]),
    "audio/wave": (["audio"], [".wav", ".pcm"]),
    "font/collection": (["font"], [".ttc"]),
    "font/otf": (["font"], [".otf", ".ttf"]), # OpenType is an extension of TrueType
    "font/ttf": (["font"], [".ttf", ".otf"]), # their extensions are frequently mixed up
    "font/woff": (["font"], [".woff"]),
    "font/woff2": (["font"], [".woff2"]),
    "image/bmp": (["image"], [".bmp"]),
    "image/gif": (["image"], [".gif"]),
    "image/jpeg": (["image"], [".jpg", ".jpeg"]),
    "image/png": (["image"], [".png"]),
    "image/svg+xml": (["image", "xml", "text"], [".svg"]),
    "image/webp": (["image"], [".webp"]),
    "image/x-icon": (["image"], [".ico"]),
    "text/css": (["css", "text"], [".css", ".mcss"]),
    "text/html": (["html", "text"], [".htm", ".html", ".xhtm", ".xhtml"]),
    "text/javascript": (["javascript", "text"], [".js", ".mjs"]),
    "text/json": (["json", "text"], [".json"]),
    "text/plain": (["text"], [".txt"]),
    "text/vtt": (["media", "text"], [".vtt"]),
    "text/xml": (["xml", "text"], [".xml"]),
    "video/avi": (["video"], [".avi"]),
    "video/mp4": (["video"], [".mp4"]),
    "video/webm": (["video"], [".webm"]),
}

# extension -> list[content_type]
possible_mimes_of_ext : dict[str, list[str]]
possible_mimes_of_ext = {}

for ct, (kinds, exts) in mime_info_of.items():
    for ext in exts:
        try:
            ms = possible_mimes_of_ext[ext]
        except KeyError:
            ms = []
            possible_mimes_of_ext[ext] = ms
        ms.append(ct)

unknown_binary = ["unknown", "image", "audio", "video", "font", "dyndoc", "archive"]
any_text = ["text", "javascript", "css", "json"]
any_text_ext = [".txt", ".js", ".mjs" ".css", ".mcss", ".json"]

html_mime = ["text/html"]
stylesheet_mime = ["text/css"]
script_mime = ["text/javascript"]

image_mime = [
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/webp",
    "image/x-icon",
]

audio_mime = [
    "audio/aiff",
    "audio/midi",
    "audio/mpeg",
    "audio/wave",
]

video_mime = [
    "video/avi",
    "video/mp4",
    "video/webm",
]

font_mime = [
    "font/collection",
    "font/otf",
    "font/ttf",
    "font/woff",
    "font/woff2",
]

# these can contain one or both of audio and video
audio_video_mime = [
    "application/ogg",
]

track_mime = ["text/vtt"]

media_mime = image_mime + audio_mime + video_mime + audio_video_mime
page_mime = html_mime + media_mime
css_url_mime = image_mime + font_mime
any_mime = page_mime + track_mime + stylesheet_mime + script_mime + ["application/octet-stream"]

buggy_content_type = frozenset([
    # These headers are generated by buggy Apache versions,
    # see https://mimesniff.spec.whatwg.org/
    "text/plain",
    "text/plain; charset=ISO-8859-1",
    "text/plain; charset=iso-8859-1",
    "text/plain; charset=UTF-8",
])

def _unknown_binary() \
    -> tuple[list[str], str, str | None, list[str]]:
    return unknown_binary, "application/octet-stream", None, []

def normalize_content_type(header : str) \
    -> tuple[list[str] | None, str, str | None, list[str]]:
    """Parse and normalize "Content-type" header,
       return (possible kinds | None, MIME type, charset | None, extensions).
    """

    ct, params = parse_content_type_header(header)
    charset = None
    for name, value in params:
        if name == "charset":
            charset = value

    if header in buggy_content_type:
        # force content sniffing
        return None, ct, charset, []

    ct = canonicalize_mime(ct)
    try:
        kinds, exts = mime_info_of[ct]
    except KeyError:
        pass
    else:
        return kinds, ct, charset, exts

    if ct == "application/octet-stream":
        return _unknown_binary()
    elif ct.startswith("image/"):
        return ["image"], ct, charset, []
    elif ct.startswith("audio/"):
        return ["audio"], ct, charset, []
    elif ct.startswith("video/"):
        return ["video"], ct, charset, []
    elif ct.startswith("font/") or ct.startswith("application/font-"):
        return ["font"], ct, charset, []
    elif ct.endswith("+zip"):
        kinds, exts = mime_info_of["application/zip"]
        return kinds, ct, charset, exts
    elif ct.endswith("+xml"):
        kinds, exts = mime_info_of["text/xml"]
        return kinds, ct, charset, exts
    elif ct.endswith("+json"):
        kinds, exts = mime_info_of["text/json"]
        return kinds, ct, charset, exts

    return None, ct, charset, []

_pre = r"(?:\ufeff|\s)*"
html_sniff_re = _re.compile(rf"^{_pre}(?:<\?xml(?:\s[^>]*)?>\s*)?(?:<!--[\s\S]*-->\s*)*<(?:!doctype\shtml|html|head|meta|link|title|body|frameset|frame|iframe|style|font|script|header|nav|article|section|footer|table|thead|tbody|tfoot|th|tr|td|h1|h2|h3|h4|h5|div|p|span|b|strong|i|em|strike|br|a)(?:\s[^>]*)?>", flags=_re.IGNORECASE)
svg_sniff_re = _re.compile(rf"^{_pre}(?:<\?xml(?:\s[^>]*)?>\s*)?(?:<!--[\s\S]*-->\s*)*<svg(?:\s[^>]*)?>", flags=_re.IGNORECASE)
xml_sniff_re = _re.compile(rf"^{_pre}<\?xml(?:\s[^>]*)?>", flags=_re.IGNORECASE)

def sniff_mime_type(data : str | bytes, charset : str | None) \
    -> tuple[list[str], str, str | None, list[str]]:
    """Sniff MIME type value from given file content or file content prefix,
       returns (possible kinds, MIME type, extensions, charset | None).
    """

    ct : str | None = None
    if isinstance(data, bytes):
        # image
        if data.startswith(b"GIF87a") and data.startswith(b"GIF89a"):
            ct = "image/gif"
        elif data.startswith(b"RIFF") and data[8:14] == b"WEBPVP":
            ct = "image/webp"
        elif data.startswith(b"\x89PNG\x0d\x0a\x1a\x0a"):
            ct = "image/png"
        elif data.startswith(b"\xff\xd8\xff") and data[6:10] == b"JFIF":
            ct = "image/jpeg"
        # audio and video
        elif data.startswith(b"FORM") and data[8:12] == b"AIFF":
            ct = "audio/aiff"
        elif data.startswith(b"ID3"):
            ct = "audio/mpeg"
        elif data.startswith(b"OggS\x00"):
            ct = "application/ogg"
        elif data.startswith(b"MThd\x00\x00\x00\x06"):
            ct = "audio/midi"
        elif data.startswith(b"RIFF") and data[8:12] == b"WAVE":
            ct = "audio/wave"
        elif data.startswith(b"RIFF") and data[8:12] == b"AVI ":
            ct = "video/avi"
        # fonts
        elif data.startswith(b"ttcf"):
            ct = "font/collection"
        elif data.startswith(b"OTTO"):
            ct = "font/otf"
        elif data.startswith(b"wOFF"):
            ct = "font/woff"
        elif data.startswith(b"wOF2"):
            ct = "font/woff2"
        # documents
        elif data.startswith(b"%PDF-"):
            ct = "application/pdf"
        elif data.startswith(b"%!PS-Adobe-"):
            ct = "application/postscript"
        # archives
        elif data.startswith(b"\x1f\x8b\x08"):
            ct = "application/gzip"
        elif data.startswith(b"PK\x03\x04"):
            ct = "application/zip"
        elif data.startswith(b"Rar \x1a\x07\x00"):
            ct = "application/rar"

        if ct is not None:
            kinds, exts = mime_info_of[ct]
            return kinds, ct, None, exts

        # now, less certain ones
        # image
        if data.startswith(b"\x00\x00\x01\x00") or data.startswith(b"\x00\x00\x02\x00"):
            ct = "image/x-icon"
        elif data.startswith(b"BM"):
            ct = "image/bmp"
        elif data.startswith(b"\xff\xd8\xff"):
            ct = "image/jpeg"
        # font
        elif data.startswith(b"\x00\x01\x00\x00"):
            ct = "font/ttf"
        elif data[34:36] == b"LP":
            ct = canonicalize_mime("application/vnd.ms-fontobject")

        if ct is not None:
            kinds, exts = mime_info_of[ct]
            return kinds + ["unknown"], ct, None, exts

        # TODO mp3 and mp4 headers

        # text
        if charset is not None:
            # try the specified charset first
            try:
                data = data.decode(charset)
            except UnicodeDecodeError:
                # it's a lie
                charset = None

        if charset is None:
            assert type(data) is bytes

            # detect BOM marks
            if data.startswith(b"\xef\xbb\xbf"):
                charset = "utf-8"
            elif data.startswith(b"\xff\xfe"):
                charset = "utf-16le"
            elif data.startswith(b"\xfe\xff"):
                charset = "utf-16be"

            if charset is not None:
                # try decoding the final time
                try:
                    data = data.decode(charset)
                except UnicodeDecodeError:
                    return _unknown_binary()
            else:
                if data.find(b"\x00") != -1:
                    return _unknown_binary()

                # this appears to be text data in some unknown encoding,
                # decode into ascii with replacements so that we could
                # match it to detect markup via regexps below
                data = data.decode("ascii", "replace")
                # TODO: detect pure ascii and UTF-8 without replacements here too?

    assert type(data) is str
    assert ct is None

    if html_sniff_re.match(data):
        ct = "text/html"
    elif svg_sniff_re.match(data):
        ct = "image/svg+xml"
    elif xml_sniff_re.match(data):
        ct = "text/xml"

    if ct is not None:
        kinds, exts = mime_info_of[ct]
        return kinds, ct, charset, exts

    return any_text, "text/plain", charset, any_text_ext

def test_sniff_mime_type() -> None:
    def check(want_mime : str, data : bytes | str) -> None:
        kinds, mime, charset, extensions = sniff_mime_type(data, None)
        if mime != want_mime:
            raise CatastrophicFailure("while evaluating `sniff_mime_type` on %s, expected %s, got %s", data, want_mime, mime)

    check("text/html", "<!DOCTYPE html><html>")
    check("text/html", "\ufeff<!DOCTYPE html><html>")

    check("text/html", """<!DOCTYPE html>
<html>""")

    check("text/html", """
<!DOCTYPE html>
<html>""")

    check("text/html", """
<!DOCTYPE html>
<!-- comment -->
<html>""")

    check("text/html", """
<!-- comment -->
<!DOCTYPE html>
<html>""")

    check("text/html", """
<!-- multi
     line
     comment -->
<!DOCTYPE html>
<html>""")

    check("text/html", """
<!-- comment1 -->
<!-- comment2 -->
<!DOCTYPE html>
<html>""")

    check("text/html", """
<!-- comment
  <!-- in comment -->
     of comment -->
<!DOCTYPE html>
<html>""")

    check("text/html", """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">""")

    check("text/html", """<html style="" lang="en">""")

    check("text/html", """<a>test</a>""")

    check("image/svg+xml", """<?xml version="1.0" encoding="UTF-8"?><svg>""")

    check("image/svg+xml", """<?xml version="1.0" encoding="UTF-8"?>
<!-- comment -->
<svg>""")

    check("image/svg+xml", """<?xml version="1.0" encoding="UTF-8"?>
<!-- multi
     line
     comment -->
<svg>""")

    check("image/svg+xml", """<svg>""")

    check("text/xml", """<?xml version="1.0" encoding="UTF-8"?>""")

    check("text/xml", """<?xml version="1.0" encoding="UTF-8"?>
<!-- comment -->
<data>""")

    check("text/xml", """<?xml version="1.0" encoding="UTF-8"?>
<!-- multi
     line
     comment -->
<data>""")

    check("text/xml", """<?xml>""")

    check("text/plain", "example")

class SniffContentType(_enum.Enum):
    NONE = 0
    FORCE = 1
    PARANOID = 2

DiscernContentType = tuple[set[str], str, str | None, list[str]]
def discern_content_type(ct : str | None, sniff : SniffContentType, data : str | bytes) \
    -> DiscernContentType:
    """Given `Content-type` HTTP header, sniff value, and actual content body,
       return (possible kinds, MIME type, charset | None, extensions).
    """

    kinds : list[str] | None
    extensions : list[str]
    if ct is None:
        kinds, mime, charset, extensions = None, "application/octet-stream", None, []
    else:
        kinds, mime, charset, extensions = normalize_content_type(ct)

    if kinds is None:
        kinds, mime, charset, extensions = sniff_mime_type(data, charset)
        skinds = set(kinds)
    elif sniff != SniffContentType.NONE:
        kinds_, mime_, charset_, extensions_ = sniff_mime_type(data, charset)
        skinds = set(kinds)
        skinds_ = set(kinds_)
        if sniff == SniffContentType.PARANOID:
            # union possible interpretations
            skinds.update(skinds_)
            # sniffed version wins
            mime = mime_
            extensions = extensions_
        elif mime != mime_:
            # intersect possible interpretations
            skinds.intersection_update(skinds_)
            # sniffed version wins
            mime = mime_
            # but union possible extensions
            extensions += [e for e in extensions_ if e not in extensions]
        # sniffed charset always wins
        # TODO: make them a list too?
        charset = charset_ or charset
    else:
        skinds = set(kinds)

    return skinds, mime, charset, extensions
