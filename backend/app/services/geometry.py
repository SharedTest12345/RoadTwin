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


# A route-planned polyline (OSRM's `get_random_road`, driving between two
# random waypoints — the source for effectively every real scanned road while
# Overpass is unreachable, verified empirically: 144/144 in this app's own
# scanned-road sample) frequently crosses several streets connected by real
# turns AT INTERSECTIONS, not a single continuous road's own mid-block curve.
# The `* (20/segment_length)` extrapolation below assumes a segment's turn
# rate holds for a full 20m — for a normal-length segment that's a reasonable
# approximation, but for the SHORT segments an intersection turn actually
# produces (routing vertices sit close together right at the corner) it
# blows up: a modest 9.6° change over a 1.3m segment extrapolates to 147°,
# clipped to the 90° cap, same as a genuinely severe curve.
#
# Verified directly against every real scanned road in this app's own
# database: computed each surviving 90°-capped segment's IMPLIED TURN RADIUS
# (segment_length / angle_change_in_radians — basic circular-arc geometry)
# directly, with no extrapolation. Every single one came out under 12.1m
# (e.g. 88.7° over 6.4m -> 4.1m radius; 108.8° over 13.4m -> 7.1m radius).
# No public road is built with a through-alignment curve anywhere near that
# tight at any driving speed — that radius range is curb-corner/driveway
# scale, the geometric signature of a routed polyline executing a real turn
# at a street intersection, not a road curving along its own alignment.
# AASHTO HSM's own horizontal-curve CMF (risk_engine.py's
# CURVE_HSM_RADIUS_COEFFICIENT) is explicitly about a continuous roadway's
# mid-block alignment — scoring an intersection turn against it is a
# category error, not a conservative approximation.
#
# MIN_PLAUSIBLE_ROAD_RADIUS_M is THIS APP'S OWN conservative floor, not an
# independently cited engineering minimum-radius standard (the earlier CMF
# research for this rewrite found Eq. 10-13's radius-severity term, not a
# minimum-radius table) — chosen low enough to never exclude a genuine tight
# hairpin switchback while still catching every real-world stuck case found
# above by a wide margin (12m being the tightest genuine survivor).
MIN_PLAUSIBLE_ROAD_RADIUS_M = 15.0


def curvature_stats(xy: List[Tuple[float, float]]) -> Tuple[int, float, float]:
    """Returns (sharp_turn_count, max_curvature_deg_per_20m, avg_heading_change_deg).
    Excludes segments whose implied turn radius is tighter than any real
    through-road curve (an intersection turn, not road curvature) from all
    three — see MIN_PLAUSIBLE_ROAD_RADIUS_M's comment above for why and how
    this was verified against real data before being added."""
    if len(xy) < 3:
        return 0, 0.0, 0.0
    hdgs = headings_deg(xy)
    changes = [_angle_diff(hdgs[i], hdgs[i - 1]) for i in range(1, len(hdgs))]
    if not changes:
        return 0, 0.0, 0.0
    seg_lens = []
    for i in range(1, len(xy) - 1):
        dx = xy[i][0] - xy[i - 1][0]
        dy = xy[i][1] - xy[i - 1][1]
        seg_lens.append(math.hypot(dx, dy) or 1.0)

    def is_intersection_turn(i: int) -> bool:
        c = changes[i]
        if c <= 1.0:
            return False
        l = seg_lens[i] if i < len(seg_lens) else 1.0
        radius = l / max(math.radians(c), 1e-6)
        return radius < MIN_PLAUSIBLE_ROAD_RADIUS_M

    sharp = sum(1 for i, c in enumerate(changes) if c > 25.0 and not is_intersection_turn(i))
    max_curv = 0.0
    for i, (c, l) in enumerate(zip(changes, seg_lens)):
        if is_intersection_turn(i):
            continue
        per_20m = c * (20.0 / max(l, 1.0))
        max_curv = max(max_curv, min(per_20m, 90.0))
    real_changes = [c for i, c in enumerate(changes) if not is_intersection_turn(i)]
    avg_change = sum(real_changes) / len(real_changes) if real_changes else 0.0
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
