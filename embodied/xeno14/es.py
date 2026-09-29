"""Antithetic evolution strategies (OpenAI-ES style, rank-centred fitness, Adam). Used identically for every
controller so that optimization is not a confound; the environment-step budget is counted per run."""
from __future__ import annotations
import numpy as np
import torch
from torch.nn.utils import parameters_to_vector, vector_to_parameters


def es_optimize(params, fitness, iters: int, rng: np.random.Generator, pairs: int = 8, sigma: float = 0.05, lr: float = 0.03):
    """params: list of torch Parameters to optimize (others stay fixed).
    fitness(seed, push) -> (f, steps). Returns a log with the mean fitness per iteration and total steps."""
    theta = parameters_to_vector(params).detach().clone()
    m = torch.zeros_like(theta); v = torch.zeros_like(theta); steps = 0; curve = []
    for it in range(1, iters + 1):
        eps = torch.as_tensor(rng.standard_normal((pairs, theta.numel())), dtype=torch.float32)
        seeds = rng.integers(0, 2**31 - 1, size=pairs); pushes = rng.choice([0.0, 1.0, -1.0], size=pairs)
        f = np.zeros(2 * pairs)
        for k in range(pairs):
            for s, sign in enumerate((1.0, -1.0)):
                vector_to_parameters(theta + sign * sigma * eps[k], params)
                fk, st = fitness(int(seeds[k]), float(pushes[k])); f[2 * k + s] = fk; steps += st
        ranks = np.empty(2 * pairs); ranks[np.argsort(f)] = np.arange(2 * pairs); ranks = ranks / (2 * pairs - 1) - 0.5
        g = sum((ranks[2 * k] - ranks[2 * k + 1]) * eps[k] for k in range(pairs)) / (2 * pairs * sigma)
        m = 0.9 * m + 0.1 * g; v = 0.999 * v + 0.001 * g * g
        theta = theta + lr * (m / (1 - 0.9**it)) / (torch.sqrt(v / (1 - 0.999**it)) + 1e-8)
        curve.append(float(f.mean()))
    vector_to_parameters(theta, params)
    return {"curve": curve, "steps": steps}
