"""Expected free energy for one-step (one decision interval) policies, with the preference-related (pragmatic) and
epistemic components kept separate:
    G(π) = −E_{Q(o|π)}[ln P̃(o)]  −  E_{Q(o|π)}[ KL(Q(s|o,π) ‖ Q(s|π)) ]
            └── pragmatic term ──┘   └──────── epistemic (information gain) ─┘
The second term equals the mutual information between predicted states and outcomes. Horizon: one decision
interval (documented approximation)."""
from __future__ import annotations
import numpy as np

EPS = 1e-16


def entropy(p): return float(-np.sum(p * np.log(p + EPS)))


def efe(A: np.ndarray, B_pi: np.ndarray, q: np.ndarray, logC: np.ndarray) -> dict:
    qs = B_pi @ q                         # predicted state distribution
    qo = A @ qs                           # predicted observation distribution
    pragmatic = float(np.sum(qo * logC))  # expected log preference (higher = better)
    ambiguity = float(np.sum(qs * np.array([entropy(A[:, s]) for s in range(A.shape[1])])))
    epistemic = entropy(qo) - ambiguity   # mutual information I(s; o | π)
    return {"G": -pragmatic - epistemic, "pragmatic": pragmatic, "epistemic": epistemic, "risk_proxy": -pragmatic, "ambiguity": ambiguity, "predicted_obs": qo}
