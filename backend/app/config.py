"""Runtime configuration. All external dependencies are optional — the app
must run fully offline against the demo dataset if network/keys are absent."""
import os

OVERPASS_URL = os.environ.get("ROADTWIN_OVERPASS_URL", "https://overpass-api.de/api/interpreter")
OVERPASS_TIMEOUT_S = float(os.environ.get("ROADTWIN_OVERPASS_TIMEOUT_S", "6"))
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
USE_LIVE_OSM = os.environ.get("ROADTWIN_USE_LIVE_OSM", "1") != "0"
# OSRM's public demo router (also OSM-derived, no API key) — used as a second-tier
# live source when Overpass itself is unreachable (a real, distinct failure mode:
# Overpass is a free, donation-run service that goes down/gets rate-limited far
# more often than the OSM ecosystem as a whole).
OSRM_URL = os.environ.get("ROADTWIN_OSRM_URL", "https://router.project-osrm.org/route/v1/driving")
OSRM_TIMEOUT_S = float(os.environ.get("ROADTWIN_OSRM_TIMEOUT_S", "6"))
USE_LIVE_OSRM = os.environ.get("ROADTWIN_USE_LIVE_OSRM", "1") != "0"
CORS_ORIGINS = os.environ.get("ROADTWIN_CORS_ORIGINS", "*").split(",")
