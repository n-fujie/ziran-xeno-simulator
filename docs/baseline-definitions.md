# Baseline definitions

Each baseline is a standard formulation, implemented minimally in `comparison/frameworks/lib.ts` and the world
files. "Minimal" means small, not weakened: where a first formulation omits a standard capability, a fairness
configuration adds it. Known weaknesses of *these implementations* are listed so they are not mistaken for
limitations of the frameworks.

## Agent-based modelling

- **Formulation.** Agents with local rules and internal state; an environment; an interaction network (shared
  reservoir in W3, account ownership in W5); a synchronous update schedule; analysis by scenario comparison.
- **Configurations.** W3: agents A, B, C with rules identified from pilot logs; + intervention sweep (fairness).
  W5: accounts as agents owning streams; + structure selected by fit between per-agent budgets and an
  environment-level budget (fairness).
- **Applicability.** Not applied in W1, W2, W4 (single plant or prediction task without a population); the reason is
  recorded per world.
- **Implementation weaknesses.** Deterministic forecasts (no ensemble); rules identified by simple threshold fitting.

## Control theory / MPC

- **Formulation.** State, control, observation, objective, constraints, model dynamics, feedback.
- **Configurations.** W1: nominal MPC (horizon 4, enumeration over u ∈ {−1, 0, 1}⁴) with the supplied model;
  adaptive MPC with a recursive-least-squares gain estimate (forgetting 0.85). W2: synchronous P control;
  delay-compensated control in the style of the Smith predictor (O. J. M. Smith, 1957); asynchronous MPC with delays
  and an environment-switching model learned online (renewal process, uniform interval support). W3: local MPC for A
  (horizon 20, other units lumped into a disturbance, R ≥ 5); centralized MPC with the full identified model,
  full horizon and a C-shortfall constraint, including a feasibility analysis over switch times.
- **Controllability / observability.** In W1 the effective gain is identifiable only when u ≠ 0 (persistent
  excitation); the adaptive controller therefore depends on its own actions for identification.
- **Implementation weaknesses.** No explicit measurement model in W3 (state assumed available), so loss of a meter is
  not represented; a standard estimator-based MPC would represent it (recorded as an untested fairness note).

## Reinforcement learning

- **Formulation.** Tabular Q-learning (Watkins, 1989) with ε-greedy exploration; state representation, action set,
  reward, policy, training data, objective and update mechanism are recorded per configuration. Reward, goal and
  value are kept distinct: the reward is a supplied scalar signal, the goal (W2) is an input to the policy, the value
  is the learned Q-estimate.
- **Configurations.** W1: fixed state (x bin); history-augmented state (fairness); sensor-installation action
  (fairness); 10× training data (budget sensitivity, unmatched). W2: fixed state; goal-conditioned (state y bin, goal
  r); hierarchical with options holding a correction for 1 or 3 steps; clock feature (fairness). W3: Monte Carlo
  policy evaluation of the two fixed policies under local and team rewards.
- **Matched data.** 20 training episodes (6 000 steps in W1, 8 000 in W2) from seeds disjoint from evaluation.
- **Implementation weaknesses.** Small tabular state spaces, fixed learning rates, no function approximation. In W1
  the fixed-state learner ends below the passive policy (0.833 vs 0.891); this is a property of this learner and
  budget, not of reinforcement learning.

## Active inference

- **Formulation.** Discrete generative models with explicit hidden states, likelihoods, transition priors,
  observations, actions and prior preferences; policies scored by expected free energy
  G(π) = −E_Q[ln P̃(o)] − E_Q[KL(Q(s|o) ‖ Q(s))] (pragmatic + epistemic value), following the discrete-state
  formulation of active inference (Friston et al., *Active inference: a process theory*, 2017; Da Costa et al., 2020).
- **Configurations.** W1: hidden mode h with switching prior, 19 outcome bins, two-step policies, an optional sensing
  policy evaluated with the second action chosen per sensed mode; without the mode factor (fairness). W2: hidden φ
  and a semi-Markov duration factor with a duration likelihood learned online; the epistemic term is zero because no
  action changes what is observed about φ (recorded, not assumed). W3: local preferences; system preferences with
  one outcome modality per meter line (fairness). W5: Bayesian model comparison between two generative structures
  (per-account vs pooled budget) using the Poisson likelihood of the first intervention's response.
- **Implementation weaknesses.** Short planning horizons; mean-field approximation at the second step in W1; no
  learning of the likelihood mapping itself.

## Digital twin

- **Formulation.** Physical state, digital representation, synchronization from a sensor feed, model update and
  intervention; each record states whether the twin updated state values, model parameters, variable structure or
  observation structure.
- **Configurations.** W1: Kalman-filter synchronization (Kalman, 1960) with event-triggered recalibration of the gain
  when the normalized innovation test fails; interacting-multiple-model twin with two modes (Blom & Bar-Shalom, 1988)
  (fairness). W3: system twin synchronized from all meters, forecasting with the identified model and logging
  synchronization gaps. W5: stream-level twin with per-stream elasticities; with an account variable (fairness).
- **Implementation weaknesses.** Scalar filters; no sensor management; forecasts carry the last synchronized value of
  a lost line forward.

## Dynamical systems

- **Formulation.** Fixed-state and parameter-adaptive (exponentially weighted least squares) linear models (W4);
  aggregate flow model (W5). In W3 the shared identified model is itself the dynamical-systems formulation used by
  several frameworks.

## Viability / reachability

- **Formulation.** Viability kernels of a constraint set under bounded disturbance, computed on a grid (Aubin,
  *Viability Theory*, 1991); reachable sets over a horizon; safe controllers that keep the successor inside the kernel.
- **Configurations.** W1: kernel for the band |x| < 0.5 with |d| ≤ 0.3 under the known mode (result [−0.495, 0.495])
  and robust over both modes (empty); safe controller with the mode fixed and with an information-state extension
  (fairness). W3: kernels over (t, R) for "no C shortfall" under two control sets ({1.0} and [0, 1.8]).
- **Comparison with probe-relative and emergent reachability.** Classical kernels give exact set-valued guarantees
  under a stated disturbance bound (W1: no controller can guarantee the band when the mode is unknown; W3: closure
  times under two control sets). v0.3.0 probe-relative reachability samples declared option menus in forks and is less
  precise; emergent reachability records description-space change in those forks, which a kernel over a fixed state
  space does not represent without an extension of the state space. Neither is treated as superior.
- **Implementation weaknesses.** Gaussian noise lies outside the assumed bound; one-dimensional grids.

## Feature learning

- **Formulation.** A 9-8-1 (or 4-8-1) tanh MLP on a lag window, trained by full-batch Adam for a fixed number of epochs
  on the training rows at each cut-off (W4). The window length is a supplied prior.
- **Implementation weaknesses.** Small network, no early stopping or regularization; mixed-regime training history.

## Ziran / Xeno adapter

- **Formulation.** Uses v0.3.0 code directly where it applies to data: `paretoFront` / `selectFrom` with v0.3.0 Pareto
  axes (W1), `grammarMorphogenesis` with bounded / morphogenesis / full registries and meta-grammar (W4),
  `replaySpec` + `fragilityTransfer` + `diffSpace` (W3). Where the v0.3.0 mechanism is engine-internal, the adapter
  re-implements the same rule in the neutral world: aliasing records (W1), premise evaluation at issue and landing
  with three clocks (W2), provisional bundles plus the v0.3.0 J/K predicate (W5).
- **Transformations** are recorded in each world's matched-conditions entry (removed snapshot lookahead; empty
  registry instead of `grammarBoundedDiscovery`, which has no train/test split; forecasts exported as replayed
  observation sets with `pred_` channels).
