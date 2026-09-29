"""X14-1b experiment (protocol results/xeno14/x14-1b/protocol.json, frozen in c7d370b).
Usage: python -m xeno14.experiment_b [--quick]   (from embodied/)"""
from __future__ import annotations
import copy, json, sys, time
from multiprocessing import Pool
import numpy as np
import torch
from .env import make_env, EMBODIMENTS
from .modules import Xeno14Controller, MLPPolicy, n_params
from .es import es_optimize
from . import experiment as X

P = json.loads((X.ROOT / "results" / "xeno14" / "x14-1b" / "protocol.json").read_text())
B = {"iters": 48, "k_int": 24, "eval_eps": 10, "seeds": P["seeds"], "embodiments": list(P["embodiments"])}


def run_task(arg):
    emb_name, seed, b = arg; X.CFG.update({"eval_eps": b["eval_eps"], "block": 8})
    torch.manual_seed(seed); torch.set_num_threads(1)
    E = EMBODIMENTS[emb_name]; env = make_env(emb_name); rng = np.random.default_rng(1000 * seed + (0 if emb_name == "walker2d" else 1)); t0 = time.time()
    EV = 40_000 + 100 * seed
    out = {"embodiment": emb_name, "seed": seed, "configs": {}, "ft": {"xeno14": {}, "tradeoff": {}}}
    cfgs = {"xeno14": Xeno14Controller(X.ORGS, emb=E), "xeno14-scalarized-training": Xeno14Controller(X.ORGS, emb=E), "xeno14-gates-off": Xeno14Controller(X.ORGS, gated=False, emb=E),
            "multiobjective-scalarized-mlp": MLPPolicy(emb=E), "standard-mlp": MLPPolicy(emb=E)}
    for name, pol in cfgs.items():
        if name in ("xeno14", "xeno14-gates-off"): log = X.train_xeno(env, pol, b["iters"], rng)
        elif name in ("xeno14-scalarized-training", "multiobjective-scalarized-mlp"): log = X.train(env, pol, X.f_scalar, b["iters"], rng)
        else: log = X.train(env, pol, X.f_standard, b["iters"], rng)
        out["configs"][name] = {"eval": X.evaluate(env, pol, EV, record_xeno=isinstance(pol, Xeno14Controller)), "train_steps": log["steps"], "params": n_params(pol.parameters())}
    xeno, smlp = cfgs["xeno14"], cfgs["multiobjective-scalarized-mlp"]
    c = copy.deepcopy(xeno); X.train_xeno(env, c, b["k_int"], rng); out["ft"]["xeno14"]["control"] = X.evaluate(env, c, EV, pushes=[80.0, 140.0])
    for o in X.ORGS:
        c = copy.deepcopy(xeno); es_optimize(c.module_params(o), X.fitness_for(env, c, X.f_org(o)), b["k_int"], rng); out["ft"]["xeno14"][o] = X.evaluate(env, c, EV, pushes=[80.0, 140.0])
    c = copy.deepcopy(smlp); X.train(env, c, X.f_scalar, b["k_int"], rng); out["ft"]["tradeoff"]["control"] = X.evaluate(env, c, EV, pushes=[80.0, 140.0])
    for o in X.ORGS:
        c = copy.deepcopy(smlp); X.train(env, c, X.f_emphasis(o), b["k_int"], rng); out["ft"]["tradeoff"][o] = X.evaluate(env, c, EV, pushes=[80.0, 140.0])
    out["wall_s"] = round(time.time() - t0, 1)
    return out


def main(quick=False):
    b = dict(B)
    if quick: b.update({"iters": 2, "k_int": 1, "eval_eps": 2, "seeds": [1], "embodiments": ["hopper"]})
    tasks = [(e, s, b) for e in b["embodiments"] for s in b["seeds"]]; t0 = time.time()
    with Pool(min(8, len(tasks))) as pool: res = pool.map(run_task, tasks)
    d = X.ROOT / "results" / "xeno14" / ("x14-1b-quick" if quick else "x14-1b"); d.mkdir(parents=True, exist_ok=True)
    meta = {"protocol": "X14-1b", "protocolFreezeCommit": "c7d370bee54e6f0201ae6304621e753ffb853609", "settings": b, "masses_kg": {e: float(make_env(e).unwrapped.model.body_mass.sum()) for e in b["embodiments"]}, "versions": {"torch": torch.__version__, "numpy": np.__version__}, "wall_s": round(time.time() - t0, 1)}
    (d / "raw.json").write_text(json.dumps({"meta": meta, "runs": res}, indent=1, default=float))
    print("wrote", d / "raw.json", meta["wall_s"], "s")


if __name__ == "__main__":
    main(quick="--quick" in sys.argv)
