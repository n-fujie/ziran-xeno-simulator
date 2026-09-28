"""Aggregates results/xeno14/x14-1/raw-per-seed.json into result files and docs/xeno14-x14-1-results.md.
Fragility Transfer FT[i][j] = change in organization j's normalized metric (positive = j deteriorates) after an
intervention that optimizes organization i, relative to a matched control (same optimization effort without
emphasis). Uncertainty: per-seed values, mean, standard deviation and sign consistency. No scalar total is formed.
Usage: python -m xeno14.analyze   (from embodied/)
"""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
from .experiment import ORGS, METRIC, REF

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "results" / "xeno14" / "x14-1" / "raw-per-seed.json"
OUT = ROOT / "results" / "xeno14" / "x14-1"
KEYS = ["survival", "axis", "lower_center", "low_noise", "recovered_fraction"]


def nm(v, key):
    return 4.0 if v is None or not math.isfinite(v) else min(v / REF[key], 4.0)


def stats(xs):
    xs = [x for x in xs if x is not None and math.isfinite(x)]
    if not xs: return {"mean": None, "sd": None, "n": 0, "perSeed": []}
    return {"mean": round(float(np.mean(xs)), 4), "sd": round(float(np.std(xs, ddof=1)), 4) if len(xs) > 1 else None, "n": len(xs), "perSeed": [round(x, 4) for x in xs]}


def ft_matrix(seeds, which, push):
    M = {}
    for i in ORGS:
        row = {}
        for j in ORGS:
            k = METRIC[j]
            d = [nm(s["ft"][which][i][push][k], k) - nm(s["ft"][which]["control"][push][k], k) for s in seeds]
            pos, neg = sum(x > 0.05 for x in d), sum(x < -0.05 for x in d)
            row[j] = {**stats(d), "signConsistent": "deteriorates" if pos == len(d) else "improves" if neg == len(d) else "inconsistent"}
        ds = [s["ft"][which][i][push]["survival"] - s["ft"][which]["control"][push]["survival"] for s in seeds]
        row["survival"] = stats(ds)
        M[i] = row
    return M


def main():
    raw = json.loads(RAW.read_text()); seeds = raw["seeds"]; meta = raw["meta"]
    names = list(seeds[0]["configs"].keys())
    configs = {}
    for n in names:
        c0 = seeds[0]["configs"][n]
        ev = {F: {k: stats([s["configs"][n]["eval"][F][k] for s in seeds]) for k in KEYS} for F in c0["eval"]}
        extra = {}
        if "gate_mean" in c0["eval"]["80"]:
            extra = {F: {"gate_ignition_fraction": {g: stats([s["configs"][n]["eval"][F]["gate_ignition_fraction"][g] for s in seeds]) for g in c0["eval"][F]["gate_ignition_fraction"]},
                         "conflict_fraction_negative": {p: stats([s["configs"][n]["eval"][F]["conflict_fraction_negative"][p] for s in seeds]) for p in c0["eval"][F]["conflict_fraction_negative"]},
                         "conflict_cos_mean": {p: stats([s["configs"][n]["eval"][F]["conflict_cos_mean"][p] for s in seeds]) for p in c0["eval"][F]["conflict_cos_mean"]}} for F in c0["eval"]}
        configs[n] = {"role": c0["role"], "family": c0["family"], "objective": c0["objective"], "params": c0["params"], "trainSteps": stats([s["configs"][n]["train_steps"] for s in seeds]), "eval": ev, "xeno": extra}
    removal = {k: {F: {m: stats([s["removal"][k][F][m] for s in seeds]) for m in ["survival", "axis", "lower_center", "low_noise"]} for F in seeds[0]["removal"][k]} for k in seeds[0]["removal"]}
    ft = {w: {F: ft_matrix(seeds, w, F) for F in ["80", "140"]} for w in ["xeno14", "tradeoff-scalarized-mlp"]}
    # does the intervention on i improve i itself? (required for FT to be about "improving i")
    selfImp = {w: {F: {i: ft[w][F][i][i]["signConsistent"] for i in ORGS} for F in ft[w]} for w in ft}
    # agreement between Xeno-14 FT and ordinary trade-off analysis (off-diagonal consistent signs)
    agree = {}
    for F in ["80", "140"]:
        rows = []
        for i in ORGS:
            for j in ORGS:
                if i == j: continue
                a, b = ft["xeno14"][F][i][j]["signConsistent"], ft["tradeoff-scalarized-mlp"][F][i][j]["signConsistent"]
                rows.append({"i": i, "j": j, "xeno14": a, "tradeoff": b, "same": a == b})
        agree[F] = rows
    rep = []
    for s in seeds:
        r = s["repartition"]; sel = r["ziran"]["selected"][0] if r["ziran"]["selected"] else None
        test = {c["id"]: c["test"]["140"]["survival"] for c in r["candidates"]}
        rep.append({"seed": s["seed"], "selected": sel, "pareto": r["ziran"]["pareto"], "testSurvival140": test, "selectedMinusRetrain": (test[sel] - test["R0-retrain-model"]) if sel else None, "beforeRevision": s["baseline_stress"]["xeno14_before_revision"]["140"]["survival"]})
    diffs = [x["selectedMinusRetrain"] for x in rep if x["selectedMinusRetrain"] is not None]
    repartition = {"perSeed": rep, "selectedMinusRetrain": stats(diffs), "selectedDiffersFromRetrain": sum(x["selected"] != "R0-retrain-model" for x in rep), "note": "positive = the Ziran-selected revision survives the 140 N stress better than plain retraining on held-out test seeds"}

    X = configs["xeno14"]["eval"]
    def m(n, F, k): return configs[n]["eval"][F][k]["mean"]
    stop = {
        "reduces_to_reward_shaping": {"test": "does module-wise training differ from training the same architecture on the scalarized objective?", "xeno14_140": {k: m("xeno14", "140", k) for k in KEYS[:4]}, "scalarized_same_architecture_140": {k: m("xeno14-scalarized-training", "140", k) for k in KEYS[:4]}},
        "explained_by_multiobjective": {"xeno14_140": m("xeno14", "140", "survival"), "multiobjective_mlp_140": m("multiobjective-scalarized-mlp", "140", "survival")},
        "ft_adds_information_beyond_tradeoff": {F: sum(not r["same"] for r in agree[F]) for F in agree},
        "ignition_arbitrary_or_harmful": {"gated_140": m("xeno14", "140", "survival"), "gates_off_140": m("xeno14-gates-off", "140", "survival")},
        "repartition_effect": repartition["selectedMinusRetrain"],
        "simpler_components_reproduce": {n: m(n, "140", "survival") for n in configs},
        "privileged_information": "none: all controllers receive the same 17-dim observation (proprioceptive baseline a subset); push timing and force are never observed",
        "metrics_encode_result_by_construction": "partly: the organization metrics are the objectives the Xeno-14 modules optimize; FT and ablations are therefore reported against controls and against the scalarized objective on the same metrics",
    }
    summary = {"meta": {k: meta[k] for k in ["milestone", "embodiment", "organizations", "constants", "versions", "claimStatus", "wall_s"]}, "configs": configs, "removal": removal, "ftSelfImprovement": selfImp, "ftVsTradeoffAgreement": agree, "repartition": repartition, "stopConditions": stop}
    for name, obj in {"summary.json": summary, "ft-matrix.json": ft, "ablations.json": {"retrained": {n: configs[n] for n in configs if configs[n]["role"] == "ablation"}, "removalAtEvaluation": removal}, "repartition.json": repartition, "baselines.json": {n: configs[n] for n in configs if configs[n]["role"] == "baseline"}}.items():
        (OUT / name).write_text(json.dumps(obj, indent=1))
    # ComparisonRecord-shaped records (schema: comparison/core/schema.ts)
    recs = []
    for n, c in configs.items():
        recs.append({"world": "X14-1-walker2d-push", "framework": "xeno14-embodied" if n.startswith("xeno14") else "reinforcement-learning", "configuration": n, "role": "primary" if n == "xeno14" else c["role"],
                     "representationSupplied": [c["family"], c["objective"]], "representationGenerated": ["ES-optimized parameters"], "observationsSupplied": ["Walker2d-v5 17-dim observation" if n != "proprioceptive-mlp" else "joint angles and velocities (12)"], "observationsRevised": [],
                     "interventions": ["torso push ±80 N (training), 0 / ±80 / ±140 N (evaluation)"], "detectedDifferences": [], "inaccessibleDifferences": ["push timing and force (no controller observes them)"], "branchChanges": [], "timing": {}, "failures": [f"falls at 140 N: survival {c['eval']['140']['survival']['mean']}"], "resourceUse": {"trainSteps": c["trainSteps"]["mean"] or 0}, "reorganization": [], "modelRevisions": [], "descriptionRevisions": [],
                     "measurements": {f"{F}:{k}": c["eval"][F][k]["mean"] for F in c["eval"] for k in KEYS}, "burden": [], "cost": {"computeMs": 0, "modelEvaluations": None, "dataSteps": c["trainSteps"]["mean"] or 0, "observationsUsed": 0, "interventionCount": 0, "memoryItems": None, "representationComplexity": c["params"]}, "conversions": [], "profile": {k: [] for k in ["preserves", "merges", "cannotExpress", "detectsEarlier", "detectsLater", "requiresPredefined", "canRevise", "inaccessible", "interventionDifferences"]}, "claimStatus": "synthetic-world result", "notes": ["baselines are policies trained by the same evolution-strategy optimizer (policy search), filed under reinforcement-learning"]})
    (OUT / "records.json").write_text(json.dumps(recs, indent=1))
    (OUT / "operations.json").write_text(json.dumps([op for s in seeds for op in s["ops"]], indent=1))
    write_report(summary, ft)
    print("wrote", OUT)


def fmt(s):
    if isinstance(s, dict) and "mean" in s: return "n/a" if s["mean"] is None else f"{s['mean']}" + (f" ± {s['sd']}" if s.get("sd") is not None else "")
    return str(s)


def write_report(S, ft):
    L = ["# Xeno-14 Milestone X14-1 — results (generated)", "", f"Generated by `python -m xeno14.analyze`. Embodiment {S['meta']['embodiment']}; organizations: {', '.join(S['meta']['organizations'])}. Seeds {S['meta']['constants']['seeds']}; values are mean ± sd over seeds. Claim status: **{S['meta']['claimStatus']}**. No scalar total across organizations is reported.", "",
         "## Evaluation (held-out seeds)", "", "| configuration | role | push N | survival | axis | lower_center | low_noise | recovered | params | train steps |", "|---|---|---|---|---|---|---|---|---|---|"]
    for n, c in S["configs"].items():
        for F, e in c["eval"].items():
            L.append(f"| {n} | {c['role']} | {F} | {fmt(e['survival'])} | {fmt(e['axis'])} | {fmt(e['lower_center'])} | {fmt(e['low_noise'])} | {fmt(e['recovered_fraction'])} | {c['params']} | {fmt(c['trainSteps'])} |")
    x = S["configs"]["xeno14"]["xeno"]
    if x:
        L += ["", "## Xeno-14 ignition and conflict (80 N)", "", "| organization | ignition fraction (gate > 0.5) |", "|---|---|"] + [f"| {g} | {fmt(v)} |" for g, v in x["80"]["gate_ignition_fraction"].items()]
        L += ["", "| pair | mean cosine of gated contributions | fraction of steps with cosine < −0.2 |", "|---|---|---|"] + [f"| {p} | {fmt(x['80']['conflict_cos_mean'][p])} | {fmt(v)} |" for p, v in x["80"]["conflict_fraction_negative"].items()]
    for w in ft:
        for F in ft[w]:
            L += ["", f"## Fragility Transfer — {w}, push {F} N", "", "Rows: organization improved by the intervention; columns: change in each organization's normalized metric (positive = deteriorates) vs the matched control. Per-seed values in ft-matrix.json.", "", "| improve ↓ / effect on → | " + " | ".join(ORGS) + " | survival Δ |", "|---|" + "---|" * (len(ORGS) + 1)]
            for i in ORGS:
                L.append(f"| {i} | " + " | ".join(f"{fmt(ft[w][F][i][j])} ({ft[w][F][i][j]['signConsistent']})" for j in ORGS) + f" | {fmt(ft[w][F][i]['survival'])} |")
    L += ["", "## FT vs ordinary trade-off analysis (off-diagonal sign agreement)", ""]
    for F, rows in S["ftVsTradeoffAgreement"].items():
        L.append(f"- {F} N: {sum(r['same'] for r in rows)}/{len(rows)} entries agree; " + "; ".join(f"{r['i']}→{r['j']}: xeno14 {r['xeno14']}, trade-off {r['tradeoff']}" for r in rows if not r["same"]))
    L += ["", "## Module removal at evaluation (no retraining)", "", "| removed | survival 0 N | survival 80 N |", "|---|---|---|"] + [f"| {k.replace('remove:', '')} | {fmt(v['0']['survival'])} | {fmt(v['80']['survival'])} |" for k, v in S["removal"].items()]
    r = S["repartition"]
    L += ["", "## Architecture repartition (140 N stress; selection by v0.3.0 paretoFront / selectFrom, lexicographic)", "", "| seed | selected | Pareto set | test survival per candidate | selected − retrain |", "|---|---|---|---|---|"] + [f"| {p['seed']} | {p['selected']} | {', '.join(p['pareto'])} | {json.dumps({k: round(v, 3) for k, v in p['testSurvival140'].items()})} | {round(p['selectedMinusRetrain'], 3) if p['selectedMinusRetrain'] is not None else 'n/a'} |" for p in r["perSeed"]]
    L += [f"", f"Selected − retrain (mean ± sd): {fmt(r['selectedMinusRetrain'])}; selected differs from retraining in {r['selectedDiffersFromRetrain']}/{len(r['perSeed'])} seeds.", "", "## Stop-condition inputs", "", "```json", json.dumps(S["stopConditions"], indent=1), "```", ""]
    (ROOT / "docs" / "xeno14-x14-1-results.md").write_text("\n".join(L))


if __name__ == "__main__":
    main()
