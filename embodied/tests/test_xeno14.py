"""Tests for the Xeno-14 X14-1 layer. Run: ../../.venv/bin/python -m pytest tests (from embodied/)."""
import json, re, subprocess, sys
from pathlib import Path
import numpy as np
import torch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xeno14.principles import registry, IMPLEMENTED
from xeno14.modules import Xeno14Controller, MLPPolicy, GRUPolicy, History, OBS, ACT
from xeno14.env import make_env, run_episode
from xeno14.es import es_optimize
from xeno14 import experiment as X

ROOT = Path(__file__).resolve().parents[2]


def test_registry_matches_existing_specification():
    src = (ROOT / "src" / "domains" / "body.ts").read_text()
    block = src[src.index("export const XENO14 = ["):src.index("] as const")]
    ts = re.findall(r"'([a-z-]+)'", block)
    assert [p.canonical for p in registry()] == ts, "canonical names must equal src/domains/body.ts XENO14 (no silent renaming)"
    assert sorted(IMPLEMENTED) == sorted(X.ORGS) and len(IMPLEMENTED) == 3
    assert sum(p.status == "not-implemented" for p in registry()) == 11


def test_controller_logs_gates_and_conflict_and_modules_are_removable():
    c = Xeno14Controller(X.ORGS, H=3)
    for m in c.mods.values():
        torch.nn.init.normal_(m.body[2].weight, std=0.5)
    obs = np.random.default_rng(0).standard_normal(OBS)
    a = c.act(obs); info = c.last_info()
    assert a.shape == (ACT,) and set(info["gates"]) == set(X.ORGS) and len(info["conflict_cos"]) == 3
    c.disabled = {"axis-maintenance"}; c.reset(); c.act(obs)
    assert "axis-maintenance" not in c.last_info()["gates"]


def test_history_buffer_shape():
    h = History(3); x = torch.ones(OBS)
    assert h.push(x).shape == (OBS * 4,) and h.push(x).shape == (OBS * 4,)


def test_module_objective_uses_only_its_own_metric():
    base = {"survival": 1.0, "axis": 0.01, "lower_center": 0.0025, "low_noise": 0.1}
    for o in X.ORGS:
        f = X.f_org(o)
        for other in X.ORGS:
            if other == o: continue
            changed = dict(base); changed[X.METRIC[other]] *= 3
            assert f(changed) == f(base), f"{o} objective must not depend on {other}"


def test_no_privileged_information_in_observation():
    env = make_env(); seen = []
    class Spy(MLPPolicy):
        def act(self, obs): seen.append(np.array(obs)); return super().act(obs)
    run_episode(env, Spy(), seed=1, push=80.0)
    assert all(o.shape == (OBS,) for o in seen), "controllers receive only the 17-dim observation"


def test_es_is_deterministic_given_rng():
    env = make_env()
    def run():
        torch.manual_seed(0); p = MLPPolicy(); es_optimize(list(p.parameters()), X.fitness_for(env, p, X.f_standard), 1, np.random.default_rng(3), pairs=2)
        return torch.nn.utils.parameters_to_vector(p.parameters()).detach().numpy()
    assert np.allclose(run(), run())


def test_ziran_bridge_uses_v030_selection():
    sel = X.ziran_select([{"id": "a", "description": "a", "cost": 0, "values": {"s": 0.9, "c": 1}}, {"id": "b", "description": "b", "cost": 0, "values": {"s": 0.5, "c": 0}}],
                         [{"id": "s", "prefer": "max", "assumptions": "t"}, {"id": "c", "prefer": "min", "assumptions": "t"}])
    assert set(sel["pareto"]) == {"a", "b"} and sel["selected"] == ["a"] and sel["policyOrigin"] == "external"


def test_embodied_layer_is_isolated_from_frozen_core():
    for d in ["src", "public", "bin", "comparison"]:
        for f in (ROOT / d).rglob("*.ts"):
            if f.name == "xeno14-bridge.ts": continue
            assert not re.search(r"(import|from|require\()[^\n]*embodied", f.read_text()), f"{f} must not import the embodied layer"


def test_results_have_no_scalar_total_if_present():
    p = ROOT / "results" / "xeno14" / "x14-1" / "summary.json"
    if not p.exists(): return
    txt = p.read_text()
    for bad in ['"total_loss"', '"overall"', '"winner"', '"bestFramework"']:
        assert bad not in txt
