"""X14-1b analysis exactly as frozen in results/xeno14/x14-1b/protocol.json. Usage: python -m xeno14.analyze_b"""
from __future__ import annotations
import json, sys
import numpy as np
from . import experiment as X

D = X.ROOT / "results" / "xeno14" / ("x14-1b-quick" if "--quick" in sys.argv else "x14-1b")
ORGS, MET = X.ORGS, X.METRIC
BOOT = np.random.default_rng(0)


def ci(xs):
    xs = np.asarray([x for x in xs if x is not None and np.isfinite(x)], dtype=float)
    if len(xs) < 2: return {"mean": float(xs.mean()) if len(xs) else None, "lo": None, "hi": None, "n": int(len(xs)), "perSeed": xs.round(4).tolist()}
    b = xs[BOOT.integers(0, len(xs), size=(10_000, len(xs)))].mean(axis=1)
    return {"mean": round(float(xs.mean()), 4), "lo": round(float(np.percentile(b, 2.5)), 4), "hi": round(float(np.percentile(b, 97.5)), 4), "n": int(len(xs)), "perSeed": xs.round(4).tolist()}


def sign(c):
    if c["lo"] is None: return "undetermined"
    return "above" if c["lo"] > 0 else "below" if c["hi"] < 0 else "includes-0"


def ft(runs, which, push):
    M = {}
    for i in ORGS:
        row = {}
        for j in ORGS:
            k = MET[j]; row[j] = ci([(r["ft"][which][i][push][k] - r["ft"][which]["control"][push][k]) / r["ft"][which]["control"][push][k] for r in runs])
            row[j]["interval"] = sign(row[j])
        row["_interpretable"] = row[i]["interval"] == "below"
        row["_survivalDelta"] = ci([r["ft"][which][i][push]["survival"] - r["ft"][which]["control"][push]["survival"] for r in runs])
        M[i] = row
    return M


def declared(M):
    return {(i, j): M[i][j]["interval"] for i in ORGS for j in ORGS if i != j and M[i]["_interpretable"] and M[i][j]["interval"] in ("above", "below")}


def main():
    raw = json.loads((D / "raw.json").read_text()); meta = raw["meta"]; out = {"meta": meta, "embodiments": {}}
    for emb in meta["settings"]["embodiments"]:
        runs = [r for r in raw["runs"] if r["embodiment"] == emb]
        E = {"seeds": [r["seed"] for r in runs]}
        E["evaluation"] = {n: {F: {k: ci([r["configs"][n]["eval"][F][k] for r in runs]) for k in ["survival", "axis", "lower_center", "low_noise", "recovered_fraction"]} for F in ["0", "80", "140"]} for n in runs[0]["configs"]}
        E["ignition80"] = {n: {g: ci([r["configs"][n]["eval"]["80"]["gate_ignition_fraction"][g] for r in runs]) for g in ORGS} for n in ["xeno14", "xeno14-scalarized-training"]}
        E["ignitionConsistent"] = {g: float(np.std(E["ignition80"]["xeno14"][g]["perSeed"], ddof=1)) < 0.25 for g in ORGS}
        E["ft"] = {w: {F: ft(runs, w, F) for F in ["140", "80"]} for w in ["xeno14", "tradeoff"]}
        dx, dt = declared(E["ft"]["xeno14"]["140"]), declared(E["ft"]["tradeoff"]["140"])
        E["declaredTransfers140"] = {f"{i}→{j}": s for (i, j), s in dx.items()}
        E["declaredTradeoff140"] = {f"{i}→{j}": s for (i, j), s in dt.items()}
        E["addsInformation140"] = [f"{i}→{j}" for (i, j), s in dx.items() if dt.get((i, j)) != s]
        pair = lambda a: ci([r["configs"]["xeno14"]["eval"]["140"]["survival"] - r["configs"][a]["eval"]["140"]["survival"] for r in runs])
        E["pairedSurvival140"] = {f"xeno14 − {a}": pair(a) for a in ["xeno14-scalarized-training", "xeno14-gates-off", "multiobjective-scalarized-mlp", "standard-mlp"]}
        out["embodiments"][emb] = E
    W = out["embodiments"].get("walker2d")
    if W:
        r = W["ft"]["xeno14"]["140"]["low-noise-movement"]
        out["H1"] = {"rowInterpretable": r["_interpretable"], "axis": r["axis-maintenance"], "lower": r["lower-abdominal-continuity"], "supported": bool(r["_interpretable"] and r["axis-maintenance"]["interval"] == "above" and r["lower-abdominal-continuity"]["interval"] == "above")}
    embs = list(out["embodiments"])
    if len(embs) == 2:
        a, b = (out["embodiments"][e] for e in embs)
        keys = set(a["declaredTransfers140"]) | set(b["declaredTransfers140"])
        ftdiff = [k for k in keys if a["declaredTransfers140"].get(k) != b["declaredTransfers140"].get(k)]
        ign = {g: {"diff": round(a["ignition80"]["xeno14"][g]["mean"] - b["ignition80"]["xeno14"][g]["mean"], 4)} for g in ORGS}
        for g in ORGS:
            xa, xb = np.array(a["ignition80"]["xeno14"][g]["perSeed"]), np.array(b["ignition80"]["xeno14"][g]["perSeed"])
            bs = [BOOT.choice(xa, len(xa)).mean() - BOOT.choice(xb, len(xb)).mean() for _ in range(10_000)]
            ign[g].update({"lo": round(float(np.percentile(bs, 2.5)), 4), "hi": round(float(np.percentile(bs, 97.5)), 4)})
        out["H2"] = {"ftEntriesDiffering": ftdiff, "ignitionDifference": ign, "supported": bool(ftdiff or any(v["lo"] > 0 or v["hi"] < 0 for v in ign.values()))}
    anyE = out["embodiments"].values()
    a_ = any(e["declaredTransfers140"] for e in anyE); b_ = any(e["addsInformation140"] for e in anyE)
    c_ = all(not (e["pairedSurvival140"]["xeno14 − xeno14-scalarized-training"]["hi"] is not None and e["pairedSurvival140"]["xeno14 − xeno14-scalarized-training"]["hi"] < 0) for e in anyE)
    d_ = all(any(e["ignitionConsistent"].values()) for e in anyE)
    out["decision"] = {"a_declaredTransfer": a_, "b_addsInformation": b_, "c_notWorseThanScalarizedSameArchitecture": c_, "d_consistentIgnition": d_,
                       "recommendation": "GO" if a_ and b_ and c_ and d_ else "CONDITIONAL GO" if a_ and b_ else "STOP"}
    (D / "analysis.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({"decision": out["decision"], "H1": out.get("H1", {}).get("supported"), "H2": out.get("H2", {}).get("supported")}, indent=1))


if __name__ == "__main__":
    main()
