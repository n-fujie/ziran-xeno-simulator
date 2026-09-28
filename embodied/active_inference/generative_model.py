"""Minimal discrete generative model: A (likelihood), B (policy-conditioned transitions), C (preferences),
D (initial prior), E (policy prior). Latent states are coarse body-state regions with the same partition as the
observation index (pitch region × pitch-rate region, plus 'fallen'); A is a noisy identity with an explicit
precision parameter (an assumption, not learned); B is learned from calibration transitions by Dirichlet counts,
approximating the latent state by the observed region at decision times (documented approximation)."""
from __future__ import annotations
import numpy as np


class GenerativeModel:
    def __init__(self, n_states: int, n_policies: int, n_rate: int, fallen: int, likelihood_precision: float, dirichlet_prior: float, prefs: dict):
        self.nS, self.nP, self.nR, self.FALLEN = n_states, n_policies, n_rate, fallen
        self.A = self._likelihood(likelihood_precision)
        self.b_counts = np.full((n_policies, n_states, n_states), dirichlet_prior)   # [π, s', s]
        self.b_counts[:, fallen, fallen] += 1e3                                         # fallen is absorbing
        self.D = np.full(n_states, 1.0 / n_states)
        self.E = np.full(n_policies, 1.0 / n_policies)
        self.C = self._preferences(prefs)

    def _likelihood(self, prec: float) -> np.ndarray:
        """A[o, s]: mass prec on o = s, the rest spread over neighbouring pitch regions with the same rate region."""
        A = np.zeros((self.nS, self.nS))
        for s in range(self.nS):
            if s == self.FALLEN: A[s, s] = 1.0; continue
            nb = [o for o in (s - self.nR, s + self.nR) if 0 <= o < self.FALLEN]
            A[s, s] = prec
            for o in nb: A[o, s] += (1 - prec) / len(nb)
        return A / A.sum(axis=0, keepdims=True)

    def _preferences(self, p: dict) -> np.ndarray:
        """C: log-preferences over observations by pitch region (outer regions → centre)."""
        n_pitch = (self.nS - 1) // self.nR; mid = n_pitch // 2
        lvl = [p["extreme"], p["strong"], p["mild"], p["neutral"]]
        logc = np.zeros(self.nS)
        for o in range(self.FALLEN): logc[o] = lvl[max(0, 3 - abs(o // self.nR - mid))]
        logc[self.FALLEN] = p["fallen"]
        return logc - np.log(np.exp(logc).sum())                                        # normalized ln P̃(o)

    @property
    def B(self) -> np.ndarray:
        return self.b_counts / self.b_counts.sum(axis=1, keepdims=True)

    def learn_transition(self, pi: int, s: int, s_next: int, w: float = 1.0):
        self.b_counts[pi, s_next, s] += w
