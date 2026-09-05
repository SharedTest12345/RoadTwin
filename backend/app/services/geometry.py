"""Geometry primitives: haversine length, local ENU projection, heading/curvature."""
import math
from typing import List, Tuple

EARTH_R = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1, math.sqrt(a)))


def polyline_length_m(points: List[Tuple[float, float]]) -> float:
    total = 0.0
    for i in range(1, len(points)):
        lat1, lon1 = points[i - 1]
        lat2, lon2 = points[i]
        total += haversine_m(lat1, lon1, lat2, lon2)
    return total


def project_ref(points: List[Tuple[float, float]], lat0: float, lon0: float) -> List[Tuple[float, float]]:
    """Equirectangular projection to local meters against an EXPLICIT reference
    point. Used so unrelated geometry (e.g. building footprints) lands in the same
    coordinate frame as a road's own polyline, rather than each computing its own
    centroid and silently drifting apart."""
    lat0_rad = math.radians(lat0)
    mx = 111320.0 * math.cos(lat0_rad)
    my = 110540.0
    return [((lon - lon0) * mx, (lat - lat0) * my) for lat, lon in points]


def project_local_xy(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Equirectangular projection to local meters, centered at polyline centroid.
    Good enough for road-segment scale (sub-10km)."""
    if not points:
        return []
    lat0 = sum(p[0] for p in points) / len(points)
    lon0 = sum(p[1] for p in points) / len(points)
    return project_ref(points, lat0, lon0)


def headings_deg(xy: List[Tuple[float, float]]) -> List[float]:
    """Heading in degrees for each segment between consecutive points."""
    out = []
    for i in range(1, len(xy)):
        dx = xy[i][0] - xy[i - 1][0]
        dy = xy[i][1] - xy[i - 1][1]
        out.append(math.degrees(math.atan2(dy, dx)))
    return out


def _angle_diff(a: float, b: float) -> float:
    d = (a - b + 180) % 360 - 180
    return abs(d)


def curvature_stats(xy: List[Tuple[float, float]]) -> Tuple[int, float, float]:
    """Returns (sharp_turn_count, max_curvature_deg_per_20m, avg_heading_change_deg)."""
    if len(xy) < 3:
        return 0, 0.0, 0.0
    hdgs = headings_deg(xy)
    changes = [_angle_diff(hdgs[i], hdgs[i - 1]) for i in range(1, len(hdgs))]
    if not changes:
        return 0, 0.0, 0.0
    sharp = sum(1 for c in changes if c > 25.0)
    seg_lens = []
    for i in range(1, len(xy) - 1):
        dx = xy[i][0] - xy[i - 1][0]
        dy = xy[i][1] - xy[i - 1][1]
        seg_lens.append(math.hypot(dx, dy) or 1.0)
    max_curv = 0.0
    for c, l in zip(changes, seg_lens):
        per_20m = c * (20.0 / max(l, 1.0))
        max_curv = max(max_curv, min(per_20m, 90.0))
    avg_change = sum(changes) / len(changes)
    return sharp, max_curv, avg_change


def curve_speed_factors(xy: List[Tuple[float, float]]) -> List[float]:
    """Per-vertex safe-speed multiplier (0.35-1.0) driven by local heading change.
    Sharp turns force a lower safe speed, same way a real driver brakes for a bend."""
    n = len(xy)
    if n < 3:
        return [1.0] * n
    hdgs = headings_deg(xy)
    factors = [1.0] * n
    for i in range(1, n - 1):
        turn = _angle_diff(hdgs[i], hdgs[i - 1]) if i < len(hdgs) else 0.0
        factors[i] = max(0.35, 1.0 - turn / 75.0)
    return factors


def point_near_polyline(pt: Tuple[float, float], xy: List[Tuple[float, float]], radius_m: float) -> bool:
    px, py = pt
    for x, y in xy:
        if math.hypot(x - px, y - py) <= radius_m:
            return True
    return False
