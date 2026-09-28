# Xeno-14 X14-1b — frozen protocol

Redesign after the X14-1 STOP recommendation ([xeno14-x14-1-report.md](xeno14-x14-1-report.md)). Machine-readable:
`results/xeno14/x14-1b/protocol.json`. This file and the JSON are committed and pushed **before** the X14-1b experiment
is run; the commit hash is recorded in the results report.

Changes from X14-1, each addressing a recorded failure:

| X14-1 problem | X14-1b change |
|---|---|
| interventions did not reliably improve their own organization | FT row i is read only if FT[i][i]'s 95% interval is entirely below 0 |
| capped normalized metrics hid differences | raw (uncapped) relative changes |
| 3 seeds | 10 seeds, bootstrap 95% intervals |
| one embodiment | Walker2d-v5 (biped) and Hopper-v5 (monopod) |
| exploratory FT candidate | stated in advance as hypothesis H1 |
| intervention budget 12 iterations | 24 iterations |

Decision rule (fixed): **GO** if a declared transfer exists in an interpretable row, adds information beyond the
scalarized trade-off analysis, module-wise training is not worse than scalarized training of the same architecture,
and at least one module ignites consistently in each embodiment; **CONDITIONAL GO** if only the first two hold;
**STOP** otherwise. Architecture repartition is not repeated here.

Known bias: organization metrics average over surviving steps; survival is always reported with them.
