"""Milestone 1 analysis. Mode A vs Mode B per condition, paired by seed (bootstrap 95% interval over the 5 seeds,
10 000 resamples, rng 0). Latency pooled over all calls (median / p95 / max). No aggregate score.
Usage (from embodied/): python -m experiments.analyze_m1"""
from __future__ import annotations
import json
from collections import Counter
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "results" / "xeno-body-ai" / "m1"
BOOT = np.random.default_rng(0)
PAIRED = ["fall_rate", "max_posture_deviation", "recovered_fraction", "recovery_latency_steps", "corrective_action_magnitude", "motor_effort", "episode_return_secondary"]
LAT = ["observation_adaptation", "latent_state_inference", "vfe", "efe_preference", "efe_epistemic", "efe_total", "policy_selection", "aif_decision_total", "layer0_fast_control", "controller_step_total", "controller_step_with_decision"]


def per_seed(eps, m):
    if m == "fall_rate": return float(np.mean([e["fell"] for e in eps]))
    if m == "max_posture_deviation": return float(np.nanmean([e["max_axis_deviation"] for e in eps]))
    if m == "recovered_fraction": return float(np.mean([e["recovery_steps"] is not None for e in eps]))
    if m == "recovery_latency_steps":
        v = [e["recovery_steps"] for e in eps if e["recovery_steps"] is not None]; return float(np.mean(v)) if v else np.nan
    if m == "corrective_action_magnitude": return float(np.mean([e["corrective_movement"] for e in eps]))
    if m == "motor_effort": return float(np.mean([e["motor_effort"] for e in eps]))
    if m == "episode_return_secondary": return float(np.mean([e["episode_return"] for e in eps]))


def ci(x):
    x = np.asarray([v for v in x if v is not None and np.isfinite(v)], dtype=float)
    if len(x) < 2: return {"mean": round(float(x.mean()), 4) if len(x) else None, "median": round(float(np.median(x)), 4) if len(x) else None, "lo": None, "hi": None, "n": int(len(x)), "perSeed": x.round(4).tolist()}
    b = x[BOOT.integers(0, len(x), (10_000, len(x)))].mean(1)
    return {"mean": round(float(x.mean()), 4), "median": round(float(np.median(x)), 4), "lo": round(float(np.percentile(b, 2.5)), 4), "hi": round(float(np.percentile(b, 97.5)), 4), "n": int(len(x)), "perSeed": x.round(4).tolist()}


def interval(c):
    if c["lo"] is None: return "undetermined"
    return "B higher" if c["lo"] > 0 else "B lower" if c["hi"] < 0 else "no difference established"


def main():
    raw = json.loads((D / "raw.json").read_text()); seeds = raw["seeds"]; conds = list(seeds[0]["conditions"])
    table = {}
    for c in conds:
        row = {}
        for m in PAIRED:
            a = [per_seed(s["conditions"][c]["A"], m) for s in seeds]; b = [per_seed(s["conditions"][c]["B"], m) for s in seeds]
            d = ci([y - x for x, y in zip(a, b)]); row[m] = {"A": ci(a), "B": ci(b), "B_minus_A": d, "interval": interval(d)}
        pe = [x for s in seeds for e in s["conditions"][c]["B"] for x in e["prediction_error"]]
        row["prediction_error_modeB"] = {"decisions": len(pe), "mean_log_loss": round(float(np.mean([x["log_loss"] for x in pe])), 4) if pe else None, "argmax_hit_rate": round(float(np.mean([x["hit"] for x in pe])), 4) if pe else None, "modeA": "not applicable (no generative model)"}
        pc = Counter(); [pc.update(e["policy_counts"]) for s in seeds for e in s["conditions"][c]["B"]]
        tot = sum(pc.values()); row["policy_distribution_modeB"] = {k: round(v / tot, 3) for k, v in pc.most_common()}
        table[c] = row
    lat = {}
    for mode in ["A", "B"]:
        pool = {k: [] for k in LAT}
        for s in seeds:
            for c in conds:
                for e in s["conditions"][c][mode]:
                    for k, v in e["latency_ns"].items(): pool[k].extend(v)
        lat[mode] = {k: {"calls": len(v), "median_ms": round(float(np.median(v)) / 1e6, 5), "p95_ms": round(float(np.percentile(v, 95)) / 1e6, 5), "max_ms": round(float(np.max(v)) / 1e6, 5)} for k, v in pool.items() if v}
    aif = lat["B"]["aif_decision_total"]
    budget = {f"< {b} ms": {"median": aif["median_ms"] < b, "p95": aif["p95_ms"] < b, "max": aif["max_ms"] < b} for b in (200, 100, 50, 10)}
    counts = {k: {iv: sum(1 for c in conds if table[c][k]["interval"] == iv) for iv in ["B higher", "B lower", "no difference established", "undetermined"]} for k in PAIRED}
    ident = {s["seed"]: s["controller_identity"] for s in seeds}
    per_episode_falls = {c: {str(s["seed"]): {"A": [int(e["fell"]) for e in s["conditions"][c]["A"]], "B": [int(e["fell"]) for e in s["conditions"][c]["B"]]} for s in seeds} for c in conds}
    summary = {"meta": raw["meta"], "controller_identity": ident, "per_episode_fall": per_episode_falls, "table": table, "interval_counts_over_conditions": counts, "latency": lat, "aif_budget_check": budget, "calibration": [s["calibration"] for s in seeds]}
    (D / "summary.json").write_text(json.dumps(summary, indent=1, default=float))
    f = lambda x: "n/a" if x["mean"] is None else (f"{x['mean']}" + (f" [{x['lo']}, {x['hi']}]" if x["lo"] is not None else ""))
    L = ["# Xeno-Body + Active Inference — Milestone 1 results (generated)", "", "Planar Xeno-Body prototype (Walker2d-v5). Experiment 1, balance recovery; seeds 1–5 (paired: each seed has one trained base controller used by both modes) × 10 episodes per condition and mode. Values: mean over seeds [95% bootstrap interval over seeds]; B − A paired by seed. Claim status: synthetic-world result. Lateral impulses are not included: the embodiment is planar.", ""]
    for c, row in table.items():
        L += [f"## {c}", "", "| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |", "|---|---|---|---|---|---|---|---|"] + [f"| {m} | {f(row[m]['A'])} | {f(row[m]['B'])} | {f(row[m]['B_minus_A'])} | {row[m]['B_minus_A']['median']} | {row[m]['B_minus_A']['n']} | {row[m]['B_minus_A']['perSeed']} | {row[m]['interval']} |" for m in PAIRED]
        pe = row["prediction_error_modeB"]
        L += ["", f"Prediction error (Mode B, {pe['decisions']} decisions): mean log loss {pe['mean_log_loss']}, argmax hit rate {pe['argmax_hit_rate']}; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {json.dumps(row['policy_distribution_modeB'])}", ""]
    L += ["## Interval summary over the 12 conditions", "", "| metric | B higher | B lower | no difference established |", "|---|---|---|---|"] + [f"| {k} | {v['B higher']} | {v['B lower']} | {v['no difference established']} |" for k, v in counts.items()]
    L += ["", "## Latency (ms, pooled over all calls)", "", "| mode | component | calls | median | p95 | max |", "|---|---|---|---|---|---|"] + [f"| {mo} | {k} | {v['calls']} | {v['median_ms']} | {v['p95_ms']} | {v['max_ms']} |" for mo, d in lat.items() for k, v in d.items()]
    L += ["", "## Active Inference decision budget", "", "| budget | median below | p95 below | max below |", "|---|---|---|---|"] + [f"| {k} | {v['median']} | {v['p95']} | {v['max']} |" for k, v in budget.items()] + [""]
    (ROOT / "docs" / "xeno-body-ai-m1-results.md").write_text("\n".join(L))
    print(json.dumps({"interval_counts": counts, "aif": aif, "budget": budget}, indent=1))


if __name__ == "__main__":
    main()
