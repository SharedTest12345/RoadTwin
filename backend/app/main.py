"""RoadTwin FastAPI application.

Pipeline: road_store (provider abstraction + cache) -> feature_extraction ->
risk_engine -> traffic_sim -> intervention_engine -> optimizer -> priority_map.
Every endpoint degrades gracefully to the demo dataset if live OSM data is
unavailable — the app must never hard-fail because of network conditions.
"""
import logging
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .models.schemas import (
    Road, SimResult, SimulationRunRequest, InterventionOption, InterventionSimulateRequest,
    InterventionSimulateResult, OptimizeRequest, OptimizeResult, PriorityMapResult,
)
from .services import road_store, traffic_sim, intervention_engine as ie, risk_engine, optimizer, priority_map

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("roadtwin")

app = FastAPI(title="RoadTwin API", version="0.1.0",
              description="Road digital twin, risk estimation, traffic simulation and intervention optimization.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS if config.CORS_ORIGINS != ["*"] else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "live_osm_enabled": config.USE_LIVE_OSM}


@app.get("/roads/random", response_model=Road)
def roads_random(live: bool = Query(True, description="Attempt live OSM discovery before falling back to demo data")):
    return road_store.get_random_road(prefer_live=live)


@app.get("/roads/{road_id}", response_model=Road)
def roads_get(road_id: str):
    road = road_store.get_road(road_id)
    if not road:
        raise HTTPException(404, f"Road '{road_id}' not found")
    return road


@app.post("/roads/analyze", response_model=Road)
def roads_analyze(body: dict):
    road_id = body.get("road_id")
    road = road_store.get_road(road_id)
    if not road:
        raise HTTPException(404, f"Road '{road_id}' not found")
    return road


@app.get("/interventions/catalog/{road_id}", response_model=List[InterventionOption])
def interventions_catalog(road_id: str):
    road = road_store.get_road(road_id)
    if not road:
        raise HTTPException(404, f"Road '{road_id}' not found")
    return ie.get_catalog(road.features)


@app.post("/simulation/run", response_model=SimResult)
def simulation_run(body: SimulationRunRequest):
    road = road_store.get_road(body.road_id)
    if not road:
        raise HTTPException(404, f"Road '{body.road_id}' not found")
    features = road.features
    speed_scale, add_signal = 1.0, False
    if body.intervention_ids:
        features, overrides, _twin = ie.apply_interventions(road.features, body.intervention_ids)
        speed_scale, add_signal = overrides["speed_scale"], overrides["add_signal"]
    return traffic_sim.run_simulation(road.geometry, features, duration_s=body.duration_s,
                                       speed_scale=speed_scale, add_signal=add_signal)


@app.post("/interventions/simulate", response_model=InterventionSimulateResult)
def interventions_simulate(body: InterventionSimulateRequest):
    road = road_store.get_road(body.road_id)
    if not road:
        raise HTTPException(404, f"Road '{body.road_id}' not found")

    before_risk = road.risk
    before_sim = traffic_sim.run_simulation(road.geometry, road.features, duration_s=45.0).metrics

    new_features, overrides, twin_changes = ie.apply_interventions(road.features, body.intervention_ids)
    after_risk = risk_engine.evaluate(new_features)
    after_sim = traffic_sim.run_simulation(road.geometry, new_features, duration_s=45.0,
                                            speed_scale=overrides["speed_scale"],
                                            add_signal=overrides["add_signal"]).metrics

    applied = [o for o in ie.get_catalog(road.features) if o.id in body.intervention_ids]
    return InterventionSimulateResult(
        road_id=road.id, before_risk=before_risk, after_risk=after_risk,
        before_sim=before_sim, after_sim=after_sim, applied=applied, twin_changes=twin_changes,
    )


@app.post("/interventions/optimize", response_model=OptimizeResult)
def interventions_optimize(body: OptimizeRequest):
    road = road_store.get_road(body.road_id)
    if not road:
        raise HTTPException(404, f"Road '{body.road_id}' not found")
    result = optimizer.optimize(road.geometry, road.features, body.objective, body.budget_cap)
    result.road_id = road.id
    return result


@app.get("/priority-map", response_model=PriorityMapResult)
def priority_map_get(live_sample: bool = Query(False, description="Include a small live OSM sample alongside the demo set")):
    return priority_map.build(include_live_sample=live_sample)
