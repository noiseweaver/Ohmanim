"""A drop-in `cairo` module that records drawing commands instead of rasterising.

Manim's Camera talks to Cairo through a small API (paths, bezier curves, solid
colours, linear gradients, fill, stroke). Canvas 2D has the same model, so we
record those calls as a flat list of numbers and replay them on an HTML canvas.

Op codes (all values are floats, coordinates in Manim scene units):
  1 MOVE x y         2 CURVE x1 y1 x2 y2 x3 y3   3 CLOSE      4 NEWPATH
  5 RGBA r g b a     6 GRAD x0 y0 x1 y1 n (off r g b a)*n
  7 FILL             8 STROKE                    9 WIDTH w
  10 JOIN j          11 CAP c                    12 LINE x y
  13 IMAGE i ulx uly urx ury dlx dly alpha   (image i of manimweb.IMAGES, drawn
     into the parallelogram given by its top-left, top-right and bottom-left corners)
  14 VIDEO i ulx uly urx ury dlx dly alpha f   (frame f of clip i of manimweb.VIDEOS)
"""
import sys
import types

MOVE, CURVE, CLOSE, NEWPATH, RGBA, GRAD, FILL, STROKE, WIDTH, JOIN, CAP, LINE, IMAGE, VIDEO = range(1, 15)


class Recorder:
    def __init__(self):
        self.ops = []
        self.static_ops = None


REC = Recorder()


class _Enum:
    def __init__(self, **kw):
        self.__dict__.update(kw)


LineJoin = _Enum(MITER=0, ROUND=1, BEVEL=2)
LineCap = _Enum(BUTT=0, ROUND=1, SQUARE=2)
FORMAT_ARGB32 = 0
FORMAT_RGB24 = 1


class Matrix:
    def __init__(self, xx=1, yx=0, xy=0, yy=1, x0=0, y0=0):
        self.m = (xx, yx, xy, yy, x0, y0)


class ImageSurface:
    def __init__(self, *a, **k):
        pass

    @classmethod
    def create_for_data(cls, *a, **k):
        return cls()


class LinearGradient:
    def __init__(self, x0, y0, x1, y1):
        self.p = (x0, y0, x1, y1)
        self.stops = []

    def add_color_stop_rgba(self, offset, b, g, r, a):
        # Manim passes colours reversed (BGR) for Cairo's ARGB32 surface.
        self.stops.append((offset, r, g, b, a))


class Context:
    """Records into REC.ops. Manim hands it coordinates already in scene units."""

    def __init__(self, surface=None):
        pass

    # transforms are handled by the canvas player
    def scale(self, *a):
        pass

    def set_matrix(self, m):
        pass

    def new_path(self):
        REC.ops.append(NEWPATH)

    def new_sub_path(self):
        pass

    def move_to(self, x, y):
        REC.ops.extend((MOVE, x, y))

    def line_to(self, x, y):
        REC.ops.extend((LINE, x, y))

    def curve_to(self, x1, y1, x2, y2, x3, y3):
        REC.ops.extend((CURVE, x1, y1, x2, y2, x3, y3))

    def close_path(self):
        REC.ops.append(CLOSE)

    def set_source_rgba(self, b, g, r, a=1.0):
        REC.ops.extend((RGBA, r, g, b, a))

    def set_source_rgb(self, b, g, r):
        REC.ops.extend((RGBA, r, g, b, 1.0))

    def set_source(self, pat):
        REC.ops.extend((GRAD, *pat.p, len(pat.stops)))
        for s in pat.stops:
            REC.ops.extend(s)

    def fill_preserve(self):
        REC.ops.append(FILL)

    def fill(self):
        REC.ops.extend((FILL, NEWPATH))

    def stroke_preserve(self):
        REC.ops.append(STROKE)

    def stroke(self):
        REC.ops.extend((STROKE, NEWPATH))

    def set_line_width(self, w):
        REC.ops.extend((WIDTH, w))

    def set_line_join(self, j):
        REC.ops.extend((JOIN, j))

    def set_line_cap(self, c):
        REC.ops.extend((CAP, c))

    def paint(self):
        pass


def install():
    mod = types.ModuleType("cairo")
    for k, v in dict(globals()).items():
        if not k.startswith("_") and k not in ("sys", "types", "install"):
            setattr(mod, k, v)
    sys.modules["cairo"] = mod
