# Cascaded Tanks — provenance

Machine-readable record: `results/external-comparison/cascaded-tanks/provenance.json`. Everything below is taken from
the repository metadata or `TanksBenchmark.pdf`; fields the source does not document are marked as such.

| field | value |
|---|---|
| title | Cascaded Tanks Benchmark Combining Soft and Hard Nonlinearities |
| source | 4TU.ResearchData (primary archive) |
| DOI | 10.4121/12960104.v1 |
| version | 1, published 2020-09-21 |
| authors | repository metadata: Maarten Schoukens, Per Mattson, Torbjörn Wigren, Jean-Philippe Noël; PDF: M. Schoukens, P. Mattsson, T. Wigren, J.P. Noël (spellings differ in the sources) |
| license | CC BY-SA 4.0 |
| download date | 2026-09-28 (`comparison/empirical/fetch-cascaded-tanks.ts`) |
| apparatus | two cascaded tanks with free outlets fed by a pump; capacitive level sensors (not calibrated, part of the system); Matlab interface to A/D and D/A converters |
| measured / manipulated | output: lower-tank water level; input: pump voltage |
| units | u and y in V (sensor not calibrated; no level unit documented); Ts in s |
| sampling | Ts = 4 s, uniform; 1024 samples per record |
| records | 2: estimation (uEst, yEst) and test (uVal, yVal — the file's "Val" is the documentation's test record) |
| duration | 4096 s per record (derived: 1024 × 4 s) |
| inputs | multisine, 0–0.0144 Hz, lower frequencies with higher amplitude, zeroth-order hold |
| known nonlinearities | square-root outflow (weak); overflow saturation of the upper and, delayed, lower tank; stochastic overflow as input-dependent process noise; possible sensor nonlinearity |
| physical constraints | tank capacity (overflow); tank dimensions not documented in supplied source |
| initial conditions | not in steady state; unknown initial state, the same for both records |
| missing data | none (1024 complete rows; Ts filled only in the first row; one empty trailing line) |
| preprocessing | publisher: not documented in supplied source; this project: parsing only |
| uncertainty | output SNR close to 40 dB |
| intervention record | designed excitation; no randomized interventions and no altered-input outcomes |
| recommended use | estimate on the estimation record; do not use the test data during estimation; report e_RMSt for simulation and/or prediction |
| actuator type | pump (model not documented in supplied source) |

## Hashes (SHA-256)

| file | SHA-256 |
|---|---|
| CascadedTanksFiles.zip (archive, publisher MD5 f832776e… verified) | `eb0fa05851e8a7136846c2e3b61fbef87def78d0852c86ab91b02ac5db541b51` |
| TanksBenchmark.pdf (publisher MD5 81732c07… verified; identical to the copy in the archive) | `91597add858efdec98cc1bfabd7b87867c5c3cb8a0ec10976ceed9acdee81b39` |
| dataBenchmark.csv (primary data file used) | `ef2388ed822f3aef4aa80d6b0f2b466dd80b361786b3eafc7a2957c31ea323a7` |
| dataBenchmark.mat (not used) | `cb2f88d4388be4d3f2a24c6402fba804976aac5f2e1f26cda59ea0a38d016eab` |

## Transformation history

1. `raw/CascadedTanksFiles.zip` → `derived/extracted/CascadedTanksFiles/*` (unzip without overwriting; raw file unchanged).
2. `derived/extracted/CascadedTanksFiles/dataBenchmark.csv` → in-memory arrays uEst, yEst, uVal, yVal (1024 each); the
   Ts column and the empty trailing line are discarded. No other transformation.

Raw and derived files are not committed. CC BY-SA 4.0 would permit redistribution with attribution and share-alike,
but reproducing the download from the primary archive keeps a single authoritative copy.

## Documentation note

The benchmark formula prints `1/N_v` under the square root while defining `N_t` as the number of test points; this
project computes e_RMSt with N_t = 1024.
