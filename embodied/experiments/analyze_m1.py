"""Milestone 1 analysis: Mode A vs Mode B per condition, paired by seed (bootstrap 95% interval over seeds, 10 000
resamples, rng 0). No aggregate score across metrics or conditions. Usage (from embodied/): python -m experiments.analyze_m1"""
from __future__ import annotations
import json
from collections import Counter
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "results" / "xeno-body-ai" / "m1"
BOOT = np.random.default_rng(0)
METRICS = ["fell", "max_axis_deviation", "recovered", "recovery_steps", "corrective_movement", "motor_effort"]


def per_seed(eps, m):
    if m == "fell": return float(np.mean([e["fell"] for e in eps]))
    if m == "recovered": return float(np.mean([e["recovery_steps"] is not None for e in eps]))
    if m == "recovery_steps":
        v = [e["recovery_steps"] for e in eps if e["recovery_steps"] is not None]; return float(np.mean(v)) if v else np.nan
    return float(np.mean([e[m] for e in eps]))


def ci(x):
    x = np.asarray([v for v in x if np.isfinite(v)])
    if len(x) < 2: return {"mean": float(x.mean()) if len(x) else None, "lo": None, "hi": None, "n": int(len(x))}
    b = x[BOOT.integers(0, len(x), (10_000, len(x)))].mean(1)
    return {"mean": round(float(x.mean()), 4), "lo": round(float(np.percentile(b, 2.5)), 4), "hi": round(float(np.percentile(b, 97.5)), 4), "n": int(len(x))}


def main():
    raw = json.loads((D / "raw.json").read_text()); seeds = raw["seeds"]; conds = list(seeds[0]["conditions"])
    table = {}
    for c in conds:
        row = {}
        for m in METRICS:
            a = [per_seed(s["conditions"][c]["A"], m) for s in seeds]; b = [per_seed(s["conditions"][c]["B"], m) for s in seeds]
            diff = [y - x for x, y in zip(a, b)]
            row[m] = {"A": ci(a), "B": ci(b), "B_minus_A": ci(diff)}
        table[c] = row
    lat = {}
    for mode in ["A", "B"]:
        acc = {}
        for s in seeds:
            for c in conds:
                for e in s["conditions"][c][mode]:
                    for layer, v in e["latency"].items(): acc.setdefault(layer, []).append(v)
        lat[mode] = {layer: {"mean_ms": round(float(np.mean([x["mean_ms"] for x in v])), 5), "p95_ms": round(float(np.mean([x["p95_ms"] for x in v])), 5), "max_ms": round(float(max(x["max_ms"] for x in v)), 5)} for layer, v in acc.items()}
    usage = Counter(tuple(p) for s in seeds for c in conds for e in s["conditions"][c]["B"] for p in e["policies_used"])
    # operational-shape mapping from the seed-1 logged episodes (decision pairs)
    shape = []
    for c in conds:
        e = seeds[0]["conditions"][c]["B"][0]; dec = e.get("log", {}).get("decisions", [])
        for k in range(len(dec)):
            cur, nxt = dec[k], dec[k + 1] if k + 1 < len(dec) else None
            shape.append({"condition": c, "t": cur["t"], "current_configuration": cur["chosen"], "ignition_condition": f"decision interval reached; inferred state argmax {int(np.argmax(cur['q']))}",
                          "active_transition": f"policy {cur['chosen']} for 25 steps", "retained_difference": nxt["derived"]["axis_deviation"] if nxt else None,
                          "transformed_difference": (nxt["derived"]["axis_deviation"] - cur["derived"]["axis_deviation"]) if nxt else None,
                          "interrupted_transition": nxt is None and e["fell"], "return_signal": nxt["obs_index"] if nxt else ("fallen" if e["fell"] else "episode end"), "reconfigured_next_condition": nxt["chosen"] if nxt else None})
    summary = {"meta": raw["meta"] | {"note": "paired by seed; B − A; no aggregate score"}, "calibration": [s["calibration"] for s in seeds], "table": table, "latency_by_layer": lat, "mode_B_policy_usage": {str(k): v for k, v in usage.most_common()}, "operational_shape_seed1": shape[:40]}
    (D / "summary.json").write_text(json.dumps(summary, indent=1, default=float))
    L = ["# Xeno-Body + Active Inference — Milestone 1 results (generated)", "", "Experiment 1, balance recovery on Walker2d-v5; 5 seeds × 10 episodes per condition and mode; Mode A = existing Xeno-Body controller, Mode B = the same controller with the Active Inference layer. Values: mean over seeds [95% bootstrap interval]; B − A paired by seed. Claim status: synthetic-world result.", ""]
    L += ["| condition | metric | Mode A | Mode B | B − A |", "|---|---|---|---|---|"]
    f = lambda x: "n/a" if x["mean"] is None else (f"{x['mean']}" + (f" [{x['lo']}, {x['hi']}]" if x["lo"] is not None else ""))
    for c, row in table.items():
        for m in METRICS: L.append(f"| {c} | {m} | {f(row[m]['A'])} | {f(row[m]['B'])} | {f(row[m]['B_minus_A'])} |")
    L += ["", "## Latency by layer (ms, mean of per-episode means / p95 / max)", "", "| mode | layer | mean | p95 | max |", "|---|---|---|---|---|"] + [f"| {mo} | {ly} | {v['mean_ms']} | {v['p95_ms']} | {v['max_ms']} |" for mo, d in lat.items() for ly, v in d.items()]
    L += ["", f"Mode B policy usage (episodes in which a configuration was chosen at least once): {json.dumps(summary['mode_B_policy_usage'])}", "", f"Calibration (Mode B only): {json.dumps(summary['calibration'])}", ""]
    (ROOT / "docs" / "xeno-body-ai-m1-results.md").write_text("\n".join(L))
    print("wrote", D / "summary.json")


if __name__ == "__main__":
    main()
