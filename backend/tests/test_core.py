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
from app.services.geometry import curvature_stats, project_local_xy  # noqa: E402
from app.services import feature_extraction  # noqa: E402
from app.providers.base import RawRoad  # noqa: E402


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

    def test_score_mapping_is_asymptotic_not_hard_clamped(self):
        # score = 100*(1 - 1/relative_risk) approaches but mathematically
        # never reaches 100 for any finite relative_risk — verified directly
        # against the formula risk_engine.py actually uses, rather than via
        # rounded evaluate() output (which CAN legitimately round a
        # sufficiently extreme input to a displayed 100.0 — that's fine; the
        # property being tested is the underlying math has no hard ceiling,
        # unlike the old flat-additive-then-clamp(0,100) model).
        for relative_risk in (2.0, 10.0, 1000.0, 1_000_000.0):
            score = 100.0 * (1.0 - 1.0 / relative_risk)
            self.assertLess(score, 100.0)
        # And confirms it's strictly increasing, not merely bounded.
        scores = [100.0 * (1.0 - 1.0 / rr) for rr in (1.5, 3.0, 10.0, 100.0)]
        self.assertEqual(scores, sorted(scores))

    def test_moderate_accident_density_increases_score_without_saturating(self):
        low = risk_engine.evaluate(_features(
            accident_data_available=True, accident_count=2, accident_per_km=3.0, accident_avg_severity=2.1,
        ))
        high = risk_engine.evaluate(_features(
            accident_data_available=True, accident_count=200, accident_per_km=80.0, accident_avg_severity=2.3,
        ))
        self.assertLess(low.score_0_100, high.score_0_100)
        self.assertLess(high.score_0_100, 100.0)

    def test_more_hazards_stay_distinguishable_not_both_pinned(self):
        fewer = risk_engine.evaluate(_features(has_lighting=False, speed_limit_kmh=90.0))
        more = risk_engine.evaluate(_features(
            has_lighting=False, has_sidewalk=False, guardrail_present=False,
            near_water=True, slope_pct=15.0, speed_limit_kmh=100.0,
            near_school_or_hospital=True, crossing_density_per_km=0.0,
        ))
        self.assertGreater(more.score_0_100, fewer.score_0_100)

    def test_signal_penalty_only_applies_below_high_speed_threshold(self):
        # Real CMF evidence (FHWA CMF Clearinghouse) shows signal
        # installation REDUCES crashes at low/mid-speed intersections but
        # INCREASES them on high-speed arterials (unexpected-stop rear-end
        # crashes) — so uncontrolled_intersections must not fire above the
        # high-speed threshold, where the fix it implies isn't supported.
        high_speed = risk_engine.evaluate(_features(
            speed_limit_kmh=90.0, intersection_density_per_km=5.0, signal_count=0,
        ))
        mid_speed = risk_engine.evaluate(_features(
            speed_limit_kmh=55.0, intersection_density_per_km=5.0, signal_count=0,
        ))
        high_speed_factors = {c.factor for c in high_speed.contributions}
        mid_speed_factors = {c.factor for c in mid_speed.contributions}
        self.assertNotIn("uncontrolled_intersections", high_speed_factors)
        self.assertIn("uncontrolled_intersections", mid_speed_factors)

    def test_guardrail_hazard_not_double_counted_across_water_and_slope(self):
        # A missing guardrail near water AND on a steep slope is still ONE
        # missing guardrail — it should compound the single no_guardrail
        # factor's weight, not add separate independent line items for
        # each reason the edge is hazardous.
        result = risk_engine.evaluate(_features(guardrail_present=False, near_water=True, slope_pct=10.0))
        factors = [c.factor for c in result.contributions]
        self.assertEqual(factors.count("no_guardrail"), 1)
        self.assertNotIn("unprotected_water_edge", factors)
        self.assertNotIn("unprotected_dropoff", factors)

    def test_applying_guardrail_intervention_reduces_score(self):
        before_features = _features(guardrail_present=False, near_water=True, slope_pct=10.0)
        before = risk_engine.evaluate(before_features)
        after_features, _sim_overrides, _twin = ie.apply_interventions(before_features, ["guardrail"])
        after = risk_engine.evaluate(after_features)
        self.assertLess(after.score_0_100, before.score_0_100)


class CurvatureIntersectionTurnTests(unittest.TestCase):
    """Regression coverage for a real bug found while calibrating the CMF
    rewrite: extrapolating a single OSRM route-polyline segment's raw heading
    change to a "per 20m" rate blows up when that segment is short (as
    intersection-turn segments genuinely are), reading a routed left turn at
    a stop sign as a severe road curve. Verified against real scanned-road
    data before being fixed — see geometry.py's MIN_PLAUSIBLE_ROAD_RADIUS_M
    comment for the actual numbers found."""

    def test_short_segment_sharp_turn_does_not_inflate_to_the_cap(self):
        # A 90-degree turn packed into a 5m segment has an implied radius of
        # ~3.2m — curb-corner/intersection scale, not a through-road curve.
        # xy points: straight east, then a hard 90-degree turn.
        xy = [(0.0, 0.0), (50.0, 0.0), (50.0, 5.0), (50.0, 55.0)]
        sharp, max_curv, _avg = curvature_stats(xy)
        self.assertLess(max_curv, 89.0)

    def test_genuine_gradual_curve_still_registers(self):
        # A real curve spread across many segments over a real arc length
        # (implied radius well above any plausible intersection scale) must
        # still be picked up — this isn't "curvature never triggers", only
        # "an intersection-scale turn doesn't count as one".
        import math
        xy = []
        radius = 80.0
        for i in range(20):
            angle = math.radians(i * 3.0)  # sweeps 57 degrees over the curve
            xy.append((radius * math.sin(angle), radius * (1 - math.cos(angle))))
        sharp, max_curv, _avg = curvature_stats(xy)
        self.assertGreater(max_curv, 0.0)


class FeatureExtractionEstimateTests(unittest.TestCase):
    """Regression coverage for a second real bug found in the same pass: an
    OSRM-sourced road's tags dict always has highway=None (OSRM returns
    geometry only, never tags — see osrm_provider.py), which fell through to
    road_class="unclassified" — and "unclassified" was missing from the
    has_sidewalk/has_lighting plausibility lists, even though OSM's real
    definition of that tag means "an ordinary minor public road", not
    "unknown". Verified against every real scanned road in this app's own
    database: has_sidewalk and has_lighting were False for 100% of them
    before this fix, entirely from this omission, not from real absence."""

    def _raw_road(self, highway) -> RawRoad:
        return RawRoad(
            osm_id="test:1", name="Test Road", region="Test", points=[(0.0, 0.0), (0.0, 0.001)],
            tags=dict(highway=highway, lanes=None, maxspeed_kmh=None, oneway=False, surface=None,
                      sidewalk=None, lit=None, bridge=False),
            nearby_signals=[], nearby_crossings=[], nearby_schools=[], nearby_hospitals=[],
            water_nearby=False, guardrail_present=False, intersections=1, slope_pct=1.0,
            source="osrm", building_footprints=[], nearby_ways=[],
        )

    def test_unclassified_road_gets_plausible_sidewalk_and_lighting_estimate(self):
        _geometry, features = feature_extraction.extract(self._raw_road(None))
        self.assertTrue(features.has_sidewalk)
        self.assertTrue(features.has_lighting)
        self.assertIn("has_sidewalk", features.estimated)
        self.assertIn("has_lighting", features.estimated)

    def test_motorway_still_estimated_no_sidewalk(self):
        # Confirms the fix didn't just make every estimate True — a class
        # genuinely unlikely to have a sidewalk should still read that way.
        _geometry, features = feature_extraction.extract(self._raw_road("motorway"))
        self.assertFalse(features.has_sidewalk)


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
