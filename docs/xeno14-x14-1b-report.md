# Xeno-14 X14-1b — results and assessment

Protocol frozen in `c7d370b` ([xeno14-x14-1b-protocol.md](xeno14-x14-1b-protocol.md)); code committed in `a572286`
before the run. Data: `results/xeno14/x14-1b/raw.json` (2 embodiments × 10 seeds, 2114 s), analysis
`analysis.json` (frozen rules), exploratory checks `exploratory-multiplicity.json`. Claim status:
**synthetic-world result** (simulated embodiments).

## Pre-registered outcome: CONDITIONAL GO

| criterion (frozen) | result |
|---|---|
| (a) a declared transfer in an interpretable row | met (Walker2d only) |
| (b) at least one such entry adds information beyond the trade-off analysis | met (Walker2d, 2 entries) |
| (c) module-wise training not worse than scalarized training of the same architecture | met (interval includes 0 in both embodiments) |
| (d) at least one module ignites consistently in each embodiment | **not met** (every module's ignition fraction varies across seeds by ≥ 0.25 sd) |

H1 (the X14-1 exploratory candidate): **not supported — reversed**. In Walker2d at 140 N, improving low-noise-movement
changed axis-maintenance by −12% (95% interval −24% to −1%, co-improvement), not the deterioration seen in X14-1's three
seeds. H2 (morphology dependence): supported by the frozen criterion, but mainly because no Hopper row was
interpretable (see below); ignition differences between embodiments have intervals that include 0.

## Analyst assessment (separate from the frozen rule): recommend not expanding to X14-2

1. **Hopper:** no Xeno-14 intervention improved its own organization (no interpretable row), so Fragility Transfer
   cannot be read there.
2. **Walker2d, declared entries:**
   - *lower-abdominal-continuity → low-noise-movement deteriorates* (+201%, interval +79% to +339%). It survives a
     Bonferroni correction over the 12 Xeno-14 off-diagonal tests (exploratory). But the absolute change is small
     (+0.0034 on a control mean of 0.0021), and the scalarized MLP shows the same direction with a larger absolute
     change (+0.0098; relative +46%, interval −0.1% to +101%). The "adds information" judgment rests on the
     trade-off interval only just including 0. This looks like the ordinary trade-off between stiffness and smooth
     action, not a Xeno-14-specific transfer.
   - *low-noise-movement → axis-maintenance co-improves* (−12%, interval −24% to −1%): Bonferroni-adjusted p ≈ 0.51
     (exploratory); not robust. Its "opposite sign" in the trade-off matrix compares two different architectures.
3. **No correction for multiple comparisons was pre-registered.** With 12 off-diagonal Xeno-14 tests at 95%, about
   0.6 false declarations are expected by chance.
4. **Performance:** at 140 N the standard MLP survived longer than Xeno-14 in both embodiments (paired difference
   Walker2d −0.080 [−0.153, −0.010], Hopper −0.184 [−0.271, −0.093]).
5. **One morphology-dependent difference (descriptive, not a pre-registered hypothesis):** ignition gates helped in
   Hopper (Xeno-14 − gates-off +0.190 [+0.064, +0.321]) but not in Walker2d (+0.000 [−0.053, +0.049]); module-wise
   training was also better than scalarized training in Hopper (+0.109 [−0.002, +0.218]), not in Walker2d. Ignition
   itself was inconsistent across seeds in both.

**Conclusion.** The pre-registered rule returns CONDITIONAL GO, and that outcome is reported unchanged. The evidence
under it is weak: the only robust entry is reproduced in direction, with a larger absolute effect, by an ordinary
scalarized multi-objective controller. Xeno-14 remains **not demonstrated to be nonredundant**. If the work continues,
the defensible next step is a narrow confirmatory protocol (absolute metrics, pre-registered multiplicity control,
the gating benefit in the monopod as the primary hypothesis), not expansion to fourteen principles.

## Survival at 140 N (mean, 95% bootstrap interval over 10 seeds)

| configuration | Walker2d | Hopper |
|---|---|---|
| xeno14 | 0.826 [0.788, 0.856] | 0.573 [0.529, 0.622] |
| xeno14-scalarized-training | 0.858 [0.815, 0.904] | 0.464 [0.342, 0.586] |
| xeno14-gates-off | 0.825 [0.785, 0.875] | 0.383 [0.273, 0.499] |
| multiobjective-scalarized-mlp | 0.766 [0.638, 0.847] | 0.253 [0.230, 0.279] |
| standard-mlp | 0.905 [0.849, 0.958] | 0.756 [0.663, 0.851] |

Organization metrics, ignition fractions, both FT matrices at 80 N and 140 N and all paired comparisons are in
`analysis.json`.
