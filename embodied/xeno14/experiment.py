"""Milestone X14-1: one embodiment (Walker2d-v5), three Xeno-14 organizations, matched baselines, one controlled
perturbation (torso push), Fragility Transfer by intervention, ablations, scalarized-control comparison and an
architecture-repartition comparison. All constants below are fixed before any run.

Usage: python -m xeno14.experiment [--quick]   (from embodied/)
"""
from __future__ import annotations
import copy, hashlib, json, subprocess, sys, time
from pathlib import Path
import numpy as np
import torch
from .env import make_env, run_episode, T
from .modules import Xeno14Controller, MLPPolicy, GRUPolicy, n_params, OBS
from .es import es_optimize
from .principles import registry, IMPLEMENTED

ROOT = Path(__file__).resolve().parents[2]
ORGS = ["axis-maintenance", "lower-abdominal-continuity", "low-noise-movement"]
METRIC = {"axis-maintenance": "axis", "lower-abdominal-continuity": "lower_center", "low-noise-movement": "low_noise"}
REF = {"axis": 0.01, "lower_center": 0.0025, "low_noise": 0.1}     # normalization references, fixed a priori
LAM = 0.5
F_TRAIN, F_EVAL = 80.0, [0.0, 80.0, 140.0]
CFG = {"iters": 48, "k_int": 12, "eval_eps": 8, "seeds": [1, 2, 3], "block": 8}


def norm(m: dict, key: str) -> float:
    v = m[key]; return 4.0 if not np.isfinite(v) else min(v / REF[key], 4.0)


# ------------------------------------------------------------------ objectives (declared; never summed across organizations for Xeno-14)
def f_standard(m): return m["survival"]
def f_org(org): return lambda m: m["survival"] - LAM * norm(m, METRIC[org])
def f_scalar(m): return m["survival"] - LAM * sum(norm(m, METRIC[o]) for o in ORGS) / 3
def f_emphasis(org): return lambda m: m["survival"] - LAM * (3 * norm(m, METRIC[org]) + sum(norm(m, METRIC[o]) for o in ORGS if o != org)) / 5


def fitness_for(env, policy, obj, push_mag=F_TRAIN):
    def fit(seed, push):
        m = run_episode(env, policy, seed, push * push_mag); return obj(m), m["steps"]
    return fit


def params_hash(pol) -> str:
    h = hashlib.sha256()
    for p in pol.parameters(): h.update(p.detach().numpy().tobytes())
    return h.hexdigest()[:16]


# ------------------------------------------------------------------ training
def train(env, pol, obj, iters, rng, params=None):
    return es_optimize(params if params is not None else list(pol.parameters()), fitness_for(env, pol, obj), iters, rng)


def train_xeno(env, ctrl: Xeno14Controller, iters, rng, orgs=None, push_mag=F_TRAIN):
    """Round-robin: each organization module is optimized on its own objective with the others fixed."""
    orgs = orgs or [o for o in ORGS if o in ctrl.mods]
    steps, curves, blocks = 0, {o: [] for o in orgs}, 0
    per = max(1, CFG["block"]); left = iters
    while left > 0:
        for o in orgs:
            k = min(per, left)
            if k <= 0: break
            log = es_optimize(ctrl.module_params(o), fitness_for(env, ctrl, f_org(o), push_mag), k, rng)
            steps += log["steps"]; curves[o] += log["curve"]; left -= k; blocks += 1
    return {"steps": steps, "curves": curves, "blocks": blocks}


# ------------------------------------------------------------------ evaluation
def evaluate(env, pol, seed_base, pushes=F_EVAL, eps=None, record_xeno=False):
    eps = eps or CFG["eval_eps"]; out = {}
    for F in pushes:
        rows = [run_episode(env, pol, seed_base + k, F * (1 if k % 2 == 0 else -1), record=(record_xeno and k < 2)) for k in range(eps)]
        agg = {k: float(np.nanmean([r[k] for r in rows])) for k in ["survival", "axis", "lower_center", "low_noise"]}
        rec = [r["recovery_steps"] for r in rows if F]
        agg["recovered_fraction"] = (sum(x is not None for x in rec) / len(rec)) if F else None
        agg["recovery_steps_mean"] = float(np.mean([x for x in rec if x is not None])) if F and any(x is not None for x in rec) else None
        agg["per_episode_survival"] = [round(r["survival"], 3) for r in rows]
        if record_xeno and rows[0]["trace"]:
            tr = [s for r in rows if r["trace"] for s in r["trace"]]
            if tr and "gates" in tr[0]:
                agg["gate_mean"] = {n: float(np.mean([s["gates"].get(n, np.nan) for s in tr])) for n in tr[0]["gates"]}
                agg["gate_ignition_fraction"] = {n: float(np.mean([s["gates"].get(n, 0) > 0.5 for s in tr])) for n in tr[0]["gates"]}
                agg["conflict_cos_mean"] = {k: float(np.mean([s["conflict_cos"][k] for s in tr])) for k in tr[0]["conflict_cos"]}
                agg["conflict_fraction_negative"] = {k: float(np.mean([s["conflict_cos"][k] < -0.2 for s in tr])) for k in tr[0]["conflict_cos"]}
        out[str(int(F))] = agg
    return out


def op_record(kind, name, pol, intervention, realized, seed, extra=None):
    """Operation record (configuration-dependent): embodiment, sensing, boundary, scale, window, substrate, controller
    state, history, resources, intervention, realized effect."""
    return {"kind": kind, "configuration": name, "seed": seed, "embodiment": "Walker2d-v5 planar biped (gymnasium 1.3, MuJoCo 3.14)",
            "sensor_arrangement": "17-dim proprioceptive observation (torso height/pitch, 6 joint angles, root and joint velocities)",
            "boundary": "whole Walker2d body; push applied to the torso by the environment, not sensed directly",
            "scale": "control step 0.008 s × 4 frame skip", "temporal_window": f"episode {T} steps; history H={getattr(pol, 'H', 0)}",
            "substrate": "simulated (MuJoCo)", "controller_state_sha256_16": params_hash(pol), "history": extra or {},
            "resource_constraints": "action bounds [−1, 1]; no energy budget in X14-1",
            "intervention": intervention, "realized_effect": realized}


# ------------------------------------------------------------------ Ziran revision machinery (v0.3.0 via TS bridge)
def ziran_select(candidates, axes, policy="lexicographic"):
    payload = json.dumps({"candidates": candidates, "axes": axes, "policy": policy})
    r = subprocess.run(["node", str(ROOT / "comparison" / "xeno14-bridge.ts")], input=payload, capture_output=True, text=True, cwd=ROOT)
    if r.returncode: raise RuntimeError(r.stderr)
    return json.loads(r.stdout)


def expand_history(ctrl: Xeno14Controller, H_new: int) -> Xeno14Controller:
    """Temporal-window revision: new controller with a longer history; old weights copied onto the newest frames."""
    new = Xeno14Controller(ctrl.names, H=H_new, gated=ctrl.gated, shared_gates=dict(ctrl.shared_gates), accel_gate_inputs=ctrl.accel)
    with torch.no_grad():
        for n in ctrl.names:
            o, m = ctrl.mods[n], new.mods[n]
            m.gate.load_state_dict(o.gate.state_dict()); m.body[2].load_state_dict(o.body[2].state_dict())
            W, b = o.body[0].weight, o.body[0].bias; m.body[0].weight.zero_(); m.body[0].weight[:, -W.shape[1]:] = W; m.body[0].bias.copy_(b)
    return new


def add_accel_gates(ctrl: Xeno14Controller) -> Xeno14Controller:
    """Encoding revision: gates also receive finite-difference acceleration features (zero-initialized weights)."""
    new = Xeno14Controller(ctrl.names, H=ctrl.H, gated=ctrl.gated, shared_gates=dict(ctrl.shared_gates), accel_gate_inputs=True)
    with torch.no_grad():
        for n in ctrl.names:
            o, m = ctrl.mods[n], new.mods[n]
            m.body.load_state_dict(o.body.state_dict()); m.gate.weight.zero_(); m.gate.weight[:, :2] = o.gate.weight; m.gate.bias.copy_(o.gate.bias)
    return new


# ------------------------------------------------------------------ per-seed pipeline
def run_seed(arg) -> dict:
    seed, cfg = arg; CFG.update(cfg)
    torch.manual_seed(seed); torch.set_num_threads(1)
    env = make_env(); rng = np.random.default_rng(seed); t0 = time.time()
    EV, VAL, TEST = 10_000 + 100 * seed, 20_000 + 100 * seed, 30_000 + 100 * seed
    res: dict = {"seed": seed, "configs": {}, "ops": []}

    def put(name, pol, log, role, family, supplied, obj_desc):
        ms = time.time()
        ev = evaluate(env, pol, EV, record_xeno=isinstance(pol, Xeno14Controller))
        res["configs"][name] = {"role": role, "family": family, "supplied": supplied, "objective": obj_desc, "eval": ev, "train_steps": log.get("steps"), "params": n_params(pol.parameters()), "eval_ms": round((time.time() - ms) * 1000)}
        res["ops"].append(op_record("train+evaluate", name, pol, {"training": obj_desc, "steps": log.get("steps")}, {k: {m: v for m, v in d.items() if m in ("survival", "axis", "lower_center", "low_noise", "recovered_fraction")} for k, d in ev.items()}, seed))

    # Xeno-14 (module-wise objectives, no scalarization across organizations)
    xeno = Xeno14Controller(ORGS, H=3); lx = train_xeno(env, xeno, CFG["iters"], rng)
    put("xeno14", xeno, lx, "primary", "xeno14", ["3 organization modules", "gates on organization-specific features", "history H=3"], "round-robin: each module on survival − λ·(its organization metric)")
    # baselines (same optimizer, same iteration count, same observations)
    b = {"standard-mlp": (MLPPolicy(), f_standard, "survival"), "proprioceptive-mlp": (MLPPolicy(proprio_only=True), f_standard, "survival (joint angles/velocities only)"),
         "recurrent-gru": (GRUPolicy(), f_standard, "survival"), "multiobjective-scalarized-mlp": (MLPPolicy(), f_scalar, "survival − λ·mean of the three normalized organization metrics")}
    trained_scalar_mlp = None
    for name, (pol, obj, desc) in b.items():
        log = train(env, pol, obj, CFG["iters"], rng); put(name, pol, log, "baseline", "standard embodied RL (ES)" if "scalarized" not in name else "multi-objective (scalarized)", [type(pol).__name__], desc)
        if name == "multiobjective-scalarized-mlp": trained_scalar_mlp = pol
    # retrained ablations
    abl = {"xeno14-no-history": Xeno14Controller(ORGS, H=0), "xeno14-gates-off": Xeno14Controller(ORGS, H=3, gated=False)}
    for name, pol in abl.items(): put(name, pol, train_xeno(env, pol, CFG["iters"], rng), "ablation", "xeno14", [name], "as xeno14")
    xs = Xeno14Controller(ORGS, H=3); put("xeno14-scalarized-training", xs, train(env, xs, f_scalar, CFG["iters"], rng), "ablation", "xeno14 architecture, scalarized objective", ["same modules and gates"], "all module parameters jointly on the scalarized objective")
    # module removal at evaluation (no retraining)
    removal = {}
    for k in range(1, 3):
        import itertools
        for combo in itertools.combinations(ORGS, k):
            c = copy.deepcopy(xeno); c.disabled = set(combo); removal["remove:" + "+".join(combo)] = evaluate(env, c, EV, pushes=[0.0, 80.0])
    res["removal"] = removal

    # Fragility Transfer by intervention (Xeno-14) and the matching trade-off analysis (scalarized MLP)
    ft = {"xeno14": {}, "tradeoff-scalarized-mlp": {}}
    ctrl_x = copy.deepcopy(xeno); train_xeno(env, ctrl_x, CFG["k_int"], rng, push_mag=F_TRAIN)
    ft["xeno14"]["control"] = evaluate(env, ctrl_x, EV, pushes=[80.0, 140.0])
    for o in ORGS:
        c = copy.deepcopy(xeno); es_optimize(c.module_params(o), fitness_for(env, c, f_org(o)), CFG["k_int"], rng)
        ft["xeno14"][o] = evaluate(env, c, EV, pushes=[80.0, 140.0])
        res["ops"].append(op_record("intervention", f"xeno14:improve:{o}", c, {"improve": o, "iterations": CFG["k_int"]}, ft["xeno14"][o], seed, {"parent": params_hash(xeno)}))
    ctrl_s = copy.deepcopy(trained_scalar_mlp); train(env, ctrl_s, f_scalar, CFG["k_int"], rng)
    ft["tradeoff-scalarized-mlp"]["control"] = evaluate(env, ctrl_s, EV, pushes=[80.0, 140.0])
    for o in ORGS:
        c = copy.deepcopy(trained_scalar_mlp); train(env, c, f_emphasis(o), CFG["k_int"], rng)
        ft["tradeoff-scalarized-mlp"][o] = evaluate(env, c, EV, pushes=[80.0, 140.0])
    res["ft"] = ft

    # Architecture repartition under the stress push (140 N): candidate failure locations, equal budgets
    cands = {"R0-retrain-model": copy.deepcopy(xeno), "R1-longer-history": expand_history(xeno, 6),
             "R2-repartition-shared-gate": copy.deepcopy(xeno), "R3-encoding-accel-gates": add_accel_gates(xeno)}
    cands["R2-repartition-shared-gate"].shared_gates = {"lower-abdominal-continuity": "axis-maintenance"}
    prof = []
    for name, c in cands.items():
        train_xeno(env, c, CFG["k_int"], rng, push_mag=140.0)
        v = evaluate(env, c, VAL, pushes=[140.0])["140"]; tst = evaluate(env, c, TEST, pushes=[0.0, 140.0])
        added = n_params(c.parameters()) - n_params(xeno.parameters())
        prof.append({"id": name, "validation": v, "test": tst, "addedParams": added})
    axes = [{"id": "survival", "prefer": "max", "assumptions": "mean survival under ±140 N pushes on validation seeds"},
            {"id": "recovered", "prefer": "max", "assumptions": "fraction of pushed episodes with |pitch| < 0.1 after the push"},
            {"id": "axis", "prefer": "min", "assumptions": "axis-maintenance metric"}, {"id": "lower_center", "prefer": "min", "assumptions": "lower-center metric"},
            {"id": "low_noise", "prefer": "min", "assumptions": "action-change metric"}, {"id": "addedParams", "prefer": "min", "assumptions": "representation cost"}]
    sel = ziran_select([{"id": p["id"], "description": p["id"], "cost": max(p["addedParams"], 0), "values": {"survival": p["validation"]["survival"], "recovered": p["validation"]["recovered_fraction"] or 0.0, "axis": p["validation"]["axis"], "lower_center": p["validation"]["lower_center"], "low_noise": p["validation"]["low_noise"], "addedParams": p["addedParams"]}} for p in prof], axes)
    res["repartition"] = {"candidates": prof, "ziran": sel, "baselineRevision": "R0-retrain-model"}
    res["baseline_stress"] = {"xeno14_before_revision": evaluate(env, xeno, TEST, pushes=[0.0, 140.0])}
    res["wall_s"] = round(time.time() - t0, 1)
    return res


def main(quick=False):
    if quick: CFG.update({"iters": 6, "k_int": 2, "eval_eps": 2, "seeds": [1], "block": 2})
    from multiprocessing import Pool
    t0 = time.time()
    with Pool(len(CFG["seeds"])) as pool: per = pool.map(run_seed, [(s, dict(CFG)) for s in CFG["seeds"]])
    out = ROOT / "results" / "xeno14" / ("x14-1-quick" if quick else "x14-1"); out.mkdir(parents=True, exist_ok=True)
    meta = {"milestone": "X14-1", "embodiment": "Walker2d-v5", "organizations": ORGS, "principles": [p.__dict__ for p in registry()], "constants": {"REF": REF, "LAM": LAM, "F_TRAIN": F_TRAIN, "F_EVAL": F_EVAL, **CFG, "T": T},
            "versions": {"python": sys.version.split()[0], "torch": torch.__version__, "numpy": np.__version__}, "claimStatus": "synthetic-world result (simulated embodiment)", "wall_s": round(time.time() - t0, 1)}
    (out / "raw-per-seed.json").write_text(json.dumps({"meta": meta, "seeds": per}, indent=1, default=float))
    print("wrote", out / "raw-per-seed.json", meta["wall_s"], "s")


if __name__ == "__main__":
    main(quick="--quick" in sys.argv)
