"""A `manimpango` replacement that lays out text with fontTools.

Pango is a C library, so in the browser we draw glyph outlines from bundled
DejaVu fonts instead. The SVG we write follows Pango's metrics (font size in
points at 96 dpi), so Manim's Text sizes and positions match a normal install.
"""
import html
import os
import re
import sys
import types
from html.parser import HTMLParser

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT_DIR = os.environ.get("MANIMWEB_FONTS", os.path.join(os.path.dirname(__file__), "..", "fonts"))
_FILES = {
    ("sans", False): "DejaVuSans.ttf",
    ("sans", True): "DejaVuSans-Bold.ttf",
    ("mono", False): "DejaVuSansMono.ttf",
    ("mono", True): "DejaVuSansMono.ttf",
}
_cache = {}


def _font(family, bold):
    fam = "mono" if family and "mono" in family.lower() else "sans"
    key = (fam, bool(bold))
    if key not in _cache:
        f = TTFont(os.path.join(FONT_DIR, _FILES[key]), lazy=True)
        _cache[key] = (f, f.getGlyphSet(), f.getBestCmap(), f["hmtx"], f["head"].unitsPerEm, f["hhea"])
    return _cache[key]


class TextSetting:
    def __init__(self, start, end, font, slant, weight, line_num=-1, color=None):
        self.start, self.end, self.font, self.slant, self.weight = start, end, font, slant, weight
        self.line_num, self.color = line_num, color


class Alignment:
    LEFT, CENTER, RIGHT = 0, 1, 2


def list_fonts():
    return ["DejaVu Sans", "DejaVu Sans Mono", "Sans", "Monospace"]


def register_font(path):
    return True


def unregister_font(path):
    return True


def _is_bold(weight):
    return str(weight).upper() in ("BOLD", "ULTRABOLD", "HEAVY", "SEMIBOLD", "ULTRAHEAVY", "BOOK_BOLD") or str(weight) in ("600", "700", "800", "900")


def _layout(runs, size, line_spacing, start_x, start_y):
    """runs: list of (text, family, bold, italic, color, line_num). Returns SVG body."""
    px = size * 4 / 3  # Pango points -> px at 96 dpi
    paths = []
    x_by_line = {}
    f0 = _font(None, False)
    ascent = f0[5].ascent / f0[4] * px
    line_h = (line_spacing * 4 / 3) if line_spacing and line_spacing > 0 else (f0[5].ascent - f0[5].descent + f0[5].lineGap) / f0[4] * px
    for text, family, bold, italic, color, line in runs:
        font, gs, cmap, hmtx, upem, _ = _font(family, bold)
        s = px / upem
        x = x_by_line.get(line, start_x)
        base = start_y + ascent + line * line_h
        fill = color or "#ffffff"
        for ch in text:
            if ch == "\n":
                continue
            gname = cmap.get(ord(ch)) or cmap.get(ord("?"))
            adv = hmtx[gname][0] * s if gname else px * 0.5
            if not ch.isspace() and gname:
                pen = SVGPathPen(gs)
                skew = 0.2 if italic else 0.0
                gs[gname].draw(TransformPen(pen, (s, 0, -skew * s, -s, x, base)))
                d = pen.getCommands()
                if d:
                    paths.append(f'<path d="{d}" fill="{html.escape(fill)}"/>')
                else:
                    paths.append('<path d="M 0 0" fill="none"/>')
            x += adv
        x_by_line[line] = x
    return "\n".join(paths)


def _write(file_name, body, width, height):
    with open(file_name, "w") as f:
        f.write(
            f'<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{width}" height="{height}" viewBox="0 0 {width} {height}">\n{body}\n</svg>\n'
        )
    return file_name


def text2svg(settings, size, line_spacing, disable_liga, file_name, START_X, START_Y, width, height, orig_text, pango_width=None):
    runs = []
    for st in sorted(settings, key=lambda s: s.start):
        runs.append((orig_text[st.start:st.end], st.font, _is_bold(st.weight), str(st.slant).upper() in ("ITALIC", "OBLIQUE"),
                     st.color, max(st.line_num, 0)))
    return _write(file_name, _layout(runs, size, line_spacing, START_X, START_Y), width, height)


class _Markup(HTMLParser):
    def __init__(self, family, bold, italic):
        super().__init__(convert_charrefs=True)
        self.stack = [{"family": family, "bold": bold, "italic": italic, "color": None}]
        self.runs = []
        self.line = 0

    def handle_starttag(self, tag, attrs):
        st = dict(self.stack[-1])
        a = dict(attrs)
        if tag in ("b", "strong"):
            st["bold"] = True
        elif tag in ("i", "em"):
            st["italic"] = True
        elif tag == "tt":
            st["family"] = "mono"
        for k in ("foreground", "fgcolor", "color"):
            if k in a:
                st["color"] = a[k]
        if a.get("font_family") or a.get("face"):
            st["family"] = a.get("font_family") or a.get("face")
        if str(a.get("weight", a.get("font_weight", ""))).lower() in ("bold", "heavy", "ultrabold", "700", "800", "900"):
            st["bold"] = True
        if str(a.get("style", a.get("font_style", ""))).lower() in ("italic", "oblique"):
            st["italic"] = True
        self.stack.append(st)

    def handle_endtag(self, tag):
        if len(self.stack) > 1:
            self.stack.pop()

    def handle_data(self, data):
        st = self.stack[-1]
        parts = data.split("\n")
        for i, part in enumerate(parts):
            if i:
                self.line += 1
            if part:
                self.runs.append((part, st["family"], st["bold"], st["italic"], st["color"], self.line))


class MarkupUtils:
    @staticmethod
    def validate(text):
        return ""

    @staticmethod
    def text2svg(text, font, slant, weight, size, line_spacing, disable_liga, file_name, START_X, START_Y, width, height,
                 justify=None, indent=None, alignment=None, pango_width=None):
        p = _Markup(font, _is_bold(weight), str(slant).upper() in ("ITALIC", "OBLIQUE"))
        p.feed(text)
        p.close()
        return _write(file_name, _layout(p.runs, size, line_spacing, START_X, START_Y), width, height)


class PangoUtils:
    @staticmethod
    def remove_last_M(file_name):
        pass


def install():
    mod = types.ModuleType("manimpango")
    for k in ("TextSetting", "Alignment", "MarkupUtils", "PangoUtils", "list_fonts", "register_font", "unregister_font", "text2svg"):
        setattr(mod, k, globals()[k])
    mod.__version__ = "0.6.1"
    sys.modules["manimpango"] = mod
