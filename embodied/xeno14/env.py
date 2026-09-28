"""Walker2d standing task with a controlled push, and per-organization measurements.

Embodiment: gymnasium Walker2d-v5 (MuJoCo 3.14), a planar biped. Task: stay upright in place for T steps.
Every controller receives the same observation vector (Walker2d's 17-dim proprioceptive observation), the same
action space, the same push schedule and the same step budget. No controller receives push timing or force.
"""
import numpy as np
import gymnasium as gym

T = 250            # control steps per episode (2.0 s simulated)
PUSH_T = 100       # push starts here in perturbed episodes
PUSH_STEPS = 5
TORSO = 1          # body index of the torso in Walker2d


def make_env():
    # forward_reward_weight=0: the task is standing, not walking; healthy termination kept (falls end the episode)
    return gym.make("Walker2d-v5", forward_reward_weight=0.0, reset_noise_scale=5e-3)


def run_episode(env, policy, seed: int, push: float = 0.0, record: bool = False):
    """Runs one episode. push = horizontal force (N) on the torso for PUSH_STEPS steps from PUSH_T (0 = none).
    Returns per-organization measurements; the controller never sees the push schedule."""
    obs, _ = env.reset(seed=seed)
    data = env.unwrapped.data
    policy.reset()
    z0 = float(data.qpos[1])
    prev_a = np.zeros(env.action_space.shape)
    pitch2, height2, jerk, survived = [], [], [], 0
    recovered_at = None
    trace = [] if record else None
    for t in range(T):
        a = np.clip(policy.act(obs), -1.0, 1.0)
        data.xfrc_applied[TORSO, 0] = push if (push and PUSH_T <= t < PUSH_T + PUSH_STEPS) else 0.0
        obs, _r, term, trunc, _ = env.step(a)
        survived += 1
        pitch, z = float(data.qpos[2]), float(data.qpos[1])
        pitch2.append(pitch * pitch); height2.append((z - z0) ** 2); jerk.append(float(np.sum((a - prev_a) ** 2)))
        if push and t >= PUSH_T + PUSH_STEPS and recovered_at is None and abs(pitch) < 0.1:
            recovered_at = t - (PUSH_T + PUSH_STEPS)
        if record:
            trace.append({"t": t, "pitch": pitch, "z": z, "a": a.tolist(), **policy.last_info()})
        prev_a = a
        if term or trunc:
            break
    data.xfrc_applied[TORSO, 0] = 0.0
    return {
        "survival": survived / T,
        "axis": float(np.mean(pitch2)) if pitch2 else float("nan"),
        "lower_center": float(np.mean(height2)) if height2 else float("nan"),
        "low_noise": float(np.mean(jerk)) if jerk else float("nan"),
        "recovery_steps": recovered_at if push else None,
        "steps": survived,
        "trace": trace,
    }
