"""Real historical crash-data feature, sourced from the Kaggle US-Accidents
dataset (sobhanmoosavi/us-accidents, 2016-2023, 7.7M records) reduced offline
to a lat/lon grid — see backend/scripts/build_accident_grid.py for the ETL and
backend/accident_correlations.json for the correlation analysis that grounded
risk_engine's crash-history weight. Every number this module returns traces to
a real recorded crash near the road's actual coordinates, never a model guess
— same "no fabricated numbers" rule every other provider/service in this app
follows, just backed by a real national crash record instead of OSM tags.

accidents.db is a build artifact (~3GB source CSV -> a few hundred MB SQLite
grid), not checked into the repo (see .gitignore) — a fresh clone/deploy
without it simply gets zeroed-out AccidentStats everywhere, same graceful-
degradation posture as Overpass/OSRM being unreachable. Nothing breaks; the
app is honest that this factor found nothing rather than inventing a number."""
import os
import sqlite3
from dataclasses import dataclass
from typing import List, Optional, Tuple

_DB_PATH = os.environ.get(
    "ROADTWIN_ACCIDENTS_DB_PATH",
    os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "accidents.db")),
)

# MUST match build_accident_grid.py's LAT_STEP/LON_STEP exactly — this is the
# query side of the same grid, not an independently-derived approximation.
LAT_STEP = 500.0 / 110_540.0
LON_STEP = 500.0 / (111_320.0 * 0.766)

# The query buffer extends roughly one grid cell beyond each end of the road
# (the 3x3 cell neighborhood around every sampled point) — dividing a count
# drawn from that wider area by the road's own raw length would make a short
# road in a dense city look absurdly crash-dense purely from buffer overhang.
# accidents_per_km divides by the road's length PLUS this buffer instead, so
# it reads as "crashes per km of searched corridor," not a false-precision
# "crashes per km of pavement."
BUFFER_RADIUS_M = 500.0

_available: Optional[bool] = None


def available() -> bool:
    """False (never raises) when accidents.db hasn't been built yet — a
    missing optional data source must degrade gracefully, same as every live
    provider in this app."""
    global _available
    if _available is None:
        _available = os.path.exists(_DB_PATH)
    return _available


def _cell_of(lat: float, lon: float) -> Tuple[int, int]:
    return (round(lat / LAT_STEP), round(lon / LON_STEP))


@dataclass
class AccidentStats:
    count: int
    accidents_per_km: float
    # 1-4 scale, Kaggle's own "Severity" field — documented by the dataset's
    # author as TRAFFIC IMPACT (delay caused), not injury/fatality severity.
    # 0.0 if count == 0.
    avg_severity: float
    night_pct: float
    junction_pct: float
    crossing_pct: float
    signal_pct: float
    adverse_weather_pct: float


EMPTY_STATS = AccidentStats(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

# National baseline share of ALL 7,728,394 crashes in the dataset that occurred
# under each condition (from backend/accident_correlations.json's flag_correlations
# n_true / total_rows) — used by intervention_engine.py to decide whether a
# SPECIFIC road's nearby crash pattern is notably above the national norm
# (worth calling out as evidence for a specific intervention) or just typical.
NATIONAL_NIGHT_PCT = 30.7
NATIONAL_JUNCTION_PCT = 7.4
NATIONAL_CROSSING_PCT = 11.3
NATIONAL_SIGNAL_PCT = 14.8
NATIONAL_ADVERSE_WEATHER_PCT = 10.5


def nearby_stats(points: List[Tuple[float, float]], length_m: float) -> AccidentStats:
    """Aggregates real recorded crashes within one grid cell (~500m) of any
    point on the road's polyline. Downsamples dense polylines to roughly one
    sample per 150m first — the grid is coarse enough that finer sampling
    would just recompute the same handful of cells over and over."""
    if not available() or not points:
        return EMPTY_STATS

    approx_samples = max(1, int(length_m / 150))
    step = max(1, len(points) // approx_samples)
    sampled = points[::step] if step > 1 else points

    cells = set()
    for lat, lon in sampled:
        lat_c, lon_c = _cell_of(lat, lon)
        for dlat in (-1, 0, 1):
            for dlon in (-1, 0, 1):
                cells.add((lat_c + dlat, lon_c + dlon))
    if not cells:
        return EMPTY_STATS

    lat_cells = [c[0] for c in cells]
    lon_cells = [c[1] for c in cells]

    conn = sqlite3.connect(_DB_PATH)
    try:
        # Bounding-box range scan (cheap on the (lat_cell, lon_cell) primary
        # key index) over-fetches slightly on a non-rectangular buffer set —
        # filtered exactly against `cells` below rather than trusting the box.
        rows = conn.execute(
            "SELECT lat_cell, lon_cell, count, severity_sum, night_count, junction_count, "
            "crossing_count, signal_count, adverse_weather_count FROM accident_grid "
            "WHERE lat_cell BETWEEN ? AND ? AND lon_cell BETWEEN ? AND ?",
            (min(lat_cells), max(lat_cells), min(lon_cells), max(lon_cells)),
        ).fetchall()
    finally:
        conn.close()

    count = severity_sum = night = junction = crossing = signal = adverse = 0
    for lat_c, lon_c, c, sev, n, j, cr, sig, adv in rows:
        if (lat_c, lon_c) not in cells:
            continue
        count += c
        severity_sum += sev
        night += n
        junction += j
        crossing += cr
        signal += sig
        adverse += adv

    if count == 0:
        return EMPTY_STATS

    effective_km = max((length_m + 2 * BUFFER_RADIUS_M) / 1000, 0.1)
    return AccidentStats(
        count=count,
        accidents_per_km=round(count / effective_km, 2),
        avg_severity=round(severity_sum / count, 2),
        night_pct=round(100 * night / count, 1),
        junction_pct=round(100 * junction / count, 1),
        crossing_pct=round(100 * crossing / count, 1),
        signal_pct=round(100 * signal / count, 1),
        adverse_weather_pct=round(100 * adverse / count, 1),
    )
