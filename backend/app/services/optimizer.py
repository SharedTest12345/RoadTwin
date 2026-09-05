"""Intervention optimizer: brute-force search over the powerset of applicable
interventions (<=7 items -> <=128 combinations, trivial to exhaust). Each
combination is scored with a REAL re-run of the risk model and a short traffic
simulation, not a heuristic guess."""
from itertools import combinations
from typing import List

from ..models.schemas import RoadFeatures, RoadGeometry, ComboEvaluation, OptimizeResult
from . import risk_engine
from . import traffic_sim
from . import intervention_engine as ie

OPT_SIM_DURATION_S = 35.0


def _powerset(ids: List[str]):
    for r in range(len(ids) + 1):
        for combo in combinations(ids, r):
            yield list(combo)


def optimize(geometry: RoadGeometry, features: RoadFeatures, objective: str,
             budget_cap: float | None = None) -> OptimizeResult:
    baseline_risk = risk_engine.evaluate(features).score_0_100
    baseline_sim = traffic_sim.run_simulation(geometry, features, duration_s=OPT_SIM_DURATION_S)
    baseline_delay = baseline_sim.metrics.avg_delay_s
    baseline_conflicts = baseline_sim.metrics.conflict_count

    applicable_ids = [o.id for o in ie.get_catalog(features) if o.applicable]

    evaluations: List[ComboEvaluation] = []
    max_cost = max(ie.total_cost(applicable_ids), 1.0)

    for combo in _powerset(applicable_ids):
        cost = ie.total_cost(combo)
        if budget_cap is not None and cost > budget_cap:
            continue
        new_features, sim_overrides, _twin = ie.apply_interventions(features, combo)
        risk_after = risk_engine.evaluate(new_features).score_0_100
        sim_after = traffic_sim.run_simulation(
            geometry, new_features, duration_s=OPT_SIM_DURATION_S,
            speed_scale=sim_overrides["speed_scale"], add_signal=sim_overrides["add_signal"],
        )
        delay_after = sim_after.metrics.avg_delay_s
        conflicts_after = sim_after.metrics.conflict_count
        risk_reduction = baseline_risk - risk_after
        conflict_reduction_pct = (
            (baseline_conflicts - conflicts_after) / baseline_conflicts * 100 if baseline_conflicts > 0 else 0.0
        )
        delay_reduction = baseline_delay - delay_after
        cost_norm = cost / max_cost

        if objective == "safety":
            score = risk_reduction
        elif objective == "traffic":
            score = delay_reduction + conflict_reduction_pct * 0.1
        elif objective == "budget":
            score = risk_reduction / max(cost / 100000.0, 0.1)
        else:  # balanced
            score = risk_reduction * 1.0 + delay_reduction * 0.4 + conflict_reduction_pct * 0.05 - cost_norm * 10

        evaluations.append(ComboEvaluation(
            intervention_ids=combo, names=ie.names_for(combo),
            risk_after=round(risk_after, 1), risk_reduction=round(risk_reduction, 1),
            cost_estimate_inr=cost, est_delay_after_s=round(delay_after, 1),
            est_conflict_reduction_pct=round(conflict_reduction_pct, 1),
            objective_score=round(score, 2),
        ))

    evaluations.sort(key=lambda e: -e.objective_score)
    best = evaluations[0] if evaluations else ComboEvaluation(
        intervention_ids=[], names=[], risk_after=baseline_risk, risk_reduction=0,
        cost_estimate_inr=0, est_delay_after_s=baseline_delay, est_conflict_reduction_pct=0, objective_score=0,
    )

    if best.intervention_ids:
        explanation = (
            f"Evaluated {len(evaluations)} intervention combinations under the '{objective}' objective. "
            f"Best result: {' + '.join(best.names)} — reduces risk from {baseline_risk:.0f} to "
            f"{best.risk_after:.0f} ({best.risk_reduction:.0f} point reduction) at an estimated cost of "
            f"₹{best.cost_estimate_inr:,.0f}, with simulated delay moving from {baseline_delay:.1f}s to "
            f"{best.est_delay_after_s:.1f}s."
        )
    else:
        explanation = "No applicable interventions were found for this road, or none fit the budget cap."

    return OptimizeResult(road_id="", objective=objective, best=best, evaluated=evaluations, explanation=explanation)
