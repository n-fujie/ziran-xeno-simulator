"""Unit tests for the Active Inference layer (math) and integration tests (backward compatibility, logging)."""
import sys
from pathlib import Path
import numpy as np
import torch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from active_inference.observations import ObservationAdapter
from active_inference.generative_model import GenerativeModel
from active_inference.state_inference import posterior, vfe
from active_inference.expected_free_energy import efe, entropy
from active_inference.policy_selection import select
from benchmarks.fixed_controller import ConfiguredController
from xeno14.modules import Xeno14Controller
from xeno14 import experiment as X

PREFS = {"neutral": 0.0, "mild": -1.0, "strong": -4.0, "extreme": -16.0, "fallen": -32.0}


def model():
    ad = ObservationAdapter([-0.4, -0.15, -0.05, 0.05, 0.15, 0.4], [-1.0, 1.0])
    return ad, GenerativeModel(ad.n_obs, 9, ad.n_rate, ad.FALLEN, 0.85, 0.1, PREFS)


def test_matrices_are_normalized():
    ad, m = model()
    assert np.allclose(m.A.sum(axis=0), 1) and np.allclose(m.B.sum(axis=1), 1) and np.isclose(np.exp(m.C).sum(), 1) and np.isclose(m.D.sum(), 1)
    assert m.B[0, ad.FALLEN, ad.FALLEN] > 0.99, "fallen is absorbing"


def test_posterior_and_vfe():
    ad, m = model(); o = ad.index(np.array([1.0, 0.0] + [0] * 15))
    q = posterior(m.A, m.D, o); assert np.isclose(q.sum(), 1) and q.argmax() == o
    F_exact = vfe(m.A, m.D, q, o); logp = np.log((m.A[o, :] * m.D).sum())
    assert np.isclose(F_exact, -logp, atol=1e-6), "VFE equals surprise at the exact posterior"
    assert vfe(m.A, m.D, m.D, o) >= F_exact - 1e-9


def test_efe_decomposition():
    ad, m = model(); q = m.D; r = efe(m.A, m.B[0], q, m.C)
    assert np.isclose(r["G"], -r["pragmatic"] - r["epistemic"])
    qo = r["predicted_obs"]; assert np.isclose(r["epistemic"], entropy(qo) - r["ambiguity"]) and r["epistemic"] >= -1e-9


def test_policy_selection_prefers_preferred_outcomes():
    ad, m = model(); neutral = ad.index(np.array([1.0, 0.0] + [0] * 15)); bad = ad.index(np.array([1.0, 0.35] + [0] * 15))
    m.b_counts[:] = 0.1; m.b_counts[:, ad.FALLEN, ad.FALLEN] = 1e3
    m.b_counts[3, neutral, :] += 50; m.b_counts[5, bad, :] += 50
    q = np.eye(ad.n_obs)[neutral]; s = select(m, q, 16.0); assert s["chosen"] == 3


def test_neutral_configuration_reproduces_existing_controller():
    torch.manual_seed(0); base = Xeno14Controller(X.ORGS)
    for mm in base.mods.values(): torch.nn.init.normal_(mm.body[2].weight, std=0.3)
    import copy; ref = copy.deepcopy(base); w = ConfiguredController(base)
    rng = np.random.default_rng(0)
    for _ in range(5):
        o = rng.standard_normal(17); assert np.allclose(w.act(o), ref.act(o)), "Mode A / neutral config must equal the existing controller"


def test_episode_logs_required_fields():
    from experiments import balance_recovery as BR
    from xeno14.env import make_env
    env = make_env(); ad, m = model(); base = Xeno14Controller(X.ORGS); c = ConfiguredController(base)
    r = BR.episode(env, c, ad, m, 1, 140.0, 0.05, "B", log=True)
    d = r["log"]["decisions"][0]
    for k in ["t", "obs_index", "derived", "q", "vfe", "policy_scores", "policy_posterior", "chosen"]: assert k in d
    assert {"pragmatic", "epistemic", "G"} <= set(d["policy_scores"][0])
    assert {"observation_adaptation", "latent_state_inference", "vfe", "efe_preference", "efe_epistemic", "efe_total", "policy_selection", "aif_decision_total", "controller_step_total", "layer0_fast_control"} <= set(r["latency_ns"])
    assert "prediction_error" in r and "episode_return" in r and "policy_counts" in r
    assert {"raw_obs", "sensed_obs", "motor_target", "config"} <= set(r["log"]["steps"][0])


def test_vfe_and_efe_are_separate_quantities():
    """VFE scores the current belief against the current observation; EFE scores predicted outcomes under a policy
    against preferences. VFE must not depend on C; EFE must not depend on the current observation given the belief."""
    ad, m = model(); o1, o2 = 3, 10
    q = posterior(m.A, m.D, o1)
    F1 = vfe(m.A, m.D, q, o1)
    m2 = GenerativeModel(ad.n_obs, 9, ad.n_rate, ad.FALLEN, 0.85, 0.1, {**PREFS, "extreme": -100.0, "fallen": -500.0})
    assert np.isclose(vfe(m2.A, m2.D, q, o1), F1), "VFE must not depend on preferences C"
    assert not np.isclose(efe(m.A, m.B[0], q, m.C)["G"], efe(m2.A, m2.B[0], q, m2.C)["G"]), "EFE depends on C"
    g1 = efe(m.A, m.B[0], q, m.C)["G"]
    assert np.isclose(vfe(m.A, m.D, q, o2), vfe(m.A, m.D, q, o2)) and not np.isclose(vfe(m.A, m.D, q, o2), F1), "VFE depends on the observation"
    assert np.isclose(efe(m.A, m.B[0], q, m.C)["G"], g1), "EFE is a function of (A, B, q, C) only, not of the current observation"
    assert not np.isclose(F1, g1), "the two quantities are different numbers in general"
    import inspect
    from active_inference import expected_free_energy as EF, state_inference as SI
    assert "vfe" not in inspect.getsource(EF) and "efe" not in inspect.getsource(SI).replace("vfe", ""), "no cross-use between the modules"


def test_active_inference_disabled_reproduces_existing_simulator():
    """Mode A through the new runner reproduces the existing run_episode trajectory exactly (same controller, push, seed)."""
    from experiments import balance_recovery as BR
    from xeno14.env import make_env, run_episode
    import copy
    torch.manual_seed(1); base = Xeno14Controller(X.ORGS)
    for mm in base.mods.values(): torch.nn.init.normal_(mm.body[2].weight, std=0.3)
    env = make_env(); ad, m = model()
    ref = run_episode(env, copy.deepcopy(base), seed=5, push=140.0, record=True)
    new = BR.episode(env, ConfiguredController(copy.deepcopy(base)), ad, None, 5, 140.0, 0.0, "A", log=True)
    assert new["steps"] == ref["steps"]
    assert np.allclose(new["pitch_trace"], [round(r["pitch"], 5) for r in ref["trace"]])
