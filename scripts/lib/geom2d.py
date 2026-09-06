"""
Minimal 2D computational geometry, dependency-free.

Deliberately no numpy / no shapely: this module must import unchanged inside
Blender's bundled Python and inside Unreal's Python, neither of which ships
those packages.

Everything is metres. Polygons are lists of (x, y) tuples, counter-clockwise,
implicitly closed (last vertex is NOT repeated).
"""

from __future__ import annotations

import math
from typing import Iterable, List, Sequence, Tuple

Point = Tuple[float, float]
Polygon = List[Point]

EPS = 1e-9


# --------------------------------------------------------------------------
# transforms
# --------------------------------------------------------------------------

def rotate(poly: Sequence[Point], deg: float) -> Polygon:
    """Rotate about the origin, counter-clockwise, degrees."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [(x * c - y * s, x * s + y * c) for x, y in poly]


def translate(poly: Sequence[Point], dx: float, dy: float) -> Polygon:
    return [(x + dx, y + dy) for x, y in poly]


def place(poly: Sequence[Point], deg: float, dx: float, dy: float) -> Polygon:
    return translate(rotate(poly, deg), dx, dy)


def bbox(poly: Sequence[Point]) -> Tuple[float, float, float, float]:
    """(xmin, ymin, xmax, ymax)"""
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_of_many(polys: Iterable[Sequence[Point]]) -> Tuple[float, float, float, float]:
    boxes = [bbox(p) for p in polys]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def bbox_size(polys: Iterable[Sequence[Point]]) -> Tuple[float, float]:
    x0, y0, x1, y1 = bbox_of_many(polys)
    return x1 - x0, y1 - y0


def area(poly: Sequence[Point]) -> float:
    """Shoelace. Positive for counter-clockwise."""
    n = len(poly)
    a = 0.0
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        a += x0 * y1 - x1 * y0
    return a / 2.0


def rect(w: float, h: float, x0: float = 0.0, y0: float = 0.0) -> Polygon:
    return [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)]


# --------------------------------------------------------------------------
# distance / containment
# --------------------------------------------------------------------------

def _seg_point_dist(ax, ay, bx, by, px, py) -> float:
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    if L2 < EPS:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def _segments_intersect(a, b, c, d) -> bool:
    def cross(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])

    d1, d2 = cross(c, d, a), cross(c, d, b)
    d3, d4 = cross(a, b, c), cross(a, b, d)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
        return True
    # colinear touching counts as intersecting for our purposes
    for o, p, q in ((c, d, a), (c, d, b), (a, b, c), (a, b, d)):
        if abs(cross(o, p, q)) < EPS:
            if (min(o[0], p[0]) - EPS <= q[0] <= max(o[0], p[0]) + EPS and
                    min(o[1], p[1]) - EPS <= q[1] <= max(o[1], p[1]) + EPS):
                return True
    return False


def _seg_seg_dist(a, b, c, d) -> float:
    if _segments_intersect(a, b, c, d):
        return 0.0
    return min(
        _seg_point_dist(a[0], a[1], b[0], b[1], c[0], c[1]),
        _seg_point_dist(a[0], a[1], b[0], b[1], d[0], d[1]),
        _seg_point_dist(c[0], c[1], d[0], d[1], a[0], a[1]),
        _seg_point_dist(c[0], c[1], d[0], d[1], b[0], b[1]),
    )


def point_in_polygon(pt: Point, poly: Sequence[Point]) -> bool:
    """Ray casting. Boundary result is not guaranteed; callers use clearances
    well above EPS so the boundary case never decides an answer here."""
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xin = (x1 - x0) * (y - y0) / (y1 - y0) + x0
            if x < xin:
                inside = not inside
    return inside


def polygons_overlap(p: Sequence[Point], q: Sequence[Point]) -> bool:
    np_, nq = len(p), len(q)
    for i in range(np_):
        for j in range(nq):
            if _segments_intersect(p[i], p[(i + 1) % np_], q[j], q[(j + 1) % nq]):
                return True
    # full containment (no edge crossings)
    return point_in_polygon(p[0], q) or point_in_polygon(q[0], p)


def polygon_distance(p: Sequence[Point], q: Sequence[Point]) -> float:
    """Minimum separation. 0.0 if the polygons touch or overlap."""
    if polygons_overlap(p, q):
        return 0.0
    np_, nq = len(p), len(q)
    best = float("inf")
    for i in range(np_):
        a, b = p[i], p[(i + 1) % np_]
        for j in range(nq):
            c, d = q[j], q[(j + 1) % nq]
            dd = _seg_seg_dist(a, b, c, d)
            if dd < best:
                best = dd
    return best


def clearance_to_axis_rect(poly: Sequence[Point],
                           x0: float, y0: float, x1: float, y1: float) -> float:
    """Signed minimum distance from `poly` to the four walls of an axis-aligned
    room rectangle. Negative means the polygon pokes through a wall.

    Exact for an axis-aligned container: the closest approach of any convex or
    concave polygon to a straight wall always occurs at a vertex.
    """
    return min(min(p[0] - x0 for p in poly),
               min(x1 - p[0] for p in poly),
               min(p[1] - y0 for p in poly),
               min(y1 - p[1] for p in poly))
