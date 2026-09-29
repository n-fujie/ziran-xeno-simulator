# Xeno-Body + Active Inference — Milestone 1 architecture

Branch `research/xeno-body-active-inference` (from `research/xeno14-integration`). v0.3.0 is unchanged
(`git diff v0.3.0 -- src public bin` empty). Only Milestone 1 is implemented; self-revision (Layers 3–5) is not.

## 1. Existing codebase (inspected before any change)

| component | where | what it is |
|---|---|---|
| body / physics | `embodied/xeno14/env.py` → gymnasium `Walker2d-v5` (MuJoCo 3.14) | planar biped: torso + two legs (thigh, leg, foot) |
| sensors | Walker2d observation (17): torso height, pitch, 6 joint angles, root velocities, pitch rate, 6 joint velocities | proprioceptive; no force, contact or IMU channel in the observation; MuJoCo contact data exist in the simulator |
| actuators | 6 joint torque motors, commands in [−1, 1] | via `env.step(action)` |
| fast control loop | `env.step` every 8 ms (4 physics steps of 2 ms); controller `act(obs)` once per step | Layer 0 |
| balance / stabilization logic | `embodied/xeno14/modules.py` `Xeno14Controller` (three gated organization modules, ES-trained) | no hand-coded stabilizer exists |
| episode API | `env.run_episode` | kept unchanged; the new experiment has its own runner |
| other body model | `src/domains/body.ts` | abstract 5-segment rule model without physics or actuators; not extended |

Found gaps: no saved controller checkpoints (controllers were retrained per experiment) — Milestone 1 trains the
existing controller with the existing code once per seed and saves it under `results/xeno-body-ai/m1/controllers/`.
Walker2d is planar, so a **lateral impulse cannot be instantiated**; it is recorded as such.

## 2. Architecture added

```
Sensors (17-dim obs, + optional sensor noise)
  → Observation Adapter (Layer 1, every 8 ms): derived variables + discrete observation index
  → Latent-state inference (posterior over body-state regions, VFE)            ┐ Layer 2, every 25 steps (200 ms)
  → Active Inference policy layer (EFE per candidate body configuration)        ┘
  → Selected body configuration (target pitch offset, output gain)
  → Existing fast controller Xeno14Controller (Layer 0, every 8 ms, unchanged)
  → Actuators
```

The configuration is applied around the existing controller (`benchmarks/fixed_controller.py`): the controller sees
the pitch relative to the target offset and its torques are scaled by the gain; with offset 0 and gain 1 it is
bit-identical to the existing controller (tested). Layer 0 never waits for Layer 2.

## 3. Mathematical definition

- **States** s ∈ {pitch region (7) × pitch-rate region (3)} ∪ {fallen} (22). **Observations** o use the same
  partition of the sensed pitch and pitch rate, plus the absorbing *fallen* outcome (episode termination).
- **A** (likelihood, A[o, s]): mass 0.85 on o = s, the rest on neighbouring pitch regions with the same rate region.
- **B** (transitions, B[π][s′, s]): one per policy over one decision interval (25 steps), Dirichlet counts
  (prior 0.1) from calibration transitions; *fallen* absorbing.
- **C** (preferences): ln P̃(o) by distance of the pitch region from the centre (0, −1, −4, −16) and −32 for
  *fallen*, normalized.
- **D** uniform; **E** (policy prior) uniform.
- **Inference:** q(s) ∝ A[o, :] · (B[π_prev] q_prev) at each decision (D at t = 0).
  **Variational free energy** F = E_q[ln q(s) − ln A[o, s] − ln prior(s)] is logged per decision; it is not used for
  policy selection.
- **Expected free energy** per policy over one interval:
  G(π) = −E_{Q(o|π)}[ln P̃(o)] − (H[Q(o|π)] − E_{Q(s|π)} H[A[:, s]]), i.e. −(pragmatic) − (epistemic), with the
  two components logged separately.
- **Selection:** P(π) = softmax(ln E − γ G), γ = 16; the executed policy is the argmax (deterministic).
- **Policies** (candidate body configurations): target pitch offset ∈ {−0.1, 0, +0.1} rad × gain ∈ {0.8, 1.0, 1.2}.

## 4. Approximations (all explicit)

1. Latent states share the observation partition; A is a fixed noisy identity (precision assumed, not learned).
2. B is learned by treating the observed region at decision times as the latent state (no latent-state learning).
3. One-interval planning horizon (no multi-step policy trees).
4. Discrete coarse partition of two variables; other state variables (height, joint angles, contacts) enter only
   through the existing controller.
5. Calibration (60 episodes per seed with random policies and pushes) is data that Mode A does not receive; it is
   recorded as Mode B's data burden.
6. Deterministic argmax selection instead of sampling.
7. Configuration applied by reference shift and torque scaling around the existing controller; the controller was not
   trained for non-neutral configurations.

## 5. Observability (recorded per experiment)

sagittal pitch and pitch rate: measured · torso height: measured · foot contact: simulator data, not in the
observation · lateral tilt / impulse: sensor incapable, not representable (planar) · push force and friction: not
measured · sensor-noise condition: noisy measurement (known to the evaluator only).

## 6. Operational-shape mapping (log fields, no new symbolic objects)

Per decision pair: current configuration = chosen policy; ignition condition = decision interval reached with the
inferred state; active transition = policy applied for 25 steps; retained difference = axis deviation at the next
decision; transformed difference = its change; interrupted transition = fall before the next decision; return signal =
the next observation; reconfigured next condition = the next chosen policy.

## 7. Not in Milestone 1

Model-failure detection, parameter learning (Layer 3), structure learning (Layer 4), observation-system revision
(Layer 5), Mode C, Experiments 2–5.
