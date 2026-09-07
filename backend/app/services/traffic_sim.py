"""Microscopic traffic simulation using the Intelligent Driver Model (IDM) for
car-following, plus signal-phase gating and pairwise time-to-collision (TTC)
conflict detection. Runs server-side for a fixed horizon; the frontend plays
the resulting frame timeline back."""
import math
import random
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from ..models.schemas import RoadFeatures, RoadGeometry, SimResult, SimFrame, VehicleFrame, ConflictEvent, SimMetrics
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
# line instead of driving inside its lane.
LANE_WIDTH_M = 5.2
DT = 0.2
TTC_THRESHOLD_S = 2.5
REACTION_LAG_S = 1.0        # baseline human driver reaction time
AGGRESSIVE_LAG_S = 3.2      # distracted/aggressive driver: reacts much later
AGGRESSIVE_FRACTION = 0.4   # share of simulated drivers modeled as distracted/aggressive
AGGRESSIVE_CURVE_OVERSHOOT = 1.6  # aggressive drivers shed much less speed than advised for a bend
LAG_STEPS = max(1, int(round(REACTION_LAG_S / DT)))
AGGRESSIVE_LAG_STEPS = max(1, int(round(AGGRESSIVE_LAG_S / DT)))
MAX_LAG_STEPS = AGGRESSIVE_LAG_STEPS


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


def _idm_accel(v, v0, gap, dv):
    gap = max(gap, 0.05)
    s_star = S0 + max(0.0, v * T_HEADWAY + (v * dv) / (2 * math.sqrt(A_MAX * B_COMF)))
    return A_MAX * (1 - (v / max(v0, 0.1)) ** DELTA - (s_star / gap) ** 2)


def run_simulation(geometry: RoadGeometry, features: RoadFeatures, duration_s: float = 30.0,
                    speed_scale: float = 1.0, add_signal: bool = False, seed: int = 7) -> SimResult:
    rng = random.Random(seed)
    xy = [(p[0], p[1]) for p in geometry.local_xy]
    lookup, total_len, cum = _build_path_lookup(xy)
    if total_len < 5:
        total_len = 5.0
    speed_factor_at = _build_speed_profile(xy, cum)

    lanes = max(1, min(2, features.lanes // (1 if features.lanes <= 2 else 2) or 1))
    v0_base = max(5.0, features.speed_limit_kmh / 3.6 * speed_scale)
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

    signal_positions = []
    n_signals = features.signal_count + (1 if add_signal and features.signal_count == 0 else 0)
    if n_signals > 0:
        fracs = [(_i + 1) / (n_signals + 1) for _i in range(n_signals)]
        signal_positions = [f * total_len for f in fracs]
    cycle = 30.0  # 18s green, 12s red

    def signal_red(pos_s, t):
        phase = (t + pos_s) % cycle
        return phase > 18.0

    lanes_vehicles: List[List[_Vehicle]] = [[] for _ in range(lanes)]
    next_id = 1
    next_spawn_t = [rng.uniform(0, spawn_interval * 0.5) for _ in range(lanes)]

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
                local_v0 = veh.v0 * min(1.0, speed_factor_at(veh.s) * veh.curve_mult)
                accel = _idm_accel(veh.v, local_v0, lead_gap, dv)
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
            frames.append(SimFrame(t=round(t, 1), vehicles=vf))

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
    return SimResult(frames=frames, conflicts=conflicts_in_window, metrics=metrics, duration_s=duration_s, dt=DT)
