"""Microscopic traffic simulation using the Intelligent Driver Model (IDM) for
car-following, plus signal-phase gating and pairwise time-to-collision (TTC)
conflict detection. Runs server-side for a fixed horizon; the frontend plays
the resulting frame timeline back."""
import math
import random
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from ..models.schemas import (
    RoadFeatures, RoadGeometry, SimResult, SimFrame, VehicleFrame, PedestrianFrame, ConflictEvent, SimMetrics,
)
from .geometry import curve_speed_factors

A_MAX = 1.4       # m/s^2 comfortable acceleration
B_COMF = 2.0      # m/s^2 comfortable deceleration
S0 = 2.0          # m minimum gap
T_HEADWAY = 1.5   # s desired time headway
DELTA = 4
VEH_LEN = 4.5     # m
# Must match the frontend's actual rendered lane width (HALF_WIDTH_PER_LANE_M * 2
# in geometryUtils.ts). This used to be a fixed 3.2m guess independent of what
# actually gets drawn — harmless while the two happened to be close, but once
# the rendered lane width was widened for visual scale, this stayed at 3.2 and
# put every vehicle roughly a meter off true lane-center, straddling the lane
# line instead of driving inside its lane. Frontend bumped to 3.5 (7.0m/lane)
# for a visibly thicker/wider road — kept in sync here for the same reason.
LANE_WIDTH_M = 7.0
DT = 0.2
TTC_THRESHOLD_S = 2.5
REACTION_LAG_S = 1.0        # baseline human driver reaction time
AGGRESSIVE_LAG_S = 3.2      # distracted/aggressive driver: reacts much later
AGGRESSIVE_FRACTION = 0.4   # share of simulated drivers modeled as distracted/aggressive
AGGRESSIVE_CURVE_OVERSHOOT = 1.6  # aggressive drivers shed much less speed than advised for a bend
LAG_STEPS = max(1, int(round(REACTION_LAG_S / DT)))
AGGRESSIVE_LAG_STEPS = max(1, int(round(AGGRESSIVE_LAG_S / DT)))
MAX_LAG_STEPS = AGGRESSIVE_LAG_STEPS

# Mirrors geometryUtils.ts/Infrastructure.tsx's crossing-placement constants
# exactly (STRAIGHT_WINDOW_M, STRAIGHT_THRESHOLD_RAD, CROSSING_LENGTH_M,
# CROSSING_SIGNAL_SETBACK_M) so the signal this sim actually stops traffic at
# lands on the SAME physical spot as the crossing the frontend renders and
# the traffic light it draws there — not two independently-computed positions
# that happen to be near each other.
CROSSING_STRAIGHT_WINDOW_M = 15.0
CROSSING_STRAIGHT_THRESHOLD_RAD = math.radians(6)
CROSSING_LENGTH_M = 3.0
CROSSING_SIGNAL_SETBACK_M = 4.0  # stop line this far before the crossing's near edge

# Pedestrians: walk the sidewalk (or the road's shoulder edge if there is no
# sidewalk) in one direction per side, and a fraction of them peel off to
# cross at the zebra crossing when they reach it.
PED_SPEED_MS = 1.35
PED_SIDEWALK_OFFSET_M = 0.9  # matches Road.tsx's sidewalk offsetStrip(halfWidth+0.9, ...)
PED_EDGE_OFFSET_M = 0.5      # just past the shoulder edge when there's no sidewalk to walk on
PED_SPAWN_INTERVAL_S = 7.0
# When there's a crossing, pedestrians spawn/wander within this range of it
# instead of at the road's raw endpoints — at walking pace, someone spawned
# at the far end of a real (often 1-2km) route would never reach a mid-road
# crossing within any realistic playback window.
PED_ACTIVITY_RADIUS_M = 60.0
PED_CROSS_FRACTION = 0.35
PED_CROSS_DURATION_S = 4.0   # time spent sweeping laterally across the carriageway
PED_CROSS_TRIGGER_M = 0.6    # how close to the crossing's center a crosser must get to start


def _headings(xy: List[Tuple[float, float]]) -> List[float]:
    n = len(xy)
    out = [0.0] * n
    for i in range(n):
        if i < n - 1:
            out[i] = math.atan2(xy[i + 1][1] - xy[i][1], xy[i + 1][0] - xy[i][0])
        elif i > 0:
            out[i] = out[i - 1]
    return out


def _curvature_at(headings: List[float], cum: List[float], i: int, window_m: float) -> float:
    n = len(headings)
    j, back = i, 0.0
    while j > 0 and back < window_m:
        back += cum[j] - cum[j - 1]
        j -= 1
    k, fwd = i, 0.0
    while k < n - 1 and fwd < window_m:
        fwd += cum[k + 1] - cum[k]
        k += 1
    diff = abs(headings[k] - headings[j])
    if diff > math.pi:
        diff = 2 * math.pi - diff
    return diff


def _nearest_index_for_s(cum: List[float], s: float) -> int:
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cum[mid] <= s:
            lo = mid
        else:
            hi = mid
    return lo if (s - cum[lo]) <= (cum[hi] - s) else hi


def _nearest_straight_index(headings: List[float], cum: List[float], target_s: float,
                             window_m: float, threshold_rad: float) -> int:
    n = len(cum)
    start = _nearest_index_for_s(cum, target_s)
    if _curvature_at(headings, cum, start, window_m) <= threshold_rad:
        return start
    for d in range(1, n):
        hi = start + d
        if hi < n and _curvature_at(headings, cum, hi, window_m) <= threshold_rad:
            return hi
        lo = start - d
        if lo >= 0 and _curvature_at(headings, cum, lo, window_m) <= threshold_rad:
            return lo
    return start


@dataclass
class _Pedestrian:
    id: int
    side: int        # +1 or -1 sidewalk/shoulder, matching VehicleFrame.lane_offset_m's binormal sign convention
    direction: int    # +1 walks toward increasing s, -1 toward decreasing s
    s: float
    is_crosser: bool
    finished_t: Optional[float] = None
    crossing_now: bool = False
    crossed_already: bool = False
    cross_progress: float = 0.0
    waiting_to_cross: bool = False  # reached the curb but the signal is still green for vehicles


def _lagged(hist: list, lag_steps: int):
    if not hist:
        return None
    idx = max(0, len(hist) - lag_steps)
    return hist[idx]


@dataclass
class _Vehicle:
    id: int
    lane: int
    s: float
    v: float
    v0: float
    spawn_t: float
    finished_t: Optional[float] = None
    active_conflict_with: set = field(default_factory=set)
    hist: list = field(default_factory=list)  # past (s, v), oldest first — models reaction delay
    aggressive: bool = False
    lag_steps: int = LAG_STEPS
    curve_mult: float = 1.0


def _build_path_lookup(xy: List[Tuple[float, float]]):
    cum = [0.0]
    for i in range(1, len(xy)):
        cum.append(cum[-1] + math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
    total = cum[-1] if cum else 0.0

    def lookup(s: float):
        s = max(0.0, min(total, s))
        for i in range(1, len(cum)):
            if s <= cum[i] or i == len(cum) - 1:
                seg_len = max(cum[i] - cum[i - 1], 1e-6)
                t = (s - cum[i - 1]) / seg_len
                x = xy[i - 1][0] + t * (xy[i][0] - xy[i - 1][0])
                y = xy[i - 1][1] + t * (xy[i][1] - xy[i - 1][1])
                heading = math.degrees(math.atan2(xy[i][1] - xy[i - 1][1], xy[i][0] - xy[i - 1][0]))
                return x, y, heading
        return xy[-1][0], xy[-1][1], 0.0

    return lookup, total, cum


def _build_speed_profile(xy: List[Tuple[float, float]], cum: List[float]):
    """Returns factor_at(s) in [0.35, 1.0]: how much a driver must slow for the
    curvature ahead. Vehicles look ~15m ahead so braking begins before the bend."""
    factors = curve_speed_factors(xy)
    total = cum[-1] if cum else 0.0
    LOOKAHEAD = 15.0

    def factor_at(s: float) -> float:
        s = max(0.0, min(total, s))
        s_ahead = min(total, s + LOOKAHEAD)
        vals = []
        for probe in (s, s_ahead):
            for i in range(len(cum)):
                if probe <= cum[i] or i == len(cum) - 1:
                    vals.append(factors[i])
                    break
        return min(vals) if vals else 1.0

    return factor_at


def _idm_accel(v, v0, gap, dv, headway=T_HEADWAY, comfort_decel=B_COMF):
    gap = max(gap, 0.05)
    s_star = S0 + max(0.0, v * headway + (v * dv) / (2 * math.sqrt(A_MAX * comfort_decel)))
    return A_MAX * (1 - (v / max(v0, 0.1)) ** DELTA - (s_star / gap) ** 2)


# Wet pavement: real tires lose grip, which shows up as a lower safe top
# speed, a longer desired following gap (stopping distance grows with the
# square of speed under reduced friction), and less confidence carried into
# a bend on top of the normal curve-speed profile. None of this touches the
# signal/TTC logic — it's the same IDM model with wet-adjusted inputs.
WET_SPEED_MULT = 0.85
WET_HEADWAY_MULT = 1.35
WET_CURVE_MULT = 0.85
WET_COMFORT_DECEL_MULT = 0.75  # a comfortable stop takes longer on a wet road


def run_simulation(geometry: RoadGeometry, features: RoadFeatures, duration_s: float = 300.0,
                    speed_scale: float = 1.0, add_signal: bool = False, is_wet: bool = False,
                    seed: int = 7) -> SimResult:
    rng = random.Random(seed)
    xy = [(p[0], p[1]) for p in geometry.local_xy]
    lookup, total_len, cum = _build_path_lookup(xy)
    if total_len < 5:
        total_len = 5.0
    speed_factor_at = _build_speed_profile(xy, cum)

    lanes = max(1, min(2, features.lanes // (1 if features.lanes <= 2 else 2) or 1))
    wet_speed_mult = WET_SPEED_MULT if is_wet else 1.0
    v0_base = max(5.0, features.speed_limit_kmh / 3.6 * speed_scale * wet_speed_mult)
    headway = T_HEADWAY * (WET_HEADWAY_MULT if is_wet else 1.0)
    comfort_decel = B_COMF * (WET_COMFORT_DECEL_MULT if is_wet else 1.0)
    curve_wet_mult = WET_CURVE_MULT if is_wet else 1.0
    spawn_interval = max(1.0, min(9.0, 3600.0 / max(features.estimated_volume_vph * 1.6, 60)))

    # Free-flow baseline integrates the curve-speed profile along the path (a vehicle
    # unimpeded by other traffic still has to slow for bends), computed up front since
    # it only depends on geometry/speed, not on the vehicle population.
    free_flow_time = 0.0
    for i in range(1, len(cum)):
        seg_len = cum[i] - cum[i - 1]
        seg_v0 = max(1.0, v0_base * speed_factor_at((cum[i] + cum[i - 1]) / 2))
        free_flow_time += seg_len / seg_v0

    # Frames are only emitted for the requested playback window (keeps the payload the
    # frontend animates small), but the physics run for a fixed, generous horizon so
    # several vehicles actually complete the route (delay/conflict stats aren't
    # structurally zero) — and so before/after comparisons share the same time budget
    # regardless of how an intervention changed free-flow time.
    playback_duration = duration_s
    sim_duration = max(duration_s, 130.0)

    half_width = max(2, features.lanes) * (LANE_WIDTH_M / 2)

    # Same "nearest straight point to the midpoint" search the frontend's
    # crossingPoint uses — resolves to (approximately) the same physical spot
    # since it's driven by the same route geometry and the same window/
    # threshold constants.
    crossing_center_s: Optional[float] = None
    if features.crossing_density_per_km > 0 and len(xy) >= 3:
        headings = _headings(xy)
        idx = _nearest_straight_index(headings, cum, total_len / 2, CROSSING_STRAIGHT_WINDOW_M, CROSSING_STRAIGHT_THRESHOLD_RAD)
        crossing_center_s = cum[idx]

    # A pedestrian crossing gets its own signal, planted just before the
    # crossing's near edge (a real stop line) — this is what makes vehicles
    # actually queue AT the crossing (and a vehicle already past the stop
    # line, even mid-crossing, is naturally exempt: the `veh.s < sp` checks
    # below only ever hold traffic BEHIND this position).
    signal_positions: List[float] = []
    crossing_signal_s: Optional[float] = None
    if crossing_center_s is not None:
        crossing_signal_s = max(0.0, crossing_center_s - CROSSING_LENGTH_M / 2 - CROSSING_SIGNAL_SETBACK_M)
        signal_positions.append(crossing_signal_s)

    n_signals = features.signal_count + (1 if add_signal and features.signal_count == 0 else 0)
    if n_signals > 0:
        fracs = [(_i + 1) / (n_signals + 1) for _i in range(n_signals)]
        for f in fracs:
            sp = f * total_len
            if signal_positions and abs(sp - signal_positions[0]) < 25.0:
                continue  # already covered by the crossing's own signal
            signal_positions.append(sp)
    cycle = 30.0  # 18s green, 12s red

    def signal_red(pos_s, t):
        phase = (t + pos_s) % cycle
        return phase > 18.0

    lanes_vehicles: List[List[_Vehicle]] = [[] for _ in range(lanes)]
    next_id = 1
    next_spawn_t = [rng.uniform(0, spawn_interval * 0.5) for _ in range(lanes)]

    # Two walking streams: side +1 spawns at s=0 walking toward increasing s,
    # side -1 spawns at s=total_len walking toward decreasing s — one
    # direction of foot traffic per sidewalk/shoulder, which is enough to
    # populate the scene without a full bidirectional pedestrian model.
    pedestrians: List[_Pedestrian] = []
    next_ped_id = 1
    next_ped_spawn_t = [rng.uniform(0, PED_SPAWN_INTERVAL_S * 0.5) for _ in range(2)]

    frames: List[SimFrame] = []
    conflicts: List[ConflictEvent] = []
    speed_samples: List[float] = []
    travel_times: List[float] = []
    density_samples: List[float] = []

    t = 0.0
    steps = int(sim_duration / DT)
    for _step in range(steps):
        for lane_idx in range(lanes):
            veh_list = lanes_vehicles[lane_idx]
            if t >= next_spawn_t[lane_idx] and (not veh_list or veh_list[-1].s > VEH_LEN * 2.5):
                v0 = v0_base * rng.uniform(0.9, 1.08)
                aggressive = rng.random() < AGGRESSIVE_FRACTION
                veh_list.append(_Vehicle(
                    id=next_id, lane=lane_idx, s=0.0, v=0.0, v0=v0, spawn_t=t, aggressive=aggressive,
                    lag_steps=(AGGRESSIVE_LAG_STEPS if aggressive else LAG_STEPS),
                    curve_mult=(AGGRESSIVE_CURVE_OVERSHOOT if aggressive else 1.0),
                ))
                next_id += 1
                next_spawn_t[lane_idx] = t + spawn_interval * rng.uniform(0.75, 1.25)

            veh_list.sort(key=lambda v: -v.s)
            for i, veh in enumerate(veh_list):
                if veh.finished_t is not None:
                    continue
                if i == 0:
                    lead_gap = total_len - veh.s + 500
                    dv = 0.0
                    for sp in signal_positions:
                        if veh.s < sp and signal_red(sp, t):
                            g = sp - veh.s
                            if g < lead_gap:
                                lead_gap = g
                                dv = veh.v
                else:
                    leader = veh_list[i - 1]
                    # Follower reacts to the leader's state from `lag_steps` ago (reaction
                    # delay), not its current state — aggressive/distracted drivers (see
                    # AGGRESSIVE_FRACTION) react later, which is what produces real
                    # closing/near-miss events instead of textbook-perfect car-following.
                    lagged = _lagged(leader.hist, veh.lag_steps)
                    lead_s, lead_v = lagged if lagged else (leader.s, leader.v)
                    lead_gap = lead_s - veh.s - VEH_LEN
                    dv = veh.v - lead_v
                    for sp in signal_positions:
                        if veh.s < sp < lead_s and signal_red(sp, t):
                            g = sp - veh.s
                            if g < lead_gap:
                                lead_gap = g
                                dv = veh.v
                local_v0 = veh.v0 * min(1.0, speed_factor_at(veh.s) * veh.curve_mult * curve_wet_mult)
                accel = _idm_accel(veh.v, local_v0, lead_gap, dv, headway, comfort_decel)
                veh.v = max(0.0, veh.v + accel * DT)
                veh.s += veh.v * DT
                if veh.s >= total_len and veh.finished_t is None:
                    veh.finished_t = t
                    travel_times.append(t - veh.spawn_t)
                speed_samples.append(veh.v)
                veh.hist.append((veh.s, veh.v))
                if len(veh.hist) > MAX_LAG_STEPS:
                    veh.hist.pop(0)

            # TTC conflict check within lane
            for i in range(1, len(veh_list)):
                leader, follower = veh_list[i - 1], veh_list[i]
                if leader.finished_t is not None or follower.finished_t is not None:
                    continue
                gap = leader.s - follower.s - VEH_LEN
                dv = follower.v - leader.v
                pair = (min(leader.id, follower.id), max(leader.id, follower.id))
                if dv > 0.3 and gap > 0:
                    ttc = gap / dv
                    if ttc < TTC_THRESHOLD_S and pair not in follower.active_conflict_with:
                        conflicts.append(ConflictEvent(t=round(t, 1), vehicle_a=leader.id, vehicle_b=follower.id,
                                                        ttc_s=round(ttc, 2), s=follower.s))
                        follower.active_conflict_with.add(pair)
                elif pair in follower.active_conflict_with:
                    follower.active_conflict_with.discard(pair)

            density_samples.append(len([v for v in veh_list if v.finished_t is None]) / max(total_len / 1000, 0.01))

        for side_idx, side in enumerate((1, -1)):
            if t >= next_ped_spawn_t[side_idx]:
                is_crosser = crossing_center_s is not None and rng.random() < PED_CROSS_FRACTION
                if crossing_center_s is None:
                    spawn_s = 0.0 if side == 1 else total_len
                elif is_crosser:
                    # Spawn on the approach side of the crossing so this
                    # pedestrian's own walking direction actually carries it
                    # THROUGH the crossing within the playback window — a
                    # crosser spawned at the far end of a 2km road would need
                    # tens of minutes at walking pace to ever reach it.
                    offset = rng.uniform(10.0, PED_ACTIVITY_RADIUS_M)
                    spawn_s = crossing_center_s - offset if side == 1 else crossing_center_s + offset
                else:
                    zone_lo = max(0.0, crossing_center_s - PED_ACTIVITY_RADIUS_M)
                    zone_hi = min(total_len, crossing_center_s + PED_ACTIVITY_RADIUS_M)
                    spawn_s = rng.uniform(zone_lo, zone_hi)
                pedestrians.append(_Pedestrian(
                    id=next_ped_id, side=side, direction=side,
                    s=max(0.0, min(total_len, spawn_s)),
                    is_crosser=is_crosser,
                ))
                next_ped_id += 1
                next_ped_spawn_t[side_idx] = t + PED_SPAWN_INTERVAL_S * rng.uniform(0.75, 1.25)

        for ped in pedestrians:
            if ped.finished_t is not None:
                continue
            if (ped.is_crosser and crossing_center_s is not None and not ped.crossing_now
                    and not ped.crossed_already and not ped.waiting_to_cross
                    and abs(ped.s - crossing_center_s) < PED_CROSS_TRIGGER_M):
                # Reached the crossing — only actually step out once the
                # signal is red for vehicles (i.e. cars are stopped);
                # otherwise wait at the curb like a real pedestrian would,
                # instead of sweeping across in front of moving traffic.
                if crossing_signal_s is not None and signal_red(crossing_signal_s, t):
                    ped.crossing_now = True
                else:
                    ped.waiting_to_cross = True
            elif ped.waiting_to_cross and crossing_signal_s is not None and signal_red(crossing_signal_s, t):
                ped.waiting_to_cross = False
                ped.crossing_now = True
            if ped.crossing_now:
                ped.cross_progress = min(1.0, ped.cross_progress + DT / PED_CROSS_DURATION_S)
                if ped.cross_progress >= 1.0:
                    ped.side = -ped.side
                    ped.crossing_now = False
                    ped.crossed_already = True
            if not ped.waiting_to_cross:  # held at the curb — doesn't drift forward while waiting
                ped.s += PED_SPEED_MS * ped.direction * DT
            if ped.s > total_len or ped.s < 0.0:
                ped.finished_t = t

        if _step % 2 == 0 and t <= playback_duration:
            vf = []
            for lane_idx in range(lanes):
                for veh in lanes_vehicles[lane_idx]:
                    if veh.finished_t is not None:
                        continue
                    lane_offset = (lane_idx - (lanes - 1) / 2) * LANE_WIDTH_M
                    braking = veh.v < veh.v0 * 0.6
                    vf.append(VehicleFrame(id=veh.id, s=veh.s, lane_offset_m=lane_offset,
                                            v_ms=round(veh.v, 2), lane=lane_idx, braking=braking))
            pf = []
            walk_offset = half_width + (PED_SIDEWALK_OFFSET_M if features.has_sidewalk else PED_EDGE_OFFSET_M)
            for ped in pedestrians:
                if ped.finished_t is not None:
                    continue
                # Sweeps from the starting side's offset to the opposite side's
                # offset as cross_progress goes 0->1; ped.side itself only flips
                # once progress completes, so this stays keyed to the ORIGINAL
                # side throughout the sweep.
                lateral = walk_offset * ped.side * (1 - 2 * ped.cross_progress) if ped.crossing_now else walk_offset * ped.side
                pf.append(PedestrianFrame(id=ped.id, s=max(0.0, min(total_len, ped.s)),
                                           lateral_m=round(lateral, 2), crossing=ped.crossing_now))
            frames.append(SimFrame(t=round(t, 1), vehicles=vf, pedestrians=pf))

        t += DT

    avg_speed_ms = sum(speed_samples) / len(speed_samples) if speed_samples else 0.0
    avg_delay = max(0.0, (sum(travel_times) / len(travel_times) - free_flow_time)) if travel_times else 0.0
    metrics = SimMetrics(
        avg_speed_kmh=round(avg_speed_ms * 3.6, 1),
        avg_delay_s=round(avg_delay, 1),
        conflict_count=len(conflicts),
        max_density_veh_per_km=round(max(density_samples) if density_samples else 0.0, 1),
        vehicles_simulated=next_id - 1,
    )
    conflicts_in_window = [c for c in conflicts if c.t <= playback_duration]
    crossing_frac = (crossing_center_s / total_len) if crossing_center_s is not None and total_len > 1e-6 else None
    return SimResult(frames=frames, conflicts=conflicts_in_window, metrics=metrics, duration_s=duration_s, dt=DT,
                      crossing_frac=crossing_frac)
