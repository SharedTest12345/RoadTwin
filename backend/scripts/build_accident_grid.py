"""One-time ETL: streams the ~3GB US-Accidents (Kaggle, sobhanmoosavi/us-accidents,
7.7M rows, 2016-2023) CSV and reduces it to two small, ship-able artifacts:

1. backend/accidents.db — a SQLite table of real crash aggregates on a fixed
   lat/lon grid (~500m cells). The live app queries THIS at request time, never
   the raw CSV (which is too large to read per-request and isn't checked into
   the repo at all — see .gitignore). Same "SQLite-backed catalog" pattern as
   road_db.py, just pre-populated once instead of grown at runtime.

2. A printed correlation report (stdout, also written to
   backend/accident_correlations.json) — real avg-severity comparisons for the
   same real/estimated factors risk_engine.py already scores (traffic signal
   presence, lighting/night, junction control, weather), used to sanity-check
   those hand-set point weights against actual crash outcomes rather than
   tuning them by feel. See risk_engine.py's module docstring for the numbers
   this produced and what (if anything) they changed.

Single pass over the file for both — the CSV is the expensive part (a few
minutes even in plain csv.reader), not worth reading twice.

Usage:
    .venv\\Scripts\\python.exe scripts\\build_accident_grid.py <path-to-csv>
"""
import csv
import json
import sqlite3
import sys
import time
from pathlib import Path

# ~500m cells. LAT_STEP is exact (110.54 km/deg is ~constant everywhere).
# LON_STEP is a fixed approximation using cos(40 deg) — the continental-US
# midpoint latitude — since correcting per-row for the true local longitude
# compression would need a variable grid keyed by latitude band, which the
# live query side would then also have to replicate exactly. A fixed
# reference is the same "good enough at this prototype's scale, documented"
# tradeoff feature_extraction.py already makes for slope/volume — cells run
# closer to ~500x430m in the deep south and ~500x330m near the Canadian
# border, never wildly off in either direction.
LAT_STEP = 500.0 / 110_540.0
LON_STEP = 500.0 / (111_320.0 * 0.766)

ADVERSE_WEATHER_KEYWORDS = ("rain", "snow", "sleet", "ice", "fog", "hail", "storm")


def cell_of(lat: float, lon: float) -> tuple:
    return (round(lat / LAT_STEP), round(lon / LON_STEP))


def is_adverse(weather: str) -> bool:
    w = (weather or "").lower()
    return any(k in w for k in ADVERSE_WEATHER_KEYWORDS)


class Bucket:
    __slots__ = ("count", "severity_sum", "night_count", "junction_count",
                 "crossing_count", "signal_count", "stop_count", "giveway_count",
                 "railway_count", "adverse_weather_count")

    def __init__(self):
        self.count = 0
        self.severity_sum = 0
        self.night_count = 0
        self.junction_count = 0
        self.crossing_count = 0
        self.signal_count = 0
        self.stop_count = 0
        self.giveway_count = 0
        self.railway_count = 0
        self.adverse_weather_count = 0


class FlagStat:
    """Running (count, severity_sum) for a boolean split — e.g. Traffic_Signal
    True vs False — feeding the correlation report, independent of the grid."""
    __slots__ = ("count_true", "sev_true", "count_false", "sev_false")

    def __init__(self):
        self.count_true = 0
        self.sev_true = 0
        self.count_false = 0
        self.sev_false = 0

    def add(self, flag: bool, severity: int):
        if flag:
            self.count_true += 1
            self.sev_true += severity
        else:
            self.count_false += 1
            self.sev_false += severity

    def report(self) -> dict:
        return {
            "avg_severity_when_true": round(self.sev_true / self.count_true, 3) if self.count_true else None,
            "avg_severity_when_false": round(self.sev_false / self.count_false, 3) if self.count_false else None,
            "n_true": self.count_true, "n_false": self.count_false,
        }


def main():
    if len(sys.argv) < 2:
        print("usage: build_accident_grid.py <path-to-US_Accidents_*.csv>")
        sys.exit(1)
    csv_path = Path(sys.argv[1])
    out_dir = Path(__file__).resolve().parent.parent
    db_path = out_dir / "accidents.db"
    report_path = out_dir / "accident_correlations.json"

    grid: dict[tuple, Bucket] = {}
    flag_stats = {name: FlagStat() for name in
                  ("Traffic_Signal", "Junction", "Crossing", "Stop", "Give_Way", "Railway", "Night", "Adverse_Weather")}
    weather_bucket_stats: dict[str, list] = {}  # bucket label -> [count, severity_sum]
    total_rows = 0
    skipped = 0
    t0 = time.time()

    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}
        required = ["Severity", "Start_Lat", "Start_Lng", "Weather_Condition",
                    "Junction", "Crossing", "Traffic_Signal", "Stop", "Give_Way",
                    "Railway", "Sunrise_Sunset"]
        missing = [r for r in required if r not in idx]
        if missing:
            print(f"CSV is missing expected columns: {missing}")
            sys.exit(1)

        for row in reader:
            total_rows += 1
            try:
                severity = int(row[idx["Severity"]])
                lat = float(row[idx["Start_Lat"]])
                lon = float(row[idx["Start_Lng"]])
            except (ValueError, IndexError):
                skipped += 1
                continue

            junction = row[idx["Junction"]] == "True"
            crossing = row[idx["Crossing"]] == "True"
            signal = row[idx["Traffic_Signal"]] == "True"
            stop = row[idx["Stop"]] == "True"
            give_way = row[idx["Give_Way"]] == "True"
            railway = row[idx["Railway"]] == "True"
            night = row[idx["Sunrise_Sunset"]] == "Night"
            weather = row[idx["Weather_Condition"]]
            adverse = is_adverse(weather)

            key = cell_of(lat, lon)
            b = grid.get(key)
            if b is None:
                b = Bucket()
                grid[key] = b
            b.count += 1
            b.severity_sum += severity
            if night: b.night_count += 1
            if junction: b.junction_count += 1
            if crossing: b.crossing_count += 1
            if signal: b.signal_count += 1
            if stop: b.stop_count += 1
            if give_way: b.giveway_count += 1
            if railway: b.railway_count += 1
            if adverse: b.adverse_weather_count += 1

            flag_stats["Traffic_Signal"].add(signal, severity)
            flag_stats["Junction"].add(junction, severity)
            flag_stats["Crossing"].add(crossing, severity)
            flag_stats["Stop"].add(stop, severity)
            flag_stats["Give_Way"].add(give_way, severity)
            flag_stats["Railway"].add(railway, severity)
            flag_stats["Night"].add(night, severity)
            flag_stats["Adverse_Weather"].add(adverse, severity)

            w = (weather or "Unknown").strip() or "Unknown"
            wb = weather_bucket_stats.setdefault(w, [0, 0])
            wb[0] += 1
            wb[1] += severity

            if total_rows % 1_000_000 == 0:
                elapsed = time.time() - t0
                print(f"  {total_rows:,} rows ({elapsed:.0f}s, {len(grid):,} grid cells so far)", flush=True)

    print(f"Parsed {total_rows:,} rows ({skipped:,} skipped — bad lat/lon/severity) "
          f"in {time.time() - t0:.0f}s. {len(grid):,} distinct grid cells.", flush=True)

    # --- write the grid db --------------------------------------------------
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE accident_grid (
            lat_cell INTEGER NOT NULL,
            lon_cell INTEGER NOT NULL,
            count INTEGER NOT NULL,
            severity_sum INTEGER NOT NULL,
            night_count INTEGER NOT NULL,
            junction_count INTEGER NOT NULL,
            crossing_count INTEGER NOT NULL,
            signal_count INTEGER NOT NULL,
            stop_count INTEGER NOT NULL,
            giveway_count INTEGER NOT NULL,
            railway_count INTEGER NOT NULL,
            adverse_weather_count INTEGER NOT NULL,
            PRIMARY KEY (lat_cell, lon_cell)
        )
    """)
    conn.execute("""
        CREATE TABLE grid_meta (
            key TEXT PRIMARY KEY, value TEXT NOT NULL
        )
    """)
    conn.executemany(
        "INSERT INTO grid_meta (key, value) VALUES (?, ?)",
        [("lat_step", repr(LAT_STEP)), ("lon_step", repr(LON_STEP)),
         ("source_rows", str(total_rows)), ("built_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))],
    )
    rows = (
        (lat_c, lon_c, b.count, b.severity_sum, b.night_count, b.junction_count,
         b.crossing_count, b.signal_count, b.stop_count, b.giveway_count,
         b.railway_count, b.adverse_weather_count)
        for (lat_c, lon_c), b in grid.items()
    )
    conn.executemany(
        "INSERT INTO accident_grid VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows,
    )
    conn.commit()
    conn.close()
    print(f"Wrote {db_path} ({db_path.stat().st_size / 1e6:.1f} MB).", flush=True)

    # --- correlation report ---------------------------------------------
    top_weather = sorted(weather_bucket_stats.items(), key=lambda kv: -kv[1][0])[:15]
    report = {
        "total_rows": total_rows,
        "skipped_rows": skipped,
        "overall_avg_severity": round(sum(b.severity_sum for b in grid.values()) / max(total_rows - skipped, 1), 3),
        "flag_correlations": {name: fs.report() for name, fs in flag_stats.items()},
        "top_weather_conditions": [
            {"condition": w, "n": n, "avg_severity": round(s / n, 3)} for w, (n, s) in top_weather
        ],
    }
    report_path.write_text(json.dumps(report, indent=2))
    print(f"Wrote {report_path}", flush=True)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
