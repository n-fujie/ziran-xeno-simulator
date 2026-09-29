"""Mode A: the existing Xeno-Body fast controller (Xeno14Controller), unchanged. Also the configuration interface the
Active Inference layer uses: a high-level body configuration (target pitch offset, output gain) is applied *around*
the existing controller — the controller sees the pitch relative to the target and its torques are scaled — without
changing its parameters or code. With offset 0 and gain 1 the wrapper reproduces the existing controller exactly."""
from __future__ import annotations
import numpy as np
from xeno14.modules import Policy


class ConfiguredController(Policy):
    def __init__(self, base, pitch_offset: float = 0.0, gain: float = 1.0):
        super().__init__(); self.base, self.pitch_offset, self.gain = base, pitch_offset, gain

    def set(self, pitch_offset: float, gain: float): self.pitch_offset, self.gain = pitch_offset, gain
    def reset(self): self.base.reset()
    def last_info(self): return self.base.last_info()

    def act(self, obs):
        if self.pitch_offset == 0.0 and self.gain == 1.0: return self.base.act(obs)
        o = np.array(obs, dtype=float); o[1] -= self.pitch_offset
        return self.gain * self.base.act(o)
