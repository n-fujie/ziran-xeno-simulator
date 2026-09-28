"""Recovery and stability measures (defined once, used for every mode)."""
from __future__ import annotations


def recovery_latency(pitch: list[float], start: int, thr: float, hold: int) -> int | None:
    """Steps after `start` until |pitch| < thr for `hold` consecutive steps (None = never within the episode)."""
    c = 0
    for t in range(start, len(pitch)):
        c = c + 1 if abs(pitch[t]) < thr else 0
        if c >= hold: return t - hold + 1 - start
    return None
