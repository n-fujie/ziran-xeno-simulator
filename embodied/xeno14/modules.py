"""PyTorch controllers: Xeno-14 organization modules and matched baselines.

Walker2d-v5 observation layout (17): 0 torso height z, 1 torso pitch, 2–7 joint angles, 8 vx, 9 vz,
10 pitch rate, 11–16 joint velocities. Every controller receives this vector (the proprioceptive baseline receives a
documented subset); no controller receives push timing, push force or any Xeno-only signal.
"""
from __future__ import annotations
import numpy as np
import torch
import torch.nn as nn

OBS, ACT = 17, 6
SCALE = torch.tensor([1.0] * 8 + [0.1] * 9)          # shared fixed encoding: velocities scaled by 0.1 (not learned)
PROPRIO_IDX = list(range(2, 8)) + list(range(11, 17))  # joint angles + joint velocities only


def encode(obs: np.ndarray) -> torch.Tensor:
    return torch.as_tensor(obs, dtype=torch.float32) * SCALE


class Policy(nn.Module):
    """Common interface: reset(), act(obs) -> np.ndarray, last_info() -> dict."""
    def reset(self): pass
    def last_info(self) -> dict: return {}
    def act(self, obs) -> np.ndarray: raise NotImplementedError


class History:
    """Body-state history: the last H encoded observations (zeros before the episode start)."""
    def __init__(self, H: int): self.H = H; self.buf: list[torch.Tensor] = []
    def reset(self): self.buf = []
    def push(self, x: torch.Tensor) -> torch.Tensor:
        if self.H == 0: return x
        self.buf = (self.buf + [x])[-(self.H + 1):]
        pad = [torch.zeros_like(x)] * (self.H + 1 - len(self.buf))
        return torch.cat(pad + self.buf)


# gate features per organization: morphology-dependent ignition (which sensed quantities can ignite the module)
GATE_FEATURES = {
    "axis-maintenance": lambda x: torch.stack([x[1].abs(), x[10].abs()]),
    "lower-abdominal-continuity": lambda x: torch.stack([x[0], x[2:8].abs().mean()]),
    "low-noise-movement": lambda x: torch.stack([x[11:17].abs().mean(), x[10].abs()]),
}


class OrganizationModule(nn.Module):
    """One operational organization: an ignition gate over its own sensed features and an action proposal."""
    def __init__(self, name: str, n_in: int, hidden: int = 8, gated: bool = True, extra_gate_inputs: int = 0):
        super().__init__()
        self.name, self.gated = name, gated
        self.gate = nn.Linear(2 + extra_gate_inputs, 1)
        self.body = nn.Sequential(nn.Linear(n_in, hidden), nn.Tanh(), nn.Linear(hidden, ACT))
        nn.init.zeros_(self.body[2].weight); nn.init.zeros_(self.body[2].bias)
        nn.init.zeros_(self.gate.weight); nn.init.constant_(self.gate.bias, 0.0)
        self.extra = extra_gate_inputs

    def forward(self, x_hist: torch.Tensor, x_now: torch.Tensor, gate_extra: torch.Tensor | None = None):
        gf = GATE_FEATURES[self.name](x_now)
        if self.extra: gf = torch.cat([gf, gate_extra])
        g = torch.sigmoid(self.gate(gf)).squeeze() if self.gated else torch.tensor(1.0)
        return g, self.body(x_hist)


class Xeno14Controller(Policy):
    """Additive composition of gated organization modules; each module's contribution and pairwise conflicts are
    logged per step (conflict is preserved as a record, not averaged into a score)."""
    def __init__(self, names: list[str], H: int = 3, gated: bool = True, shared_gates: dict[str, str] | None = None, accel_gate_inputs: bool = False):
        super().__init__()
        self.names, self.H, self.gated = list(names), H, gated
        self.hist = History(H)
        n_in = OBS * (H + 1) if H else OBS
        self.accel = accel_gate_inputs
        self.mods = nn.ModuleDict({n: OrganizationModule(n, n_in, gated=gated, extra_gate_inputs=2 if accel_gate_inputs else 0) for n in names})
        self.shared_gates = shared_gates or {}   # name -> name whose gate it uses (architecture repartition)
        self.prev_x: torch.Tensor | None = None
        self._info: dict = {}
        self.disabled: set[str] = set()

    def reset(self): self.hist.reset(); self.prev_x = None

    @torch.no_grad()
    def act(self, obs):
        x = encode(obs); xh = self.hist.push(x)
        extra = None
        if self.accel:
            dx = (x - self.prev_x) if self.prev_x is not None else torch.zeros_like(x)
            extra = torch.stack([dx[10].abs(), dx[11:17].abs().mean()])
        self.prev_x = x
        gates, contrib = {}, {}
        for n, m in self.mods.items():
            if n in self.disabled: continue
            g, p = m(xh, x, extra); gates[n] = float(g); contrib[n] = p
        for n, src in self.shared_gates.items():
            if n in gates and src in gates: gates[n] = gates[src]
        a = sum((torch.tensor(gates[n]) * contrib[n] for n in contrib), torch.zeros(ACT))
        conf = {}
        ks = list(contrib)
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                u, v = gates[ks[i]] * contrib[ks[i]], gates[ks[j]] * contrib[ks[j]]
                nu, nv = float(u.norm()), float(v.norm())
                conf[f"{ks[i]}|{ks[j]}"] = float(torch.dot(u, v) / (nu * nv)) if nu > 1e-6 and nv > 1e-6 else 0.0
        self._info = {"gates": gates, "conflict_cos": conf, "contribution_norm": {n: float((gates[n] * contrib[n]).norm()) for n in contrib}}
        return a.numpy()

    def last_info(self): return self._info

    def module_params(self, name: str) -> list[nn.Parameter]: return list(self.mods[name].parameters())


class MLPPolicy(Policy):
    """Standard policy network (obs → 32 tanh → 6); proprioceptive variant uses PROPRIO_IDX only."""
    def __init__(self, proprio_only: bool = False, hidden: int = 32):
        super().__init__()
        self.idx = PROPRIO_IDX if proprio_only else list(range(OBS))
        self.net = nn.Sequential(nn.Linear(len(self.idx), hidden), nn.Tanh(), nn.Linear(hidden, ACT))
        nn.init.zeros_(self.net[2].weight); nn.init.zeros_(self.net[2].bias)

    @torch.no_grad()
    def act(self, obs): return self.net(encode(obs)[self.idx]).numpy()


class GRUPolicy(Policy):
    """Recurrent body-memory policy (GRU 16 → 6)."""
    def __init__(self, hidden: int = 16):
        super().__init__()
        self.cell = nn.GRUCell(OBS, hidden); self.out = nn.Linear(hidden, ACT); self.h = torch.zeros(hidden)
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)

    def reset(self): self.h = torch.zeros_like(self.h)

    @torch.no_grad()
    def act(self, obs):
        self.h = self.cell(encode(obs).unsqueeze(0), self.h.unsqueeze(0)).squeeze(0)
        return self.out(self.h).numpy()


def n_params(params) -> int: return int(sum(p.numel() for p in params))
