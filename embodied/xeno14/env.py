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


# Embodiment specifications: observation layout (gymnasium v5 = qpos[1:] + qvel) and torso body index.
EMBODIMENTS = {
    "walker2d": {"id": "Walker2d-v5", "obs": 17, "act": 6, "z": 0, "pitch": 1, "joint_angles": list(range(2, 8)), "pitch_rate": 10, "joint_vels": list(range(11, 17)), "vel_start": 8, "torso": 1, "morphology": "planar biped, 6 actuated joints"},
    "hopper": {"id": "Hopper-v5", "obs": 11, "act": 3, "z": 0, "pitch": 1, "joint_angles": list(range(2, 5)), "pitch_rate": 7, "joint_vels": list(range(8, 11)), "vel_start": 5, "torso": 1, "morphology": "planar monopod, 3 actuated joints"},
}


def make_env(embodiment: str = "walker2d"):
    # forward_reward_weight=0: the task is standing, not walking; healthy termination kept (falls end the episode)
    return gym.make(EMBODIMENTS[embodiment]["id"], forward_reward_weight=0.0, reset_noise_scale=5e-3)


def run_episode(env, policy, seed: int, push: float = 0.0, record: bool = False):
    """Runs one episode. push = horizontal force (N) on the torso for PUSH_STEPS steps from PUSH_T (0 = none).
    Returns per-organization measurements; the controller never sees the push schedule."""
    obs, _ = env.reset(seed=seed)
    data = env.unwrapped.data
    torso = getattr(policy, "emb", {}).get("torso", TORSO) if hasattr(policy, "emb") else TORSO
    policy.reset()
    z0 = float(data.qpos[1])
    prev_a = np.zeros(env.action_space.shape)
    pitch2, height2, jerk, survived = [], [], [], 0
    recovered_at = None
    trace = [] if record else None
    for t in range(T):
        a = np.clip(policy.act(obs), -1.0, 1.0)
        data.xfrc_applied[torso, 0] = push if (push and PUSH_T <= t < PUSH_T + PUSH_STEPS) else 0.0
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
    data.xfrc_applied[torso, 0] = 0.0
    return {
        "survival": survived / T,
        "axis": float(np.mean(pitch2)) if pitch2 else float("nan"),
        "lower_center": float(np.mean(height2)) if height2 else float("nan"),
        "low_noise": float(np.mean(jerk)) if jerk else float("nan"),
        "recovery_steps": recovered_at if push else None,
        "steps": survived,
        "trace": trace,
    }
