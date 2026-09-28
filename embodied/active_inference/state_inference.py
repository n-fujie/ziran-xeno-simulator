"""Latent-state inference and variational free energy (VFE). VFE scores the current belief against the current
observation; it is computed and logged separately from the expected free energy used for policy selection."""
from __future__ import annotations
import numpy as np

EPS = 1e-16


def posterior(A: np.ndarray, prior: np.ndarray, o: int) -> np.ndarray:
    q = A[o, :] * prior; s = q.sum()
    return q / s if s > 0 else np.full_like(prior, 1.0 / len(prior))


def vfe(A: np.ndarray, prior: np.ndarray, q: np.ndarray, o: int) -> float:
    """F = E_q[ln q(s) − ln p(o|s) − ln p(s)] (≥ −ln p(o); equality at the exact posterior)."""
    return float(np.sum(q * (np.log(q + EPS) - np.log(A[o, :] + EPS) - np.log(prior + EPS))))
