"""Policy selection: softmax(ln E − γ G). Deterministic choice = argmax of the policy posterior (ties → first)."""
from __future__ import annotations
import numpy as np
from .expected_free_energy import efe


def select(model, q: np.ndarray, gamma: float, timer=None) -> dict:
    """`timer` (optional dict of ns totals) records EFE parts and the selection step separately; values unaffected."""
    import time
    t0 = time.perf_counter_ns()
    scores = [efe(model.A, model.B[p], q, model.C, timer) for p in range(model.nP)]
    t1 = time.perf_counter_ns()
    G = np.array([s["G"] for s in scores]); logits = np.log(model.E) - gamma * G
    pp = np.exp(logits - logits.max()); pp /= pp.sum(); chosen = int(np.argmax(pp))
    t2 = time.perf_counter_ns()
    if timer is not None: timer["efe_total"] += t1 - t0; timer["policy_selection"] += t2 - t1
    return {"chosen": chosen, "policy_posterior": pp, "scores": scores}
