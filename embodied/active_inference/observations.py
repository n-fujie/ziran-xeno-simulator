"""Observation adapter (Layer 1). Maps the existing 17-dim Walker2d observation (plus MuJoCo contact data) to
derived body-state variables and a discrete observation index for the generative model. Nothing here changes what the
existing controller receives."""
from __future__ import annotations
import numpy as np

# observability status of each difference the experiment cares about (static for this embodiment)
OBSERVABILITY = {
    "sagittal pitch": "measured (obs[1])",
    "pitch rate": "measured (obs[10])",
    "torso height": "measured (obs[0])",
    "foot contact": "derived from MuJoCo contact list (simulator data, not in the 17-dim observation)",
    "lateral tilt / lateral impulse": "sensor incapable / not representable: Walker2d is planar",
    "push force": "not measured (no force sensor is given to any controller)",
    "floor friction": "not measured",
}


class ObservationAdapter:
    def __init__(self, pitch_edges, rate_edges):
        self.pe, self.re = np.asarray(pitch_edges), np.asarray(rate_edges)
        self.n_pitch, self.n_rate = len(pitch_edges) + 1, len(rate_edges) + 1
        self.n_obs = self.n_pitch * self.n_rate + 1          # + absorbing 'fallen'
        self.FALLEN = self.n_obs - 1

    def derived(self, obs: np.ndarray, data=None) -> dict:
        d = {"pitch": float(obs[1]), "pitch_rate": float(obs[10]), "height": float(obs[0]), "axis_deviation": abs(float(obs[1]))}
        if data is not None:
            feet = {"foot", "foot_left"}; m = data.model if hasattr(data, "model") else None
            d["contacts"] = int(data.ncon)
        return d

    def index(self, obs: np.ndarray | None, fallen: bool = False) -> int:
        if fallen or obs is None: return self.FALLEN
        p = int(np.searchsorted(self.pe, obs[1])); r = int(np.searchsorted(self.re, obs[10]))
        return p * self.n_rate + r

    def pitch_bin(self, o: int) -> int | None:
        return None if o == self.FALLEN else o // self.n_rate
