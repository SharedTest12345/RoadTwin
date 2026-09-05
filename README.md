# RoadTwin

RoadTwin turns a real-world road into an interactive digital twin, estimates its safety/traffic
risk with an explainable model, simulates traffic and driver-conflict behavior on it, and lets you
simulate infrastructure interventions to see the projected before/after impact.

**RoadTwin provides analytical risk estimates and simulation-based recommendations. It is not an
official road-safety certification or engineering assessment.**

---

## Architecture

```
frontend (React + TS + Vite + React Three Fiber)
   |  fetch /api/* (proxied to backend in dev)
   v
backend (FastAPI)
   |
   +-- providers/            RoadDataProvider abstraction
   |     osm_provider.py       live OpenStreetMap discovery via Overpass API (no key required)
   |     demo_provider.py      curated fallback road catalog (used if OSM is unreachable)
   |
   +-- services/
         geometry.py            haversine length, local ENU projection, curvature/heading
         feature_extraction.py  RawRoad -> RoadGeometry + RoadFeatures (labels estimated fields)
         risk_engine.py         RoadFeatures -> explainable 0-100 risk score + star rating
         traffic_sim.py         IDM microsimulation + TTC conflict detection
         intervention_engine.py catalog of interventions as feature-space transforms
         optimizer.py           brute-force search over the intervention powerset
         priority_map.py        cross-road prioritization ("government mode")
         road_store.py          in-memory cache + live/demo orchestration
```

Every endpoint degrades gracefully: if Overpass is unreachable, `road_store` falls back to the
demo catalog automatically. The app never hard-fails due to network conditions or a missing API key
(no key is required anywhere in this build — OpenStreetMap/Overpass is free and unauthenticated).

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

See `backend/app/services/risk_engine.py` for the full, exact list. Total is clamped to 0-100.
Star rating is derived from the *safety* score (`100 - risk`), matching the UI convention that more
stars = safer: `80-100 safety -> full care applied`, mapped in `_category_label` /
`risk.stars = round((100 - risk) / 20, 1)`.

### Traffic simulation

A microscopic simulation using the **Intelligent Driver Model (IDM)** for car-following, run
server-side for a fixed horizon (frames are only shipped back for the requested playback window,
but the physics run longer internally so delay/conflict statistics aren't structurally zero on
long roads). Notable additions beyond textbook IDM:

- **Curve-speed profile**: each vehicle's desired speed is locally reduced near sharp bends (with
  ~15m look-ahead), so vehicles actually brake for hairpins — this is what makes the ghat/cliff
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

The optimizer (`optimizer.py`) brute-forces the powerset of applicable interventions (at most 7
items → 128 combinations), re-running the real risk model and a real (shortened) simulation for
every combination, then ranks by objective (`safety`, `traffic`, `budget`, `balanced`).

### Priority map ("government mode")

`priority_map.py` ranks the demo road set (optionally + a small live OSM sample) by
`risk_score × traffic_exposure × pedestrian_exposure / cost_factor`, where the exposure/cost
factors are kept as moderate (~0.7-1.6x) multipliers specifically so risk remains the primary
sort key — this is a labeled prototype heuristic, not an official budgetary methodology.

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

### Demo

Click **Demo** in the top bar (or open `http://localhost:5173/?autodemo=ghat_cliff_road`) to jump
straight to the flagship scenario: a Western Ghats switchback road with no guardrail scores
**CRITICAL (0.9★, risk 81/100)**. Open **Why is this road risky?**, then **Interventions**, and
apply **Guardrail + Reduce Speed Environment** (or click **Apply Recommended Combination** after
running the optimizer) — risk drops to **MODERATE CONCERN (~2.6★, risk ~47)**, with simulated
conflicts and delay dropping to zero in the Before/After panel.

Click **Scan Random Road** to pull a real road from OpenStreetMap (Bengaluru, Mumbai, Lonavala
Ghat, Delhi, Gurugram, or Alappuzha) via the Overpass API. If Overpass is unreachable, it falls
back to the demo catalog automatically — the app never breaks.

`?autodemo=<road_id>` (any demo road id, or `?autodemo` alone for a live random scan) deep-links
directly into a loaded scenario — useful for demos and screenshots.

**Priority Map** (top bar) ranks all demo roads by estimated intervention priority; clicking a row
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
- Environment lighting: a night-sky HDRI from [Poly Haven](https://polyhaven.com) (CC0),
  self-hosted under `frontend/public/hdri/`.
- None of the above require attribution (CC0), credited here anyway. Everything else in the 3D
  scene (terrain, road, guardrails, signals, all textures) is generated procedurally at runtime.

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
