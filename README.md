# RoadTwin

RoadTwin turns a real-world road into an interactive digital twin, estimates its safety/traffic
risk with an explainable model, simulates traffic and driver-conflict behavior on it, and lets you
simulate infrastructure interventions to see the projected before/after impact.

**RoadTwin provides analytical risk estimates and simulation-based recommendations. It is not an
official road-safety certification or engineering assessment.**

---

## Architecture

```
frontend (React + TS + Vite + React Router + Zustand + React Three Fiber)
   |  fetch /api/* (proxied to backend in dev)
   v
backend (FastAPI)
   |
   +-- providers/            RoadDataProvider abstraction
   |     osm_provider.py       live OpenStreetMap discovery via Overpass API (no key required)
   |     osrm_provider.py      second-tier live source (OSRM's public router) if Overpass is down
   |     demo_provider.py      curated fallback road catalog (used if OSM/OSRM are unreachable)
   |
   +-- services/
         geometry.py            haversine length, local ENU projection, curvature/heading
         feature_extraction.py  RawRoad -> RoadGeometry + RoadFeatures (labels estimated fields)
         accident_data.py       real historical crash lookup near a road (Kaggle US-Accidents,
                                 backend/accidents.db — see "Historical crash data" below)
         risk_engine.py         RoadFeatures -> explainable 0-100 risk score + star rating
         traffic_sim.py         IDM microsimulation + TTC conflict detection
         intervention_engine.py catalog of interventions as feature-space transforms
         optimizer.py           brute-force search over the intervention powerset
         priority_map.py        cross-road prioritization over roads actually scanned
         road_store.py          fetch/build orchestration (live OSM/OSRM with demo fallback)
         road_db.py             SQLite-backed catalog of every road scanned so far
                                 (backend/roadtwin.db) — survives a backend restart

   +-- scripts/
         build_accident_grid.py  one-time ETL: Kaggle US-Accidents CSV -> backend/accidents.db
                                  (a lat/lon grid of real crash aggregates) + a correlation report
```

Every endpoint degrades gracefully: if Overpass is unreachable, `road_store` falls back to OSRM,
then the demo catalog. The app never hard-fails due to network conditions or a missing API key
(no key is required anywhere in this build — OpenStreetMap/Overpass/OSRM are free and
unauthenticated, and the map tiles are plain OpenStreetMap raster tiles for the same reason).

### Frontend

Three top-level pages under React Router, sharing one persistent top nav (`app/Shell.tsx`,
`app/TopNav.tsx`):

- **Atlas** (`/`) — a country-wide (US) dark map of every road RoadTwin has actually scanned
  (`features/atlas/`), color-coded by risk tier. This is the landing experience: it makes clear
  at a glance that RoadTwin is a road-scanning platform, not a single-road demo.
- **Digital Twin** (`/twin/:roadId`) — the 3D simulation workspace for one road
  (`features/twin/`): risk gauge, road-intelligence breakdown, interventions/optimizer,
  before/after comparison, and the procedural 3D scene (`features/twin/scene/`). `:roadId` of
  `new` triggers a live scan and then replaces the URL with the resulting road's real id, so
  every twin view is a shareable, deep-linkable link. The legacy `?autodemo=<id>` / `?road=<id>`
  query-param deep links (from earlier builds) still work — `AtlasPage` forwards them into the
  route on load.
- **Priority Map** (`/priority`) — ranks scanned roads by estimated intervention priority.

Design tokens (`tailwind.config.js`, `styles/index.css`) are a single ink/brand/risk color scale —
a deep near-black "cyber-infrastructure" base with a glowing telemetry-cyan brand accent, glass-blur
surfaces, and JetBrains Mono for data/Plus Jakarta Sans for UI — every panel draws from these rather
than one-off values.

## The computational pipeline

```
INPUT DATA (OSM way geometry + tags, or demo catalog)
   -> FEATURE EXTRACTION (geometry.py + feature_extraction.py: curvature, speed, volume, lighting,
      sidewalks, crossings, signals, guardrail, slope, water/school/hospital proximity)
   -> RISK MODEL (risk_engine.py: named, additive point contributions per factor, 0-100 score)
   -> SIMULATION (traffic_sim.py: IDM car-following + signal phases + TTC conflict detection)
   -> INTERVENTION (intervention_engine.py: mutates the SAME feature object the risk model reads)
   -> NEW RESULT (risk model + simulation re-run on the mutated features -> before/after)
```

Nothing in this pipeline is a fabricated/random number. If a value can't be sourced from
OpenStreetMap (traffic volume, lighting, slope when unspecified, etc.) it is filled with a
transparent, documented fallback assumption and listed in `RoadFeatures.estimated`, which the UI
surfaces under "Estimated (not directly sourced)" in the Why panel.

### Risk model

Additive, fully explainable. Each factor is a named function of real features, e.g.:

- `sharp_curvature`: `4 * sharp_turn_count`, capped at 16
- `no_guardrail`: `+12` if a hazardous curve/slope/water edge has no guardrail, else `+7`
- `unprotected_dropoff`: `+12` if `slope_pct > 10` and no guardrail (the cliff-road scenario)
- `no_sidewalk`: `+10` near a school/hospital, else `+4`
- `high_vehicle_speed`, `high_traffic_volume`, `no_street_lighting`, `unlit_blind_curves`,
  `uncontrolled_intersections`, `insufficient_crossings`, `steep_grade`, `unprotected_water_edge`
- `historical_crash_record`: real recorded crashes near this road's actual coordinates (see
  "Historical crash data" below) — up to `+14` from crash density, `+3` from traffic impact.
  Unlike every other factor, this one is **not** reduced by simulated interventions: real crash
  history is a fixed fact, not a mutable feature, so it sets a floor under how far the score can
  drop for a road with an established crash record (see the flagship demo walkthrough below).

See `backend/app/services/risk_engine.py` for the full, exact list. Total is clamped to 0-100.
Star rating is derived from the *safety* score (`100 - risk`), matching the UI convention that more
stars = safer: `80-100 safety -> full care applied`, mapped in `_category_label` /
`risk.stars = round((100 - risk) / 20, 1)`.

### Historical crash data

`backend/scripts/build_accident_grid.py` is a one-time offline ETL over the Kaggle
[US-Accidents](https://www.kaggle.com/datasets/sobhanmoosavi/us-accidents) dataset (7,728,394 real
US crashes, 2016-2023, not checked into the repo — ~3GB CSV, download it yourself and point the
script at it). It streams the CSV once and reduces it to two artifacts:

1. `backend/accidents.db` — a SQLite table of real crash counts/traffic-impact aggregated onto a
   ~500m lat/lon grid. `accident_data.py` queries this at request time (never the raw CSV) for any
   scanned road, real or demo, by looking up the grid cells within ~500m of its actual polyline —
   same "SQLite-backed catalog" pattern as `road_db.py`, pre-populated once instead of grown live.
2. `backend/accident_correlations.json` — average traffic-impact severity split by the same
   real/estimated conditions `risk_engine.py` already scores (signal presence, junction, night,
   adverse weather), used to sanity-check those hand-set point weights against 7.7M real outcomes
   rather than tuning them by feel. The full numbers and what they did (and didn't) change are in
   `risk_engine.py`'s own comments next to `HISTORICAL_SEVERITY_BASELINE`.

**Important honesty note**: the dataset's own `Severity` field (1-4) is documented by its author as
*traffic impact* — how long a delay the crash caused — not injury or fatality severity. This app
never presents it as "how dangerous" for that reason; every UI label calls it "traffic impact."

Neither artifact is required to run the app — `accident_data.available()` returns `False` and every
downstream number zeroes out gracefully (same posture as Overpass/OSRM being unreachable) if
`accidents.db` hasn't been built.

```powershell
# One-time, after downloading the Kaggle CSV somewhere local:
.venv\Scripts\python.exe scripts\build_accident_grid.py path\to\US_Accidents_March23.csv
```

### Traffic simulation

A microscopic simulation using the **Intelligent Driver Model (IDM)** for car-following, run
server-side for a fixed horizon (frames are only shipped back for the requested playback window,
but the physics run longer internally so delay/conflict statistics aren't structurally zero on
long roads). Notable additions beyond textbook IDM:

- **Curve-speed profile**: each vehicle's desired speed is locally reduced near sharp bends (with
  ~15m look-ahead), so vehicles actually brake for hairpins — this is what makes the coastal cliff
  road scenario visually and numerically distinct from a straight highway.
- **Driver heterogeneity**: ~40% of simulated drivers are modeled with a longer reaction lag
  (2.4s vs. 1.0s) and less curve compliance. Pure textbook IDM is deliberately collision-avoidant
  and essentially never produces a near-miss; without heterogeneity, conflict counts would be
  structurally ~0 on every road, which would be dishonest given the UI reports them as a real
  metric. This mechanism is documented, not a random number generator.
- **Time-to-collision (TTC) conflict detection**: pairwise, every step, using ground-truth
  kinematics (not the delayed perception used for the *control* decision) — `TTC < 2.5s` is
  flagged.
- **Signal phases**: 18s green / 12s red, gates the lead vehicle at each signal position.

### Interventions & optimizer

Interventions (`intervention_engine.py`) are transformations on the **same `RoadFeatures` object**
the risk model and simulator read — e.g. `guardrail` sets `guardrail_present = True`,
`speed_reduction` scales `speed_limit_kmh` by 0.75 and the simulator's target speed accordingly.
This is why guardrail/sidewalk/lighting mostly move the *risk score* (they address risks the traffic
simulation doesn't model — run-off-road, pedestrian exposure, nighttime visibility) while
speed/signal interventions move the *simulation metrics* (delay, conflicts) — the before/after
panel is honest about this rather than making every intervention move every number.

The optimizer (`optimizer.py`) brute-forces the powerset of the road's own applicable interventions
(at most 7 items → 128 combinations), re-running the real risk model and a real (shortened)
simulation for every combination, then ranks by objective (`safety`, `traffic`, `budget`, `balanced`).

### Customized interventions

Every `applicable_check` in `intervention_engine.py`'s catalog mirrors the EXACT condition
`risk_engine.py` uses to trigger the factor that intervention addresses (e.g. `guardrail` requires
the same `sharp_turn_count > 0 or near_water or slope_pct > 5` hazard-edge check `no_guardrail`
does, not just "no guardrail present") — an intervention that wouldn't actually move a road's score
is never offered for it, rather than shown disabled. `GET /interventions/catalog/{road_id}` returns
only that road's real menu, so two roads with different risk factors get genuinely different lists,
not the same fixed 7 items with some grayed out.

Real accident history (see below) can additionally unlock an intervention the static OSM-tag proxy
alone wouldn't have — `accident_evidence()` compares a road's own nearby crash mix (night %,
junction %, crossing %) against the *national baseline* for that condition (from the same 7.73M-row
dataset), and only when a road's local pattern is meaningfully above the norm does the matching
intervention gain a real-data justification string, shown in the UI as "Backed by real crash data
near this road: …". A `pedestrian_crossing` recommendation is skipped on a road tagged
motorway/trunk regardless of what the crash buffer found nearby — a limited-access road doesn't
carry pedestrians, no matter what real crashes happen to be recorded in the ~500m search radius
around it.

### Priority map ("government mode")

`priority_map.py` ranks every road actually scanned so far (`road_db`, optionally + a small fresh
live-discovery sample) by `risk_score × traffic_exposure × pedestrian_exposure / cost_factor`,
where the exposure/cost factors are kept as moderate (~0.7-1.6x) multipliers specifically so risk
remains the primary sort key — this is a labeled prototype heuristic, not an official budgetary
methodology. The curated demo roads are deliberately excluded from this ranking (and from the
Atlas map) — their geometry is an authored illustrative curve, not a live-traced street, so
ranking them alongside genuinely scanned roads would be misleading; they stay reachable
individually via the Demo button / `?autodemo=`.

## Data honesty

- No step in this pipeline invents a number to "look like AI." Every score traces to a named
  contribution or a real simulation output.
- Fields not sourced from live data are listed under `RoadFeatures.estimated` and surfaced in the UI.
- Language is deliberately hedged: "risk estimate", "simulation result", "prototype methodology" —
  never "this road will cause accidents" or "officially dangerous."

## Running it

Requires Python 3.11+ and Node 18+. No API keys needed.

```powershell
# Backend
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --port 8000 --host 127.0.0.1

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to `http://127.0.0.1:8000`.
You land on the Atlas (`/`) — a map of every road scanned so far (empty on a fresh database).

### Demo

Click **Demo** in the top nav (or open `http://localhost:5173/twin/pch_cliff_road`, or the
legacy `http://localhost:5173/?autodemo=pch_cliff_road`) to jump straight to the flagship
scenario: a Pacific Coast Highway switchback above the Big Sur coastline with no guardrail scores
**CRITICAL (0.2★, risk ~95/100)** — real recorded crash history near this stretch (see
"Historical crash data" below) now contributes to that on top of the geometry/infrastructure
factors. Open **Road Intel**, then **Interventions**. Guardrail + Reduce Speed Environment alone
now only gets you to **HIGH (~1.9★, risk ~61)**: real crash history is a fixed, real-world fact
that intervening today can't retroactively erase, so it caps how far any combination can bring the
score down. Click **Apply Recommended Combination** after running the optimizer for its best
4-intervention combo (guardrail, speed, lighting, road markings) — risk drops to **MODERATE
CONCERN (~2.5★, risk ~50)**, with simulated conflicts and delay dropping to zero in the
Before/After panel. Only interventions that actually address one of this road's own real risk
factors are offered in the first place (see "Customized interventions" below) — a flat highway
merge, for instance, is never offered a pedestrian crossing.

Click **Scan Random Road** to pull a real road from OpenStreetMap (San Francisco, Big Sur,
Manhattan, Golden CO, Chicago Loop, or Seattle) via the Overpass API. If Overpass is unreachable,
it falls back to OSRM, then the demo catalog — the app never breaks. Every real scan is saved to
`backend/roadtwin.db` and immediately shows up as a new road on the Atlas map, across restarts.

`/twin/new` (used by both "Scan Random Road" buttons) triggers a live scan and then replaces the
URL with the resulting road's real id, so the result is a normal shareable link. The legacy
`?autodemo=<road_id>` (any demo road id, or `?autodemo` alone for a live random scan) and
`?road=<id>` query-param deep links still work — they're forwarded into the `/twin/:roadId` route
on load.

**Priority Map** (top nav) ranks scanned roads by estimated intervention priority; clicking a row
loads that road's digital twin.

## Third-party assets

- Vehicle models: [Kenney Car Kit](https://opengameart.org/content/car-kit) (CC0, kenney.nl),
  self-hosted under `frontend/public/models/cars/`.
- Tree models: [Kenney Nature Kit](https://opengameart.org/content/nature-kit) (CC0, kenney.nl),
  self-hosted under `frontend/public/models/trees/`.
- Building models (used as a fallback when a road has no real OSM footprint data — see below):
  [Kenney City Kit Commercial](https://opengameart.org/content/city-kit-commercial) (CC0, kenney.nl),
  self-hosted under `frontend/public/models/buildings/`.
- Guardrail, streetlight, and hazard-sign models: [Kenney City Kit Roads](https://opengameart.org/content/city-kit-roads)
  and [Kenney Racing Kit](https://opengameart.org/content/racing-kit) (both CC0, kenney.nl),
  self-hosted under `frontend/public/models/props/`.
- None of the above require attribution (CC0), credited here anyway. Everything else in the 3D
  scene (sky, terrain, road, guardrails, signals, all textures) is generated procedurally at
  runtime — the sky is a real-time atmospheric scattering sky (`@react-three/drei`'s `<Sky>`)
  with a matching directional sun light, not an image.

## Real building footprints

For roads sourced from live OSM, the Overpass query also pulls `way["building"]` footprints in
the same bbox as the road (`osm_provider.py`), filters to ones near the road, and projects them
into the *same local coordinate frame as the road polyline* (`geometry.project_ref`, keyed to a
shared reference point — this was the part that would silently misalign if each geometry set
picked its own centroid). The frontend (`Scenery.tsx`) extrudes each footprint's real outline with
`THREE.ExtrudeGeometry` instead of placing a random box — actual building shapes, not guesses.
Demo roads (and live roads with no nearby OSM building data) have no footprints, so the scene falls
back to procedural box placement — this is the graceful-degradation path, not a bug.

## What's a deliberate scope cut

- Per-segment risk (spec section 11's "SEGMENT 17: risk 82/100") is represented as whole-road risk
  plus curvature/guardrail-driven hazard markers in the 3D view, rather than N independently-scored
  sub-segments — the risk model already explains *why* at the road level, and splitting it further
  didn't add signal for a single-road demo.
- Weather, elevation-API integration, and photorealistic 3D tiles are out of scope for the time
  budget; the procedural digital twin (extruded road ribbon, procedural terrain/buildings/trees,
  guardrail/lighting/signal/crossing meshes) stands in, and is real geometry driven by the same
  `RoadFeatures` the risk model uses (not decorative).
- Cross-traffic collision risk at unsignalized intersections isn't simulated (would require
  simulating a second, perpendicular traffic stream) — that risk is captured in the static risk
  model's `uncontrolled_intersections` factor instead, and the `signal_control` intervention is
  scored there, not invented in the simulator.
