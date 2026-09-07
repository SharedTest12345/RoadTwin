"""Risk model grounded in real, published Crash Modification Factors (CMFs)
combined multiplicatively — the same convention FHWA's CMF Clearinghouse and
the AASHTO Highway Safety Manual (HSM) use for exactly this purpose — instead
of hand-tuned additive point weights. Every constant below cites where its
number comes from; where no reliable published CMF exists for a condition
RoadTwin flags, that's stated explicitly rather than inventing one to fill
the gap (see the "no established CMF" comments below).

Mechanics: each present hazard factor contributes a CMF (>1 = increases
relative crash risk vs. a road with none of these hazards) that MULTIPLIES a
baseline relative risk of 1.0. CMFs are combined in log-space — mathematically
identical to multiplying them (HSM Safety Performance Functions themselves
use a log-link, so real crash-frequency models already combine predictors
additively in log-space, this isn't an approximation of the convention, it
IS the convention) — then mapped to the public 0-100 score via:

    relative_risk = exp(sum(log(CMF_i) for every present factor))
    score = 100 * (1 - 1/relative_risk)

This asymptotically approaches 100 as relative_risk grows rather than hard-
clamping — a road with many severe hazards stays distinguishable from one
with a few, instead of both capping out at the same number the way a flat
additive-then-clamp model would. relative_risk=1 (no flagged hazards) ->
score=0; relative_risk=2 (double the baseline risk) -> score=50;
relative_risk=4 -> score=75. Per-factor "points" shown in the UI are each
factor's log(CMF) share of that score — they still sum to the total, so
every existing bar chart/report keeps working unchanged.

CAVEAT, stated honestly: FHWA's own guidance on combining multiple CMFs
(cmfclearinghouse.fhwa.dot.gov/collateral/combining_multiple_cmfs_final.pdf)
notes straight multiplication can OVERESTIMATE the combined effect once
several CMFs target overlapping crash types/mechanisms, and documents a more
involved "dominant CMF + residual" alternative for that case. Applying that
fully would need every CMF tagged by which specific crash type it targets,
which this app's feature set doesn't carry — so a score built from many
simultaneously-flagged hazards is a reasonable upper-bound estimate
consistent with that documented limitation, not a precision-calibrated
multi-factor model. The asymptotic score mapping above already partially
self-limits this (unlike a flat additive clamp, which has no such damping)."""
import math
from typing import List

from ..models.schemas import RoadFeatures, RiskResult, RiskContribution
from ..providers.base import PEDESTRIAN_EXEMPT_CLASSES
from . import accident_data

CATEGORIES = ["geometry", "traffic", "infrastructure", "pedestrian", "visibility", "environmental", "historical"]


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ============================================================================
# Real, cited Crash Modification Factors — see each comment for its source.
# FHWA/HSM CMFs are normally published as "installing countermeasure X
# changes crashes by this CMF" (CMF<1 = safer). RoadTwin's factors represent
# a countermeasure's ABSENCE, so each uses the inverse (1/install_CMF) as its
# relative-risk multiplier.
# ============================================================================

# Guardrail/barrier at a hazard edge: aggregate of FHWA CMF Clearinghouse
# studies on roadside barrier installation, run-off-road crashes, CMF~0.545
# (44-47% reduction) — https://safedesign.uky.edu/increase-use-of-roadside-barriers-and-end-terminals/
GUARDRAIL_INSTALL_CMF = 0.545
GUARDRAIL_ABSENCE_CMF = 1 / GUARDRAIL_INSTALL_CMF  # ~1.83

# Street lighting: FHWA Lighting Handbook, CMF=0.50 for NIGHTTIME crashes
# specifically (not all crashes) — https://highways.dot.gov/safety/other/
# visibility/fhwa-lighting-handbook-august-2012/policy-and-guidance
# Converted to an OVERALL (day+night) CMF by weighting against the real
# national night-crash share this app's own crash dataset carries
# (accident_data.NATIONAL_NIGHT_PCT) — lighting can only affect crashes that
# happen at night, so its effect on TOTAL risk is diluted by that share
# rather than applied at full strength to every crash.
LIGHTING_INSTALL_CMF_NIGHT = 0.50
_night_share = accident_data.NATIONAL_NIGHT_PCT / 100.0
LIGHTING_INSTALL_CMF_OVERALL = 1 - _night_share * (1 - LIGHTING_INSTALL_CMF_NIGHT)  # ~0.85
LIGHTING_ABSENCE_CMF = 1 / LIGHTING_INSTALL_CMF_OVERALL  # ~1.18

# Sidewalk: Gan, Shen & Rodriguez 2005, CMF Clearinghouse #11246, CMF=0.26
# for vehicle/pedestrian crashes after sidewalk installation (74% reduction)
# — https://cmfclearinghouse.fhwa.dot.gov/detail.php?facid=11246. Applied at
# full strength near a school/hospital (real, concentrated pedestrian
# exposure); the source study didn't separately quantify lower-exposure
# corridors, so elsewhere this uses the square root of the same CMF as an
# explicit, labeled exposure discount rather than presenting the full effect
# as equally applicable everywhere a sidewalk happens to be missing.
SIDEWALK_INSTALL_CMF = 0.26
SIDEWALK_ABSENCE_CMF_NEAR_PED = 1 / SIDEWALK_INSTALL_CMF  # ~3.85
SIDEWALK_ABSENCE_CMF_GENERAL = 1 / math.sqrt(SIDEWALK_INSTALL_CMF)  # ~1.96 — editorial exposure discount

# Marked pedestrian crossing enhancement: this app's own cost model already
# assumes an RRFB-tier crossing (see intervention_engine.py's
# CROSSING_COST_EACH), not paint-only — consistent with that, this uses the
# RRFB pedestrian-crash CMF (CMF Clearinghouse #11171) rather than a marked-
# crosswalk-alone number. That distinction matters: Zegeer et al. 2001
# (FHWA) found a marked crosswalk with NO other treatment can read as WORSE
# than no marking at all on a multi-lane road above ~12,000 AADT —
# https://highways.dot.gov/safety/pedestrian-bicyclist/safety-tools/
# pg-35-39-safety-effects-marked-versus-unmarked-crosswalks — which is
# exactly why this app never models the intervention as paint-only.
CROSSING_INSTALL_CMF = 0.53
CROSSING_ABSENCE_CMF = 1 / CROSSING_INSTALL_CMF  # ~1.89

# Signal installation at an uncontrolled intersection: HSM's own standard
# worked example, CMF=0.56 for total crashes — but ONLY at low/mid-speed
# intersections. A separate CMF Clearinghouse study on high-speed arterials
# (30-65 mph) found signal installation CMF=1.71 there — an INCREASE, from
# unexpected-stop rear-end crashes — so this factor only fires below a
# real-world "high-speed" threshold; above it, no signal-related penalty is
# applied at all rather than recommending a fix the evidence contradicts.
# Applied here as a corridor-level proxy for "frequent uncontrolled
# intersections" (this app tracks intersection density, not one specific
# unsignalized intersection) — a reasonable extension of the cited number,
# not a perfect match to the HSM worked example's exact scenario.
SIGNAL_INSTALL_CMF = 0.56
SIGNAL_ABSENCE_CMF = 1 / SIGNAL_INSTALL_CMF  # ~1.79
SIGNAL_HIGH_SPEED_THRESHOLD_KMH = 80.0  # ~50mph — below the 30-65mph band the reversal was measured in

# Speed: Nilsson's power model (Nilsson 1981/2004; OECD/iRAP-endorsed
# standard for speed-crash relationships) — relative crash risk scales with
# (v_new/v_old)^n, verified exponents n=4 fatal, n=3 serious-injury, n=2
# all-injury crashes. n=3 used here as the general-purpose exponent. Baseline
# 50 km/h is this app's own pre-existing "elevated speed" threshold (also
# the speed most Vision Zero guidance cites for pedestrian-survivable impact
# speed) — only speeds ABOVE it are penalized, matching a real safe-speed
# reference point rather than an arbitrary zero.
SPEED_BASELINE_KMH = 50.0
SPEED_NILSSON_EXPONENT = 3.0

# Traffic volume: HSM Safety Performance Functions consistently use a
# SUB-LINEAR (not proportional) AADT exponent — individual published SPFs
# vary roughly 0.4-0.7 depending on facility type, with no single universal
# number found. 0.5 (square-root) used here as a round, clearly-approximate
# midpoint of that range, not one specific cited coefficient — stated
# honestly rather than presenting false precision. Baseline raised from the
# original code's 150 veh/h to 500 (a typical unremarkable local/collector
# volume, not "any road busier than one car every 24 seconds") and the log
# contribution capped lower — neither the baseline nor the cap is itself an
# independently sourced number, both are this app's own calibration so an
# ordinary road's ordinary traffic doesn't out-weigh genuinely specific,
# cited hazards (a guardrail-less drop-off, a real local crash cluster).
VOLUME_BASELINE_VPH = 500.0
VOLUME_EXPONENT = 0.5
VOLUME_LOG_CAP = 0.5

# Horizontal curves: AASHTO HSM Equation 10-13 for rural two-lane roads —
# CMF = [1.55*Lc + 80.2/R - 0.012*S] / (1.55*Lc), verified via FHWA's own
# briefing sheet (https://highways.fhwa.dot.gov/sites/fhwa.dot.gov/files/
# 2022-06/cmf.pdf) — where Lc=curve length (mi), R=radius (ft), S=spiral-
# transition indicator. This app tracks aggregate curvature (max heading-
# change per 20m across the whole road), not individual curves' length/
# radius/spiral records, so the full per-curve equation isn't computable
# here. This uses just the radius term (80.2/R — the HSM's real coefficient,
# not an invented one) as a simplified per-road severity signal: max
# heading-change-per-20m is converted to an implied radius via the standard
# arc relationship (R = arc_length / heading_change_radians), then scored
# proportionally to 80.2/R. Explicitly NOT the complete cited equation —
# this app doesn't have the per-curve length/spiral data that would need.
CURVE_HSM_RADIUS_COEFFICIENT = 80.2  # feet — HSM Eq. 10-13's own coefficient
CURVE_LOG_SCALE = 0.75  # calibration: maps the HSM radius term into a log-CMF-sized contribution

# Real correlation pass over the Kaggle US-Accidents dataset (7,728,394 US
# crashes, 2016-2023 — see backend/scripts/build_accident_grid.py and the raw
# output in backend/accident_correlations.json). IMPORTANT: the dataset's own
# `Severity` field (1-4) is documented by its author as impact on TRAFFIC
# (how long a delay the crash caused), not injury/fatality severity — this
# code and the UI say "traffic impact" for that reason, never "how dangerous".
#
# Avg traffic-impact severity split by condition present at the crash site:
#   Traffic_Signal:  2.090 present  vs 2.234 absent  (n=1.14M / 6.58M)
#   Crossing:        2.064 present  vs 2.231 absent  (n=0.87M / 6.85M)
#   Stop sign:       2.076 present  vs 2.216 absent  (n=0.21M / 7.51M)
#   Junction:        2.298 present  vs 2.206 absent  (n=0.57M / 7.16M) — HIGHER,
#     not lower, when at a junction. Read together with the three rows above,
#     the pattern isn't "junctions are dangerous" but "a junction with a
#     signal/crossing/stop control sees a LESS traffic-impactful crash than
#     an uncontrolled one" — already captured by uncontrolled_intersections.
#   Night: 2.219 vs 2.209 — Adverse weather: 2.235 vs 2.210. Both essentially
#     flat (<1% difference) on THIS metric — that does NOT mean lighting/
#     weather don't matter for safety, it means traffic-delay impact
#     specifically isn't where their effect shows up. This dataset gives no
#     basis to change no_street_lighting's CMF-derived weight from this.
# Dataset-wide average (all 7.73M rows), used as the baseline below:
HISTORICAL_SEVERITY_BASELINE = 2.212
# Real local crash density is direct ground truth for a corridor, not a
# proxy — log-scaled (not linear) because raw density near a dense urban
# corridor can run into the thousands/km from the search buffer alone (it
# scales with how built-up the surrounding area is, not purely with genuine
# risk), the same way real crash-frequency models (Poisson/negative-binomial
# SPFs) use a log-link for count data rather than a linear one. This
# coefficient is this app's OWN calibration (not independently sourced — the
# search-buffer methodology is this app's invention, not a standard measure
# with a published density-to-CMF conversion), calibrated against RoadTwin's
# own scanned-road sample: across 144 real scanned roads, accident_per_km
# ranged 0-2596 with a MEDIAN of ~210/km — a naive higher scale made that
# median (a "typical" road, not a notably dangerous one) alone dominate the
# whole score, pushing every single scanned road into CRITICAL regardless of
# anything else true about it. Rescaled + capped so the sample's median
# reads as one moderate factor among several, and even its worst observed
# outlier (2596/km) stays comparable to, not many times larger than, the
# strongest cited CMF terms above.
HISTORICAL_DENSITY_LOG_SCALE = 0.075
HISTORICAL_LOG_CAP = 1.0


def _implied_radius_ft(deg_per_20m: float) -> float:
    """Radius of a circular arc whose heading changes `deg_per_20m` degrees
    over a 20m arc length — the standard R = arc_length / angle_radians
    relationship, converted to feet to match HSM Eq. 10-13's own units."""
    if deg_per_20m <= 0:
        return float("inf")
    radians = math.radians(deg_per_20m)
    radius_m = 20.0 / radians
    return radius_m * 3.28084


def compute_contributions(f: RoadFeatures) -> List[RiskContribution]:
    # (factor, category, log(CMF) contribution, description) — combined in
    # log-space (see module docstring) rather than as raw points.
    active: List[tuple] = []

    # --- geometry: horizontal curvature (HSM Eq. 10-13's radius term) ---
    if f.max_curvature_deg_per_20m > 8:
        radius_ft = _implied_radius_ft(f.max_curvature_deg_per_20m)
        severity_term = CURVE_HSM_RADIUS_COEFFICIENT / max(radius_ft, 1.0)
        log_cmf = _clamp(severity_term * CURVE_LOG_SCALE, 0, 0.9)
        active.append(("tight_curve_radius", "geometry", log_cmf,
                        f"Tight curve radius (~{radius_ft:.0f}ft implied, HSM Eq. 10-13 radius term)"))
    # Repeated curve exposure — more sharp turns along the corridor means
    # more independent opportunities for a curve-related crash, distinct
    # from how SHARP the single worst curve is above. Directionally real
    # (more curve events = more exposure) but not independently backed by
    # its own published CMF the way the radius term above is — kept small
    # and explicitly labeled as an editorial exposure adjustment.
    if f.sharp_turn_count > 1:
        log_cmf = _clamp(math.log(f.sharp_turn_count) * 0.06, 0, 0.3)
        active.append(("repeated_curve_exposure", "geometry", log_cmf,
                        f"{f.sharp_turn_count} sharp turns along this corridor (repeated exposure, not independently CMF-sourced)"))

    # --- traffic: speed (Nilsson power model) ---
    if f.speed_limit_kmh > SPEED_BASELINE_KMH:
        ratio = f.speed_limit_kmh / SPEED_BASELINE_KMH
        cmf = ratio ** SPEED_NILSSON_EXPONENT
        log_cmf = _clamp(math.log(cmf), 0, 2.0)
        active.append(("high_vehicle_speed", "traffic", log_cmf,
                        f"Elevated speed (~{f.speed_limit_kmh:.0f} km/h vs. {SPEED_BASELINE_KMH:.0f} km/h — Nilsson power model, n={SPEED_NILSSON_EXPONENT:.0f})"))
    # --- traffic: volume (sub-linear AADT relationship) ---
    if f.estimated_volume_vph > VOLUME_BASELINE_VPH:
        ratio = f.estimated_volume_vph / VOLUME_BASELINE_VPH
        cmf = ratio ** VOLUME_EXPONENT
        log_cmf = _clamp(math.log(cmf), 0, VOLUME_LOG_CAP)
        active.append(("high_traffic_volume", "traffic", log_cmf,
                        f"High estimated vehicle volume (~{f.estimated_volume_vph:.0f} veh/h)"))

    # --- infrastructure: guardrail (also covers the water-edge/steep-
    # dropoff cases below — see environmental section for why those don't
    # double-count this same missing barrier as three separate hazards) ---
    hazardous_edge = f.near_water or f.slope_pct > 5
    if not f.guardrail_present and hazardous_edge:
        # Compounding exposure (both near water AND a steep grade) uses the
        # same real CMF at slightly higher confidence rather than stacking
        # it as an independent second hazard — one missing guardrail is one
        # missing guardrail, however many reasons it's dangerous.
        compounding = f.near_water and f.slope_pct > 8
        log_cmf = math.log(GUARDRAIL_ABSENCE_CMF) * (1.15 if compounding else 1.0)
        active.append(("no_guardrail", "infrastructure", log_cmf,
                        "No guardrail on a curve/edge with drop-off exposure (FHWA CMF Clearinghouse, ~45% crash reduction when installed)"))
    # --- infrastructure: uncontrolled intersections (signal-absence CMF,
    # only where the evidence actually supports it — see constant comment) ---
    if f.intersection_density_per_km > 3 and f.signal_count == 0 and f.speed_limit_kmh < SIGNAL_HIGH_SPEED_THRESHOLD_KMH:
        log_cmf = math.log(SIGNAL_ABSENCE_CMF)
        active.append(("uncontrolled_intersections", "infrastructure", log_cmf,
                        "Frequent intersections with no signal control nearby (HSM signal-installation CMF)"))

    # --- pedestrian ---
    if f.road_class not in PEDESTRIAN_EXEMPT_CLASSES:
        if not f.has_sidewalk:
            if f.near_school_or_hospital:
                log_cmf = math.log(SIDEWALK_ABSENCE_CMF_NEAR_PED)
                desc = "No dedicated sidewalk near school/hospital (Gan et al. 2005, ~74% crash reduction when installed)"
            else:
                log_cmf = math.log(SIDEWALK_ABSENCE_CMF_GENERAL)
                desc = "No dedicated sidewalk"
            active.append(("no_sidewalk", "pedestrian", log_cmf, desc))
        if f.near_school_or_hospital and f.crossing_density_per_km < 1.5:
            log_cmf = math.log(CROSSING_ABSENCE_CMF)
            active.append(("insufficient_crossings", "pedestrian", log_cmf,
                            "Insufficient pedestrian crossings near school/hospital (RRFB-tier CMF Clearinghouse study)"))

    # --- visibility ---
    if not f.has_lighting:
        log_cmf = math.log(LIGHTING_ABSENCE_CMF)
        active.append(("no_street_lighting", "visibility", log_cmf,
                        "No street lighting (FHWA Lighting Handbook, night-crash CMF weighted by real national night-crash share)"))
        if f.sharp_turn_count > 0:
            # No published CMF found for this specific interaction (dark +
            # blind curve) — kept small and explicitly labeled rather than
            # presenting it as independently sourced.
            log_cmf = 0.12
            active.append(("unlit_blind_curves", "visibility", log_cmf,
                            "Blind curves compounded by absence of lighting (editorial estimate — not independently CMF-sourced)"))

    # --- environmental ---
    # No published CMF found for grade/slope specifically — kept small and
    # labeled, consistent with general engineering understanding that steep
    # grades increase braking/runaway-related risk, not a cited number.
    if f.slope_pct > 6:
        log_cmf = _clamp((f.slope_pct - 6) * 0.02, 0, 0.35)
        active.append(("steep_grade", "environmental", log_cmf,
                        f"Steep grade (~{f.slope_pct:.1f}%, editorial estimate — no published CMF found for grade specifically)"))
    # Water-edge/dropoff-without-guardrail is already priced into
    # `no_guardrail` above via its compounding multiplier — no separate
    # entry here, to avoid pricing the same missing barrier three times.

    # --- historical (real recorded crash data, Kaggle US-Accidents) — the
    # one factor backed by an actual measurement AT this corridor rather
    # than a general published relationship; see HISTORICAL_DENSITY_LOG_SCALE
    # above for how it's calibrated and why. ---
    if f.accident_data_available and f.accident_count > 0:
        density_log = math.log1p(f.accident_per_km) * HISTORICAL_DENSITY_LOG_SCALE
        # Traffic-impact severity: real correlation pass over 7.73M crashes
        # (backend/accident_correlations.json) found this moves only ~5-7%
        # across conditions this app can act on — kept as a small secondary
        # nudge, not a primary driver, matching that modest real effect size.
        impact_log = _clamp((f.accident_avg_severity - HISTORICAL_SEVERITY_BASELINE) * 0.15, 0, 0.15)
        log_cmf = _clamp(density_log + impact_log, 0, HISTORICAL_LOG_CAP)
        if log_cmf > 0:
            active.append(("historical_crash_record", "historical", log_cmf,
                            f"{f.accident_count} real recorded crash(es) within ~500m of this corridor since 2016 "
                            f"(~{f.accident_per_km:.1f}/km — US-Accidents dataset)"))

    if not active:
        return []

    log_total = sum(log_cmf for _, _, log_cmf, _ in active)
    if log_total <= 0:
        return []
    relative_risk = math.exp(log_total)
    score = 100.0 * (1.0 - 1.0 / relative_risk)

    contributions = []
    for factor, category, log_cmf, desc in active:
        share = log_cmf / log_total
        contributions.append(RiskContribution(
            factor=factor, category=category, points=round(score * share, 1), description=desc,
        ))
    return contributions


CATEGORY_THRESHOLDS = (
    # (min_score, label) — this is the ONE place risk tiers are defined. Every other
    # spot in the app (priority map buckets, frontend colors, star bands) must derive
    # from this table rather than re-declaring its own thresholds, which is exactly
    # how the header/badge/star inconsistencies crept in before.
    (80, "CRITICAL"),
    (60, "HIGH"),
    (40, "MODERATE"),
    (0, "LOW"),
)


def _category_label(score: float) -> str:
    for threshold, label in CATEGORY_THRESHOLDS:
        if score >= threshold:
            return label
    return "LOW"


def evaluate(f: RoadFeatures) -> RiskResult:
    contributions = compute_contributions(f)
    score = _clamp(sum(c.points for c in contributions), 0, 100)
    safety_score = 100 - score
    stars = round(safety_score / 20, 1)

    totals = {cat: 0.0 for cat in CATEGORIES}
    for c in contributions:
        totals[c.category] += c.points

    contributions_sorted = sorted(contributions, key=lambda c: -c.points)
    if len(contributions_sorted) >= 2:
        top = contributions_sorted[:2]
        summary = (f"The largest contributors to this road's risk estimate are "
                   f"{top[0].description.lower()} and {top[1].description.lower()}.")
    elif contributions_sorted:
        summary = f"The main contributor to this road's risk estimate is {contributions_sorted[0].description.lower()}."
    else:
        summary = "No significant risk factors were detected in the available data."

    return RiskResult(
        score_0_100=round(score, 1),
        safety_score_0_100=round(safety_score, 1),
        stars=stars,
        category=_category_label(score),
        contributions=contributions_sorted,
        category_totals={k: round(v, 1) for k, v in totals.items()},
        summary=summary,
    )
