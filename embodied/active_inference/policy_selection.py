"""Policy selection: softmax(ln E − γ G). Deterministic choice = argmax of the policy posterior (ties → first)."""
from __future__ import annotations
import numpy as np
from .expected_free_energy import efe


def select(model, q: np.ndarray, gamma: float) -> dict:
    scores = [efe(model.A, model.B[p], q, model.C) for p in range(model.nP)]
    G = np.array([s["G"] for s in scores]); logits = np.log(model.E) - gamma * G
    pp = np.exp(logits - logits.max()); pp /= pp.sum()
    return {"chosen": int(np.argmax(pp)), "policy_posterior": pp, "scores": scores}
