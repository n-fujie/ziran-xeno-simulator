"""Per-layer computation latency (wall clock, perf_counter_ns)."""
from __future__ import annotations
import time
from collections import defaultdict


class LayerTimer:
    def __init__(self): self.ns = defaultdict(list)
    def time(self, layer: str):
        t0 = time.perf_counter_ns(); timer = self
        class _C:
            def __enter__(self_): return self_
            def __exit__(self_, *a): timer.ns[layer].append(time.perf_counter_ns() - t0)
        return _C()
    def summary(self) -> dict:
        out = {}
        for k, v in self.ns.items():
            v = sorted(v); out[k] = {"calls": len(v), "mean_ms": sum(v) / len(v) / 1e6, "p95_ms": v[int(0.95 * (len(v) - 1))] / 1e6, "max_ms": v[-1] / 1e6}
        return out
