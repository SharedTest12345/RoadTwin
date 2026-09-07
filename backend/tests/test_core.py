"""Minimal regression coverage for the highest-value pure logic: risk scoring
and intervention cost estimation. No pytest / new dependencies — stdlib
unittest only, so this runs anywhere the app itself runs.

Run from backend/:
    .venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models.schemas import RoadFeatures  # noqa: E402
from app.services import risk_engine, intervention_engine as ie  # noqa: E402


def _features(**overrides) -> RoadFeatures:
    base = dict(
        length_m=500.0, sharp_turn_count=0, max_curvature_deg_per_20m=0.0,
        avg_heading_change_deg=0.0, lanes=2, speed_limit_kmh=40.0,
        estimated_volume_vph=500.0, road_class="residential",
        has_sidewalk=True, has_lighting=True, crossing_density_per_km=2.0,
        signal_count=1, guardrail_present=False, slope_pct=1.0,
        near_water=False, near_school_or_hospital=False,
        intersection_density_per_km=1.0,
    )
    base.update(overrides)
    return RoadFeatures(**base)


class RiskEngineTests(unittest.TestCase):
    def test_score_is_clamped_0_100(self):
        result = risk_engine.evaluate(_features())
        self.assertGreaterEqual(result.score_0_100, 0)
        self.assertLessEqual(result.score_0_100, 100)

    def test_hazards_increase_score(self):
        safe = risk_engine.evaluate(_features())
        risky = risk_engine.evaluate(_features(
            has_lighting=False, has_sidewalk=False, speed_limit_kmh=90.0,
            slope_pct=12.0, near_water=True, crossing_density_per_km=0.0,
        ))
        self.assertGreater(risky.score_0_100, safe.score_0_100)

    def test_stars_move_opposite_to_risk(self):
        safe = risk_engine.evaluate(_features())
        risky = risk_engine.evaluate(_features(has_lighting=False, speed_limit_kmh=90.0))
        self.assertGreaterEqual(safe.stars, risky.stars)


class InterventionCostTests(unittest.TestCase):
    def test_linear_costs_scale_with_road_length(self):
        short = ie._cost_estimate("guardrail", _features(length_m=150.0))
        long_ = ie._cost_estimate("guardrail", _features(length_m=1500.0))
        self.assertGreater(long_, short)

    def test_point_costs_stay_flat_regardless_of_length(self):
        short = ie._cost_estimate("signal_control", _features(length_m=150.0))
        long_ = ie._cost_estimate("signal_control", _features(length_m=1500.0))
        self.assertEqual(short, long_)

    def test_every_catalog_item_has_a_positive_cost(self):
        f = _features()
        for d in ie.CATALOG:
            self.assertGreater(ie._cost_estimate(d.id, f), 0)

    def test_catalog_excludes_features_already_present(self):
        f = _features(has_lighting=True, guardrail_present=True, has_sidewalk=True,
                       signal_count=1, near_water=True, slope_pct=10.0)
        catalog_ids = {o.id for o in ie.get_catalog(f)}
        self.assertNotIn("street_lighting", catalog_ids)
        self.assertNotIn("guardrail", catalog_ids)
        self.assertNotIn("sidewalk", catalog_ids)
        self.assertNotIn("signal_control", catalog_ids)


if __name__ == "__main__":
    unittest.main()
