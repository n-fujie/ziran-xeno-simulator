"""Experiment 1 (Milestone 1): balance recovery, Mode A (existing controller) vs Mode B (existing controller + Active
Inference layer), matched seeds, pushes and sensor noise. Usage (from embodied/): python -m experiments.balance_recovery"""
from __future__ import annotations
import json, sys, time
from multiprocessing import Pool
from pathlib import Path
import numpy as np
import torch
from xeno14.env import make_env, EMBODIMENTS
from xeno14.modules import Xeno14Controller
from xeno14 import experiment as X
from active_inference.observations import ObservationAdapter, OBSERVABILITY
from active_inference.generative_model import GenerativeModel
from active_inference.state_inference import posterior, vfe
from active_inference.policy_selection import select
from benchmarks.fixed_controller import ConfiguredController
from metrics.recovery import recovery_latency

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "embodied" / "configs" / "milestone1.json").read_text())
OUT = ROOT / "results" / "xeno-body-ai" / "m1"
POLICIES = [(o, g) for o in CFG["policies"]["pitch_offsets"] for g in CFG["policies"]["gains"]]
E = CFG["experiment"]; K = CFG["timescales"]["layer2_every_steps"]


def noise_vec(rng, sd, n): return rng.standard_normal(n) * sd * np.array([1.0] * 8 + [10.0] * (n - 8)) if sd else np.zeros(n)


def fast_controller(seed: int) -> Xeno14Controller:
    """The existing Xeno-Body controller, trained with the existing code and checkpointed (created once per seed)."""
    ck = OUT / "controllers" / f"seed{seed}.pt"; c = Xeno14Controller(X.ORGS)
    if ck.exists(): c.load_state_dict(torch.load(ck)); return c
    torch.manual_seed(seed); X.train_xeno(make_env(), c, CFG["fast_controller"]["train_iterations"], np.random.default_rng(seed))
    ck.parent.mkdir(parents=True, exist_ok=True); torch.save(c.state_dict(), ck); return c


def episode(env, ctrl: ConfiguredController, adapter, model, seed, push, noise_sd, mode, log=False):
    """One episode. Mode A: existing controller only (the Active Inference code path is not executed).
    Mode B: same controller, same sensed observations; the Active Inference layer sets the body configuration every K steps."""
    rng = np.random.default_rng(seed + 7); obs, _ = env.reset(seed=seed); data = env.unwrapped.data; ctrl.reset(); ctrl.set(0.0, 1.0)
    lat = {k: [] for k in ["observation_adaptation", "latent_state_inference", "vfe", "efe_preference", "efe_epistemic", "efe_total", "policy_selection", "aif_decision_total", "controller_step_total", "controller_step_with_decision", "layer0_fast_control"]}
    pitch, rows = [], []; prev_a = None; effort = 0.0; corr = 0.0; fell = False; ret = 0.0
    q = model.D.copy() if model else None; pi = POLICIES.index((0.0, 1.0)); decisions = []; pred_prev = None; pred_err = []
    P0, PS = E["push_start_step"], E["push_steps"]; ns = time.perf_counter_ns
    for t in range(E["episode_steps"]):
        sensed = obs + noise_vec(rng, noise_sd, len(obs))
        ts = ns()
        d = adapter.derived(sensed); o = adapter.index(sensed)
        lat["observation_adaptation"].append(ns() - ts)
        decided = False
        if mode == "B" and t % K == 0:
            td = ns(); tm = {"prediction": 0, "preference": 0, "epistemic": 0, "efe_total": 0, "policy_selection": 0}
            if pred_prev is not None: pred_err.append({"t": t, "log_loss": float(-np.log(pred_prev[o] + 1e-16)), "hit": int(np.argmax(pred_prev) == o)})
            t1 = ns(); prior = model.B[pi] @ q if t else model.D; q = posterior(model.A, prior, o); t2 = ns()
            F = vfe(model.A, prior, q, o); t3 = ns()
            sres = select(model, q, CFG["policy_precision_gamma"], tm); pi = sres["chosen"]; ctrl.set(*POLICIES[pi])
            pred_prev = sres["scores"][pi]["predicted_obs"]
            lat["latent_state_inference"].append(t2 - t1); lat["vfe"].append(t3 - t2); lat["efe_preference"].append(tm["preference"]); lat["efe_epistemic"].append(tm["epistemic"])
            lat["efe_total"].append(tm["efe_total"]); lat["policy_selection"].append(tm["policy_selection"]); lat["aif_decision_total"].append(ns() - td); decided = True
            decisions.append({"t": t, "obs_index": o, "derived": d, "q": q.round(4).tolist(), "vfe": F, "policy_scores": [{"policy": POLICIES[k], "G": sc["G"], "pragmatic": sc["pragmatic"], "epistemic": sc["epistemic"]} for k, sc in enumerate(sres["scores"])], "policy_posterior": sres["policy_posterior"].round(4).tolist(), "chosen": POLICIES[pi]})
        t0 = ns(); a = np.clip(ctrl.act(sensed), -1.0, 1.0); lat["layer0_fast_control"].append(ns() - t0)
        total = ns() - ts; lat["controller_step_total"].append(total)
        if decided: lat["controller_step_with_decision"].append(total)
        data.xfrc_applied[1, 0] = push if P0 <= t < P0 + PS else 0.0
        obs, r, term, trunc, _ = env.step(a); ret += float(r)
        pitch.append(float(data.qpos[2])); effort += float(np.sum(a * a))
        if prev_a is not None and t >= P0: corr += float(np.linalg.norm(a - prev_a))
        prev_a = a
        if log: rows.append({"t": t, "raw_obs": obs.round(4).tolist(), "sensed_obs": sensed.round(4).tolist(), "motor_target": a.round(4).tolist(), "config": [ctrl.pitch_offset, ctrl.gain]})
        if term or trunc:
            fell = bool(term)
            if mode == "B" and fell and pred_prev is not None: pred_err.append({"t": t, "log_loss": float(-np.log(pred_prev[adapter.FALLEN] + 1e-16)), "hit": int(np.argmax(pred_prev) == adapter.FALLEN), "outcome": "fallen"})
            break
    data.xfrc_applied[1, 0] = 0.0
    post = pitch[P0:] if len(pitch) > P0 else [np.nan]
    res = {"fell": fell, "steps": len(pitch), "max_axis_deviation": float(np.nanmax(np.abs(post))), "recovery_steps": recovery_latency(pitch, P0 + PS, CFG["recovery"]["pitch_threshold"], CFG["recovery"]["hold_steps"]),
           "corrective_movement": corr, "motor_effort": effort, "episode_return": ret, "latency_ns": {k: v for k, v in lat.items() if v},
           "prediction_error": pred_err, "policy_counts": {str(tuple(x["chosen"])): sum(1 for y in decisions if y["chosen"] == x["chosen"]) for x in decisions},
           "pitch_trace": [round(x, 5) for x in pitch] if log else None}
    if log: res["log"] = {"steps": rows, "decisions": decisions}
    return res


def calibrate(env, ctrl, adapter, seed) -> GenerativeModel:
    """Mode B only: learn B from calibration episodes (random policy per decision interval, random pushes), seeds disjoint from evaluation."""
    g = CFG["generative_model"]; m = GenerativeModel(adapter.n_obs, len(POLICIES), adapter.n_rate, adapter.FALLEN, g["likelihood_precision"], g["dirichlet_prior"], CFG["preferences"])
    rng = np.random.default_rng(seed * 101); n = 0
    for ep in range(g["calibration_episodes"]):
        obs, _ = env.reset(seed=g["calibration_seed_base"] + 100 * seed + ep); data = env.unwrapped.data; ctrl.reset()
        push = float(rng.choice([0, 60, 120, 180]) * rng.choice([-1, 1])); pi = int(rng.integers(len(POLICIES))); ctrl.set(*POLICIES[pi]); o_prev = adapter.index(obs); fell = False
        for t in range(E["episode_steps"]):
            if t and t % K == 0:
                o = adapter.index(obs); m.learn_transition(pi, o_prev, o); n += 1; o_prev = o; pi = int(rng.integers(len(POLICIES))); ctrl.set(*POLICIES[pi])
            data.xfrc_applied[1, 0] = push if E["push_start_step"] <= t < E["push_start_step"] + E["push_steps"] else 0.0
            obs, _r, term, trunc, _ = env.step(np.clip(ctrl.act(obs), -1, 1))
            if term: fell = True; break
        data.xfrc_applied[1, 0] = 0.0
        if fell: m.learn_transition(pi, o_prev, adapter.FALLEN); n += 1
    m.calibration_transitions = n
    return m


def param_sha(m) -> str:
    import hashlib
    h = hashlib.sha256()
    for k, v in sorted(m.state_dict().items()): h.update(k.encode()); h.update(v.detach().numpy().tobytes())
    return h.hexdigest()


def run_seed(seed: int) -> dict:
    """Both modes use this one controller object (loaded once from the seed's checkpoint). Its parameter hash is
    recorded before any episode and after every condition of each mode; any change invalidates the comparison."""
    torch.set_num_threads(1); env = make_env(); base = fast_controller(seed); ctrl = ConfiguredController(base)
    h_start = param_sha(base); used = {"A": set(), "B": set()}
    ad = ObservationAdapter(CFG["observation"]["pitch_edges"], CFG["observation"]["rate_edges"])
    t0 = time.time(); model = calibrate(env, ctrl, ad, seed); cal_s = time.time() - t0
    out = {"seed": seed, "calibration": {"transitions": model.calibration_transitions, "seconds": round(cal_s, 1), "episodes": CFG["generative_model"]["calibration_episodes"]}, "conditions": {}}
    for direction in E["directions"]:
        for F in E["pushes_N"]:
            for sd in [0.0, E["sensor_noise_sd"]]:
                key = f"{direction}|{int(F)}N|noise{sd}"; out["conditions"][key] = {}
                for mode in ["A", "B"]:
                    eps = [episode(env, ctrl, ad, model if mode == "B" else None, E["eval_seed_base"] + 100 * seed + k, F if direction == "forward" else -F, sd, mode, log=(seed == 1 and k == 0)) for k in range(E["episodes_per_condition"])]
                    out["conditions"][key][mode] = eps; used[mode].add(param_sha(base))
    out["controller_identity"] = {"param_sha256_at_start": h_start, "param_sha256_seen_in_A": sorted(used["A"]), "param_sha256_seen_in_B": sorted(used["B"]),
                                  "same_controller_in_both_modes": used["A"] == used["B"] == {h_start}}
    if not out["controller_identity"]["same_controller_in_both_modes"]: raise RuntimeError(f"seed {seed}: controller differs between modes — comparison invalid")
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True); t0 = time.time()
    import hashlib
    for sd in CFG["seeds"]: fast_controller(sd)
    ck = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((OUT / "controllers").glob("*.pt"))}
    with Pool(len(CFG["seeds"])) as p: res = p.map(run_seed, CFG["seeds"])
    import platform, subprocess, mujoco, gymnasium
    def sysctl(k):
        try: return subprocess.run(["sysctl", "-n", k], capture_output=True, text=True).stdout.strip()
        except Exception: return "unknown"
    env_info = {"machine": platform.machine(), "cpu": sysctl("machdep.cpu.brand_string"), "cores": sysctl("hw.ncpu"), "memory_bytes": sysctl("hw.memsize"), "os": platform.platform(),
                "python": platform.python_version(), "mujoco": mujoco.__version__, "gymnasium": gymnasium.__version__, "torch": torch.__version__, "numpy": np.__version__,
                "processes": len(CFG["seeds"]), "torch_threads_per_process": 1,
                "timing_scope": "aif_decision_total and its components exclude logging; controller_step_total includes the construction of the per-decision log record in Mode B (not the per-step raw log, which is written only for one episode per condition in seed 1 and is outside the timer)"}
    meta = {"milestone": 1, "runtime_environment": env_info, "controller_checkpoints_sha256": ck, "config": CFG, "observability": OBSERVABILITY, "policies": POLICIES, "not_instantiable": {"lateral impulse": "Walker2d-v5 is planar (sagittal plane only)"}, "wall_s": round(time.time() - t0, 1), "versions": {"torch": torch.__version__, "numpy": np.__version__}}
    (OUT / "raw.json").write_text(json.dumps({"meta": meta, "seeds": res}, default=float))
    print("wrote", OUT / "raw.json", meta["wall_s"], "s")


if __name__ == "__main__":
    main()
