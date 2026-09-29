# Cascaded Tanks — limitations

Scope: protocol CT-P1 (frozen in `db3e622`), results in `d6ff468`, exploratory follow-ups in
`results/external-comparison/cascaded-tanks/exploratory-followups.json`. Claim status: **replayed empirical result**
(one dataset, one physical setup). Nothing here is an empirically supported generalization.

## What the dataset supports

- **Replay only.** The recorded input is a designed multisine excitation; there are no randomized interventions and no
  recorded outcomes for altered inputs. The counterfactual (test input × 1.2) is an unvalidated model output.
- **Two records, 1024 samples each.** Hyperparameter selection used a 256-sample validation tail of the estimation
  record; with so little data, selection is noisy (for example, ARX orders selected on validation simulation RMSE).
- **No too-late-correction analysis.** The data contain no recorded corrections.

## Findings that constrain interpretation

- **Grey-box identifiability.** M4b (grey-box with overflow) reached the lowest simulation e_RMSt (0.570 V) with a
  physically implausible parameter set (upper-tank initial state ≈ 2092, k₄ ≈ 36): the upper state is effectively held
  at its saturation. The fit is reported as obtained; it should not be read as identified physics.
- **Twin noise model.** The EKF twin's selected noise settings give mean NIS 0.12 on the estimation record (≈ 1 expected);
  the extended grid in follow-up F1 did not change the test result (0.1062 vs 0.1063). The twin's one-step error
  (0.106 V) is therefore a property of this EKF formulation, not of digital twins in general.
- **MLP.** The NARX-MLP simulation error (1.750 V, mean over seeds) reflects small data and one-step training; no
  multi-step training was pre-registered.
- **Residual autocorrelation** flags most simulation-mode models because simulation residuals are autocorrelated by
  construction; the signal is informative only for one-step models (ARX and PWARX show none).
- **Q3 threshold.** "Near-identical" (|Δy|, |Δu| ≤ 0.05 V) and "divergent" (> 0.3 V) were fixed in advance; other
  thresholds could give a different count. The v0.3.0 aliasing key (1e-3 quantization) finds no aliasing in continuous
  measured data by construction.

## Ziran / Xeno adapter

- **One-step only.** The adapter's generated variables are functions of measured series; it has no generative simulation
  of y, so it is not compared in simulation mode.
- **Information asymmetry.** The pre-registered readout does not use the current input u(t), unlike ARX-type models
  with nk = 0. Follow-up F2 (benefits the adapter only) added u(t): the readout without generated variables improved
  (0.0859 → 0.0729 V) while the full adapter worsened (0.0763 → 0.0871 V). With the current input available, the
  generated variables did not help.
- **Grammar revision.** The grammar-bounded variant (0.0757 V) was slightly better than the full adapter (0.0763 V); the
  representation-change variable `step@v1(v1)` did not improve held-out error. Removing the meta-grammar or the temporal
  operators changed nothing.
- **Result.** No non-redundant Ziran / Xeno distinction was observed under this protocol. The fairness rule was not
  triggered because no Ziran variant improved over the best conventional one-step model (switching ARX, 0.0515 V).

## Post-hoc changes

None to the pre-registered models or data. The two follow-ups (F1 twin grid, F2 adapter readout) are exploratory, each
benefits one framework only, and neither overwrites the pre-registered results. An optional `includeCurrentInput` flag
(default off) and an exported EKF helper were added to the adapter code after the pre-registered run to make the
follow-ups possible; the pre-registered behaviour is unchanged and was reproduced exactly (determinism check in the
follow-up file).

## Not changed

No Ziran / Xeno theory, Level A/B/C/D structure, or v0.3.0 code was changed in response to this dataset (`git diff
v0.3.0 -- src public bin` is empty).
