"""A `pathops` (skia-pathops) replacement built on Shapely/GEOS.

Manim's Union, Intersection, Difference and Exclusion hand Skia paths of cubic
beziers to skia-pathops. Here the curves are flattened finely, combined with
Shapely (available in Pyodide), and returned as closed outlines with holes
wound the opposite way, so Cairo-style nonzero filling stays correct.
"""
import math
import sys
import types


class PathVerb:
    MOVE, LINE, QUAD, CUBIC, CLOSE = "move", "line", "quad", "cubic", "close"


class Path:
    def __init__(self):
        self.ops = []  # (verb, points)

    def getPen(self):
        return self

    def moveTo(self, x, y):
        self.ops.append((PathVerb.MOVE, ((x, y),)))

    def lineTo(self, x, y):
        self.ops.append((PathVerb.LINE, ((x, y),)))

    def quadTo(self, x1, y1, x2, y2):
        self.ops.append((PathVerb.QUAD, ((x1, y1), (x2, y2))))

    def cubicTo(self, x1, y1, x2, y2, x3, y3):
        self.ops.append((PathVerb.CUBIC, ((x1, y1), (x2, y2), (x3, y3))))

    def close(self):
        self.ops.append((PathVerb.CLOSE, ()))

    closePath = close

    def __iter__(self):
        return iter(self.ops)


def _flatten(path):
    """Yield each subpath as a list of points, curves sampled by length."""
    rings, cur, last = [], [], (0.0, 0.0)
    for verb, pts in path.ops:
        if verb == PathVerb.MOVE:
            if len(cur) > 2:
                rings.append(cur)
            cur = [pts[0]]
        elif verb == PathVerb.LINE:
            cur.append(pts[0])
        elif verb in (PathVerb.QUAD, PathVerb.CUBIC):
            ctrl = (last,) + pts
            approx = sum(math.dist(ctrl[i], ctrl[i + 1]) for i in range(len(ctrl) - 1))
            n = max(4, min(64, int(approx * 24)))
            for k in range(1, n + 1):
                t = k / n
                if verb == PathVerb.QUAD:
                    p0, p1, p2 = ctrl
                    a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
                    cur.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
                else:
                    p0, p1, p2, p3 = ctrl
                    a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                    cur.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
        elif verb == PathVerb.CLOSE:
            if len(cur) > 2:
                rings.append(cur)
            cur = [cur[0]] if cur else []
            last = cur[0] if cur else last
            continue
        if cur:
            last = cur[-1]
    if len(cur) > 2:
        rings.append(cur)
    return rings


def _geom(paths):
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    shapes = []
    for p in paths:
        g = None
        for ring in _flatten(p):
            poly = Polygon(ring).buffer(0)
            if poly.is_empty:
                continue
            # Overlapping subpaths of one shape toggle (holes in letters, rings).
            g = poly if g is None else g.symmetric_difference(poly)
        if g is not None:
            shapes.append(g)
    return unary_union(shapes) if shapes else Polygon()


def _emit(geom, pen):
    from shapely.geometry import MultiPolygon, Polygon
    from shapely.geometry.polygon import orient

    polys = [geom] if isinstance(geom, Polygon) else [g for g in getattr(geom, "geoms", []) if isinstance(g, (Polygon, MultiPolygon))]
    for poly in polys:
        for sub in ([poly] if isinstance(poly, Polygon) else poly.geoms):
            if sub.is_empty:
                continue
            sub = orient(sub, 1.0)
            for ring in [sub.exterior, *sub.interiors]:
                coords = list(ring.coords)[:-1]
                if len(coords) < 3:
                    continue
                pen.moveTo(*coords[0])
                for c in coords[1:]:
                    pen.lineTo(*c)
                pen.close()


def union(paths, pen, **kw):
    _emit(_geom(paths), pen)


def difference(subject, clip, pen, **kw):
    _emit(_geom(subject).difference(_geom(clip)), pen)


def intersection(subject, clip, pen, **kw):
    _emit(_geom(subject).intersection(_geom(clip)), pen)


def xor(subject, clip, pen, **kw):
    _emit(_geom(subject).symmetric_difference(_geom(clip)), pen)


def install():
    mod = types.ModuleType("pathops")
    for k in ("Path", "PathVerb", "union", "difference", "intersection", "xor"):
        setattr(mod, k, globals()[k])
    sys.modules["pathops"] = mod
