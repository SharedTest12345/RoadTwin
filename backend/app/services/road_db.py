"""SQLite persistence for scanned roads. Keeps "roads RoadTwin has scanned" as
a durable catalog across backend restarts, instead of the previous in-memory-
only cache that reset to empty every process restart.

Demo roads are deliberately never written here — they're a fixed curated
fallback catalog (used when live OSM/OSRM is unreachable, and for the
flagship Demo deep link), not something a user actually scanned."""
import os
import sqlite3
from typing import List, Optional

from ..models.schemas import Road

_DB_PATH = os.environ.get(
    "ROADTWIN_DB_PATH",
    os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "roadtwin.db")),
)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS scanned_roads (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
            data TEXT NOT NULL
        )
        """
    )
    return conn


def save_road(road: Road) -> None:
    conn = _connect()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO scanned_roads (id, source, data, scanned_at) "
            "VALUES (?, ?, ?, COALESCE((SELECT scanned_at FROM scanned_roads WHERE id = ?), datetime('now')))",
            (road.id, road.source, road.model_dump_json(), road.id),
        )
        conn.commit()
    finally:
        conn.close()


def get_road(road_id: str) -> Optional[Road]:
    conn = _connect()
    try:
        row = conn.execute("SELECT data FROM scanned_roads WHERE id = ?", (road_id,)).fetchone()
    finally:
        conn.close()
    return Road.model_validate_json(row[0]) if row else None


def list_roads() -> List[Road]:
    conn = _connect()
    try:
        rows = conn.execute("SELECT data FROM scanned_roads ORDER BY scanned_at DESC").fetchall()
    finally:
        conn.close()
    return [Road.model_validate_json(r[0]) for r in rows]
