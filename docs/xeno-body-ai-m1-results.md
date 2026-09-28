# Xeno-Body + Active Inference — Milestone 1 results (generated)

Planar Xeno-Body prototype (Walker2d-v5). Experiment 1, balance recovery; seeds 1–5 (paired: each seed has one trained base controller used by both modes) × 10 episodes per condition and mode. Values: mean over seeds [95% bootstrap interval over seeds]; B − A paired by seed. Claim status: synthetic-world result. Lateral impulses are not included: the embodiment is planar.

## forward|80N|noise0.0

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.74 [0.36, 0.98] | 0.78 [0.38, 1.0] | 0.04 [0.0, 0.12] | 0.0 | 5 | [0.0, 0.2, 0.0, 0.0, 0.0] | no difference established |
| max_posture_deviation | 0.7053 [0.3938, 0.8948] | 0.7494 [0.4496, 0.908] | 0.0441 [0.0029, 0.104] | 0.0106 | 5 | [-0.0014, 0.1567, 0.0033, 0.0106, 0.0512] | B higher |
| recovered_fraction | 0.52 [0.16, 0.88] | 0.46 [0.08, 0.84] | -0.06 [-0.14, 0.0] | 0.0 | 5 | [-0.1, 0.0, 0.0, -0.2, 0.0] | no difference established |
| recovery_latency_steps | 0.3 [0.0, 0.9] | 2.325 [0.0, 6.975] | 2.025 [0.0, 6.075] | 0.0 | 4 | [0.0, 0.0, 0.0, 8.1] | no difference established |
| corrective_action_magnitude | 1.1748 [0.1542, 3.1125] | 1.5664 [0.443, 3.681] | 0.3915 [0.2042, 0.5822] | 0.3625 | 5 | [0.3625, 0.7373, 0.1591, 0.1701, 0.5287] | B higher |
| motor_effort | 70.2563 [37.3458, 118.4851] | 81.0967 [43.0311, 130.8262] | 10.8404 [2.739, 20.0686] | 9.74 | 5 | [-0.6775, 9.74, 14.8829, 2.6549, 27.6018] | B higher |
| episode_return_secondary | 208.0497 [178.9201, 235.9168] | 201.2589 [173.2693, 228.6014] | -6.7908 [-11.0048, -2.5769] | -6.7993 | 5 | [-6.7993, -12.4097, -3.0149, -11.7027, -0.0276] | B lower |

Prediction error (Mode B, 414 decisions): mean log loss 1.3, argmax hit rate 0.6135; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.264, "(0.0, 1.2)": 0.169, "(0.0, 1.0)": 0.153, "(0.1, 1.0)": 0.129, "(-0.1, 1.2)": 0.127, "(-0.1, 0.8)": 0.092, "(-0.1, 1.0)": 0.042, "(0.0, 0.8)": 0.024}

## forward|80N|noise0.05

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.7 [0.34, 0.96] | 0.8 [0.6, 0.96] | 0.1 [0.0, 0.26] | 0.0 | 5 | [0.0, 0.1, 0.0, 0.0, 0.4] | no difference established |
| max_posture_deviation | 0.6955 [0.4002, 0.8773] | 0.7703 [0.617, 0.8848] | 0.0749 [-0.0152, 0.2242] | 0.0018 | 5 | [0.0018, -0.0382, 0.0015, 0.0367, 0.3726] | no difference established |
| recovered_fraction | 0.52 [0.14, 0.9] | 0.52 [0.2, 0.82] | 0.0 [-0.12, 0.12] | 0.0 | 5 | [0.1, -0.2, 0.0, 0.2, -0.1] | no difference established |
| recovery_latency_steps | 0.225 [0.0, 0.675] | 0.9722 [0.0, 2.9167] | 0.7472 [0.0, 2.2417] | 0.0 | 4 | [0.0, 0.0, 0.0, 2.9889] | no difference established |
| corrective_action_magnitude | 7.04 [4.5859, 9.4941] | 7.3951 [4.9845, 9.8056] | 0.355 [0.1308, 0.5358] | 0.3775 | 5 | [0.3775, -0.0465, 0.2939, 0.6505, 0.4998] | B higher |
| motor_effort | 71.196 [38.3134, 120.0728] | 79.306 [45.0299, 127.2059] | 8.1099 [3.2908, 12.929] | 4.89 | 5 | [3.044, 4.89, 14.9388, 2.7381, 14.9387] | B higher |
| episode_return_secondary | 208.9288 [179.6583, 237.6159] | 202.3007 [175.7095, 228.8919] | -6.6281 [-13.3285, 0.0723] | -4.203 | 5 | [-4.203, -17.8049, -3.2149, 5.4973, -13.4149] | no difference established |

Prediction error (Mode B, 415 decisions): mean log loss 1.9398, argmax hit rate 0.3614; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.249, "(0.1, 1.0)": 0.139, "(-0.1, 1.2)": 0.139, "(0.0, 1.2)": 0.129, "(-0.1, 0.8)": 0.111, "(0.0, 1.0)": 0.106, "(0.0, 0.8)": 0.052, "(-0.1, 1.0)": 0.052, "(0.1, 0.8)": 0.024}

## forward|140N|noise0.0

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.84 [0.52, 1.0] | 0.92 [0.76, 1.0] | 0.08 [0.0, 0.24] | 0.0 | 5 | [0.0, 0.0, 0.0, 0.4, 0.0] | no difference established |
| max_posture_deviation | 0.8288 [0.674, 0.9086] | 0.8615 [0.7707, 0.91] | 0.0327 [-0.0006, 0.0972] | -0.0001 | 5 | [-0.0001, 0.0041, -0.0006, 0.1609, -0.0009] | no difference established |
| recovered_fraction | 0.56 [0.16, 0.96] | 0.54 [0.14, 0.94] | -0.02 [-0.06, 0.0] | 0.0 | 5 | [0.0, 0.0, 0.0, -0.1, 0.0] | no difference established |
| recovery_latency_steps | 0.7417 [0.0, 2.125] | 1.7476 [0.0, 3.1] | 1.006 [0.0, 3.0] | 0.0179 | 3 | [0.0, 0.0179, 3.0] | no difference established |
| corrective_action_magnitude | 1.0486 [0.2424, 2.5495] | 1.523 [0.4815, 3.252] | 0.4744 [0.2146, 0.7341] | 0.3528 | 5 | [0.3528, 0.867, 0.168, 0.1921, 0.7918] | B higher |
| motor_effort | 67.0151 [36.2538, 107.1785] | 75.0651 [42.9099, 115.926] | 8.0501 [2.4607, 12.7858] | 9.4913 | 5 | [-1.4341, 9.4913, 15.5874, 4.9744, 11.6314] | B higher |
| episode_return_secondary | 202.013 [170.0445, 233.9815] | 195.7049 [164.9769, 226.4329] | -6.3081 [-8.4708, -4.1454] | -6.405 | 5 | [-5.2986, -9.9095, -2.4156, -6.405, -7.5116] | B lower |

Prediction error (Mode B, 415 decisions): mean log loss 1.5306, argmax hit rate 0.5663; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.217, "(0.1, 1.0)": 0.143, "(0.0, 1.2)": 0.143, "(-0.1, 1.2)": 0.138, "(0.0, 1.0)": 0.136, "(-0.1, 0.8)": 0.119, "(-0.1, 1.0)": 0.048, "(0.0, 0.8)": 0.031, "(0.1, 0.8)": 0.024}

## forward|140N|noise0.05

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.84 [0.56, 1.0] | 0.86 [0.62, 1.0] | 0.02 [-0.04, 0.08] | 0.0 | 5 | [0.0, -0.1, 0.0, 0.1, 0.1] | no difference established |
| max_posture_deviation | 0.8236 [0.663, 0.9056] | 0.8319 [0.6919, 0.9063] | 0.0083 [-0.0072, 0.0303] | -0.0028 | 5 | [-0.0028, -0.0122, -0.0046, 0.0513, 0.0096] | no difference established |
| recovered_fraction | 0.56 [0.16, 0.96] | 0.52 [0.18, 0.86] | -0.04 [-0.18, 0.08] | 0.0 | 5 | [0.1, -0.3, 0.0, 0.1, -0.1] | no difference established |
| recovery_latency_steps | 0.45 [0.0, 1.25] | 0.4722 [0.0, 1.0] | 0.1796 [-0.6944, 1.2333] | 0.0 | 3 | [0.0, -0.6944, 1.2333] | no difference established |
| corrective_action_magnitude | 6.5009 [4.4459, 8.5559] | 6.7418 [4.7071, 8.7765] | 0.2409 [-0.2588, 0.6842] | 0.2822 | 5 | [0.3959, 0.9775, 0.2822, 0.2063, -0.6573] | no difference established |
| motor_effort | 67.355 [37.1889, 107.8007] | 74.3313 [43.7033, 118.4271] | 6.9763 [1.2979, 12.6793] | 2.5471 | 5 | [2.5471, 15.6925, 14.7322, 1.0165, 0.8929] | B higher |
| episode_return_secondary | 201.4726 [170.2034, 232.7419] | 194.4857 [166.3133, 222.658] | -6.987 [-14.6266, -2.1468] | -3.9025 | 5 | [-3.9025, -6.2157, -2.7147, -0.701, -21.4009] | B lower |

Prediction error (Mode B, 410 decisions): mean log loss 2.0753, argmax hit rate 0.3293; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.225, "(-0.1, 1.2)": 0.173, "(-0.1, 0.8)": 0.125, "(0.1, 1.0)": 0.118, "(0.0, 1.2)": 0.113, "(0.0, 1.0)": 0.086, "(0.0, 0.8)": 0.062, "(-0.1, 1.0)": 0.06, "(0.1, 0.8)": 0.038}

## forward|200N|noise0.0

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.9 [0.7, 1.0] | 0.88 [0.64, 1.0] | -0.02 [-0.06, 0.0] | 0.0 | 5 | [0.0, 0.0, 0.0, -0.1, 0.0] | no difference established |
| max_posture_deviation | 0.8734 [0.8066, 0.9085] | 0.8526 [0.7444, 0.9086] | -0.0208 [-0.0624, 0.0004] | -0.0007 | 5 | [-0.0014, -0.0007, 0.0, -0.1035, 0.0013] | no difference established |
| recovered_fraction | 0.54 [0.16, 0.92] | 0.48 [0.1, 0.86] | -0.06 [-0.18, 0.0] | 0.0 | 5 | [0.0, -0.3, 0.0, 0.0, 0.0] | no difference established |
| recovery_latency_steps | 0.4074 [0.0, 1.2222] | 1.2963 [0.0, 2.8889] | 0.8889 [0.0, 1.6667] | 1.0 | 3 | [0.0, 1.6667, 1.0] | no difference established |
| corrective_action_magnitude | 0.9852 [0.3155, 2.2339] | 1.4172 [0.5597, 2.9019] | 0.432 [0.2177, 0.6524] | 0.3458 | 5 | [0.3458, 0.8548, 0.1057, 0.2656, 0.588] | B higher |
| motor_effort | 61.1017 [34.6049, 97.0697] | 70.3083 [41.083, 108.0269] | 9.2067 [2.4283, 15.9851] | 8.0436 | 5 | [-1.725, 8.0436, 16.0334, 3.7739, 19.9075] | B higher |
| episode_return_secondary | 188.1789 [161.1682, 218.0229] | 185.6097 [158.9634, 215.0451] | -2.5692 [-4.8128, -0.0251] | -2.1199 | 5 | [-4.2983, -6.608, -1.816, 1.9962, -2.1199] | B lower |

Prediction error (Mode B, 393 decisions): mean log loss 1.728, argmax hit rate 0.5165; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.223, "(-0.1, 1.2)": 0.163, "(0.0, 1.2)": 0.148, "(0.0, 1.0)": 0.13, "(0.1, 1.0)": 0.105, "(-0.1, 0.8)": 0.093, "(0.0, 0.8)": 0.07, "(-0.1, 1.0)": 0.055, "(0.1, 0.8)": 0.013}

## forward|200N|noise0.05

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.92 [0.76, 1.0] | 0.92 [0.76, 1.0] | 0.0 [0.0, 0.0] | 0.0 | 5 | [0.0, 0.0, 0.0, 0.0, 0.0] | no difference established |
| max_posture_deviation | 0.8749 [0.8077, 0.9116] | 0.8715 [0.8055, 0.907] | -0.0034 [-0.0048, -0.0021] | -0.0043 | 5 | [-0.0014, -0.0047, -0.0051, -0.0017, -0.0043] | B lower |
| recovered_fraction | 0.58 [0.18, 0.98] | 0.48 [0.14, 0.82] | -0.1 [-0.28, 0.04] | 0.0 | 5 | [0.1, -0.4, 0.0, 0.0, -0.2] | no difference established |
| recovery_latency_steps | 1.0333 [0.0, 3.1] | 0.1187 [0.0, 0.2812] | -0.875 [-3.0, 0.375] | 0.0 | 3 | [0.0, -3.0, 0.375] | no difference established |
| corrective_action_magnitude | 5.6212 [3.8778, 7.3646] | 5.7385 [4.1178, 7.3592] | 0.1173 [-0.2893, 0.4491] | 0.2861 | 5 | [0.2861, 0.6404, 0.2949, -0.6729, 0.038] | no difference established |
| motor_effort | 61.5215 [35.5009, 97.7382] | 67.9326 [39.6307, 106.5743] | 6.4111 [0.4557, 11.8576] | 8.5282 | 5 | [1.3925, 10.6206, 14.7592, -3.2448, 8.5282] | B higher |
| episode_return_secondary | 187.6985 [161.3871, 215.0339] | 181.8321 [157.9585, 208.0739] | -5.8664 [-8.6447, -3.4014] | -5.9106 | 5 | [-3.4014, -5.9106, -2.2148, -6.7968, -11.0085] | B lower |

Prediction error (Mode B, 386 decisions): mean log loss 2.2558, argmax hit rate 0.2927; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.221, "(-0.1, 1.2)": 0.172, "(-0.1, 0.8)": 0.156, "(0.0, 1.2)": 0.118, "(0.0, 0.8)": 0.087, "(0.1, 1.0)": 0.082, "(0.0, 1.0)": 0.077, "(-0.1, 1.0)": 0.064, "(0.1, 0.8)": 0.023}

## backward|80N|noise0.0

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.94 [0.82, 1.0] | 0.86 [0.62, 1.0] | -0.08 [-0.36, 0.12] | 0.0 | 5 | [0.2, -0.6, 0.0, 0.0, 0.0] | no difference established |
| max_posture_deviation | 0.8579 [0.8034, 0.8927] | 0.8516 [0.8081, 0.8912] | -0.0063 [-0.055, 0.0347] | -0.0034 | 5 | [0.0615, -0.0927, -0.0034, -0.0077, 0.0109] | no difference established |
| recovered_fraction | 0.36 [0.0, 0.76] | 0.3 [0.0, 0.7] | -0.06 [-0.18, 0.0] | 0.0 | 5 | [-0.3, 0.0, 0.0, 0.0, 0.0] | no difference established |
| recovery_latency_steps | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 | 2 | [0.0, 0.0] | no difference established |
| corrective_action_magnitude | 1.2344 [0.2103, 2.9452] | 1.4914 [0.4551, 3.1777] | 0.257 [0.1585, 0.3533] | 0.2422 | 5 | [0.3959, 0.1828, 0.0922, 0.2422, 0.3718] | B higher |
| motor_effort | 72.3244 [39.8826, 123.6751] | 82.6829 [47.0279, 128.6825] | 10.3585 [-0.8663, 22.7978] | 4.5587 | 5 | [-0.1744, -4.2707, 18.3885, 4.5587, 33.2903] | no difference established |
| episode_return_secondary | 208.5077 [188.0218, 227.1226] | 208.4773 [184.7462, 232.0037] | -0.0304 [-10.5482, 11.2972] | -3.7046 | 5 | [-16.5998, 9.9043, -7.9184, -3.7046, 18.1667] | no difference established |

Prediction error (Mode B, 434 decisions): mean log loss 1.4176, argmax hit rate 0.5806; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.254, "(0.0, 1.2)": 0.197, "(0.0, 1.0)": 0.17, "(0.1, 1.0)": 0.098, "(-0.1, 0.8)": 0.093, "(-0.1, 1.2)": 0.093, "(0.0, 0.8)": 0.061, "(-0.1, 1.0)": 0.034}

## backward|80N|noise0.05

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.92 [0.8, 1.0] | 0.86 [0.72, 0.98] | -0.06 [-0.22, 0.08] | 0.0 | 5 | [0.2, -0.3, 0.0, 0.0, -0.2] | no difference established |
| max_posture_deviation | 0.8623 [0.8181, 0.8931] | 0.8277 [0.7561, 0.886] | -0.0346 [-0.1087, 0.0361] | 0.0024 | 5 | [0.086, -0.1574, 0.0031, 0.0024, -0.1071] | no difference established |
| recovered_fraction | 0.36 [0.0, 0.76] | 0.36 [0.1, 0.64] | 0.0 [-0.24, 0.24] | 0.0 | 5 | [-0.4, -0.1, 0.0, 0.1, 0.4] | no difference established |
| recovery_latency_steps | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 | 2 | [0.0, 0.0] | no difference established |
| corrective_action_magnitude | 6.906 [5.3043, 8.6878] | 7.7497 [5.5077, 9.9917] | 0.8437 [-0.0919, 1.9048] | 0.6017 | 5 | [-0.5893, 1.0791, 0.2292, 0.6017, 2.8977] | no difference established |
| motor_effort | 72.9357 [41.1419, 123.9836] | 82.7534 [45.7911, 132.8073] | 9.8177 [1.5651, 19.3883] | 6.1351 | 5 | [-2.049, 6.1351, 16.1384, 2.8942, 25.9696] | B higher |
| episode_return_secondary | 208.7471 [189.0564, 226.238] | 208.1172 [186.6717, 229.5628] | -0.6298 [-14.8289, 11.7459] | 3.2971 | 5 | [-24.598, 5.7939, -8.3161, 3.2971, 20.674] | no difference established |

Prediction error (Mode B, 429 decisions): mean log loss 1.9544, argmax hit rate 0.3893; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.236, "(0.0, 1.2)": 0.158, "(0.0, 1.0)": 0.149, "(-0.1, 0.8)": 0.115, "(-0.1, 1.2)": 0.112, "(0.1, 1.0)": 0.092, "(0.0, 0.8)": 0.069, "(-0.1, 1.0)": 0.06, "(0.1, 0.8)": 0.009}

## backward|140N|noise0.0

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.86 [0.66, 1.0] | 0.92 [0.76, 1.0] | 0.06 [0.0, 0.14] | 0.0 | 5 | [0.1, 0.0, 0.2, 0.0, 0.0] | no difference established |
| max_posture_deviation | 0.8339 [0.7516, 0.8855] | 0.859 [0.8066, 0.893] | 0.0252 [-0.0061, 0.0615] | 0.0023 | 5 | [0.0849, -0.0023, 0.055, 0.0023, -0.014] | no difference established |
| recovered_fraction | 0.44 [0.08, 0.8] | 0.36 [0.02, 0.74] | -0.08 [-0.24, 0.08] | 0.0 | 5 | [-0.3, 0.2, -0.3, 0.0, 0.0] | no difference established |
| recovery_latency_steps | 1.8333 [0.0, 5.5] | 2.3333 [0.0, 7.0] | 0.5 [0.0, 1.5] | 0.0 | 3 | [0.0, 0.0, 1.5] | no difference established |
| corrective_action_magnitude | 1.0285 [0.2566, 2.1822] | 1.2486 [0.506, 2.367] | 0.2201 [0.1444, 0.3011] | 0.2425 | 5 | [0.3759, 0.1352, 0.1045, 0.2425, 0.2427] | B higher |
| motor_effort | 68.1076 [40.5174, 111.2353] | 77.2428 [49.3736, 114.3997] | 9.1352 [-0.7734, 19.2158] | 5.1553 | 5 | [0.6714, -5.1825, 19.7166, 5.1553, 25.3154] | no difference established |
| episode_return_secondary | 204.5119 [181.2399, 227.7277] | 202.8428 [179.8151, 222.7783] | -1.6691 [-8.9892, 5.6509] | -2.7052 | 5 | [-6.2007, 6.7052, -14.9197, -2.7052, 8.7747] | no difference established |

Prediction error (Mode B, 428 decisions): mean log loss 1.4058, argmax hit rate 0.6005; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.289, "(0.0, 1.2)": 0.176, "(0.0, 1.0)": 0.164, "(-0.1, 0.8)": 0.106, "(-0.1, 1.2)": 0.081, "(0.1, 1.0)": 0.076, "(0.0, 0.8)": 0.069, "(-0.1, 1.0)": 0.037}

## backward|140N|noise0.05

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.86 [0.66, 1.0] | 0.92 [0.84, 1.0] | 0.06 [-0.08, 0.22] | 0.0 | 5 | [0.3, -0.2, 0.2, 0.0, 0.0] | no difference established |
| max_posture_deviation | 0.8426 [0.7802, 0.8921] | 0.8384 [0.7833, 0.8926] | -0.0042 [-0.0636, 0.0493] | 0.0002 | 5 | [0.0476, -0.1151, 0.0755, 0.0002, -0.0292] | no difference established |
| recovered_fraction | 0.46 [0.08, 0.84] | 0.32 [0.1, 0.58] | -0.14 [-0.42, 0.14] | -0.1 | 5 | [-0.6, -0.1, -0.4, 0.1, 0.3] | no difference established |
| recovery_latency_steps | 0.1667 [0.0, 0.5] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 | 2 | [0.0, 0.0] | no difference established |
| corrective_action_magnitude | 6.5979 [5.0415, 7.7214] | 7.2238 [5.5701, 8.5404] | 0.6259 [-0.1419, 1.455] | 0.5355 | 5 | [-0.5935, 0.9405, 0.0201, 0.5355, 2.2267] | no difference established |
| motor_effort | 69.1184 [41.0404, 111.7387] | 77.9014 [47.6146, 119.917] | 8.7831 [1.7036, 16.1421] | 5.8371 | 5 | [-1.4637, 5.8371, 16.1535, 2.8041, 20.5844] | B higher |
| episode_return_secondary | 205.7509 [182.559, 229.2264] | 203.3421 [184.3536, 214.4031] | -2.4088 [-16.1635, 11.2089] | 2.2972 | 5 | [-25.7985, 11.9942, -15.4162, 2.2972, 14.8794] | no difference established |

Prediction error (Mode B, 426 decisions): mean log loss 1.9999, argmax hit rate 0.3826; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.253, "(0.0, 1.2)": 0.14, "(0.0, 1.0)": 0.133, "(-0.1, 0.8)": 0.126, "(-0.1, 1.2)": 0.114, "(0.1, 1.0)": 0.093, "(0.0, 0.8)": 0.077, "(-0.1, 1.0)": 0.056, "(0.1, 0.8)": 0.009}

## backward|200N|noise0.0

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.78 [0.42, 1.0] | 0.78 [0.54, 1.0] | 0.0 [-0.18, 0.18] | 0.0 | 5 | [-0.3, 0.0, 0.3, 0.0, 0.0] | no difference established |
| max_posture_deviation | 0.793 [0.6482, 0.8806] | 0.7924 [0.6678, 0.8897] | -0.0006 [-0.0452, 0.035] | 0.0056 | 5 | [-0.0813, 0.002, 0.0546, 0.0056, 0.0161] | no difference established |
| recovered_fraction | 0.46 [0.08, 0.84] | 0.54 [0.14, 0.94] | 0.08 [-0.12, 0.36] | 0.0 | 5 | [0.0, 0.6, -0.2, 0.0, 0.0] | no difference established |
| recovery_latency_steps | 2.3333 [0.0, 7.0] | 3.2571 [0.0, 7.5714] | 0.9238 [0.0, 2.2] | 0.5714 | 3 | [2.2, 0.0, 0.5714] | no difference established |
| corrective_action_magnitude | 0.9768 [0.3742, 1.8831] | 1.1777 [0.5196, 2.0243] | 0.2009 [0.0739, 0.3352] | 0.1746 | 5 | [0.2947, 0.069, 0.0286, 0.1746, 0.4375] | B higher |
| motor_effort | 65.3429 [39.7643, 105.1844] | 75.706 [46.7883, 108.9595] | 10.3631 [-0.7511, 21.4773] | 5.0958 | 5 | [-2.0488, -2.3768, 28.055, 5.0958, 23.0904] | no difference established |
| episode_return_secondary | 197.9747 [170.7988, 229.5461] | 201.2243 [173.348, 229.9851] | 3.2496 [-2.7425, 9.2156] | 4.0024 | 5 | [13.902, 4.0024, -6.0281, -2.0051, 6.3769] | no difference established |

Prediction error (Mode B, 413 decisions): mean log loss 1.4373, argmax hit rate 0.586; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.311, "(0.0, 1.2)": 0.16, "(0.0, 1.0)": 0.153, "(-0.1, 0.8)": 0.134, "(0.1, 1.0)": 0.08, "(-0.1, 1.2)": 0.068, "(0.0, 0.8)": 0.061, "(-0.1, 1.0)": 0.031}

## backward|200N|noise0.05

| metric | Mode A | Mode B | B − A mean [95% CI] | B − A median | n | per-seed B − A (seeds 1–5) | interval |
|---|---|---|---|---|---|---|---|
| fall_rate | 0.76 [0.36, 1.0] | 0.84 [0.56, 1.0] | 0.08 [0.0, 0.2] | 0.0 | 5 | [0.1, 0.0, 0.3, 0.0, 0.0] | no difference established |
| max_posture_deviation | 0.783 [0.6117, 0.8875] | 0.7906 [0.6266, 0.8933] | 0.0076 [0.0011, 0.0147] | 0.0035 | 5 | [0.0035, 0.0024, 0.0188, -0.0014, 0.0145] | B higher |
| recovered_fraction | 0.48 [0.08, 0.88] | 0.52 [0.2, 0.82] | 0.04 [-0.16, 0.26] | 0.0 | 5 | [-0.3, 0.4, -0.1, 0.0, 0.2] | no difference established |
| recovery_latency_steps | 1.7 [0.0, 5.1] | 3.5516 [0.0, 7.1032] | 3.0354 [0.0, 6.4286] | 2.6778 | 3 | [6.4286, 0.0, 2.6778] | no difference established |
| corrective_action_magnitude | 6.2295 [4.5643, 8.124] | 7.1987 [5.2114, 9.1761] | 0.9692 [0.5732, 1.4981] | 0.7493 | 5 | [0.7493, 0.5713, 1.0558, 0.4871, 1.9825] | B higher |
| motor_effort | 66.2476 [40.5465, 105.7797] | 76.6208 [48.5215, 112.6041] | 10.3732 [3.0475, 17.6989] | 6.3179 | 5 | [6.3179, 1.761, 22.1837, 2.6988, 18.9047] | B higher |
| episode_return_secondary | 199.2338 [171.5385, 230.6041] | 203.9034 [178.3295, 229.4772] | 4.6696 [0.0658, 9.1105] | 5.1937 | 5 | [5.1937, 9.9982, -3.8222, 1.7973, 10.1811] | B higher |

Prediction error (Mode B, 422 decisions): mean log loss 2.1169, argmax hit rate 0.3507; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.295, "(-0.1, 0.8)": 0.137, "(0.0, 1.2)": 0.126, "(0.0, 1.0)": 0.119, "(-0.1, 1.2)": 0.098, "(0.1, 1.0)": 0.086, "(0.0, 0.8)": 0.081, "(-0.1, 1.0)": 0.049, "(0.1, 0.8)": 0.009}

## Interval summary over the 12 conditions

| metric | B higher | B lower | no difference established |
|---|---|---|---|
| fall_rate | 0 | 0 | 12 |
| max_posture_deviation | 2 | 1 | 9 |
| recovered_fraction | 0 | 0 | 12 |
| recovery_latency_steps | 0 | 0 | 12 |
| corrective_action_magnitude | 8 | 0 | 4 |
| motor_effort | 9 | 0 | 3 |
| episode_return_secondary | 1 | 5 | 6 |

## Latency (ms, pooled over all calls)

| mode | component | calls | median | p95 | max |
|---|---|---|---|---|---|
| A | observation_adaptation | 121597 | 0.00754 | 0.01487 | 3.33733 |
| A | layer0_fast_control | 121597 | 0.41787 | 0.75514 | 44.29346 |
| A | controller_step_total | 121597 | 0.42633 | 0.77314 | 44.33329 |
| B | observation_adaptation | 120018 | 0.00762 | 0.01475 | 2.503 |
| B | latent_state_inference | 5068 | 0.04854 | 0.06596 | 2.11187 |
| B | vfe | 5068 | 0.01658 | 0.02099 | 1.26075 |
| B | efe_preference | 5068 | 0.03741 | 0.05915 | 4.41629 |
| B | efe_epistemic | 5068 | 1.26687 | 1.82038 | 9.71233 |
| B | efe_total | 5068 | 1.52006 | 2.2899 | 20.58308 |
| B | policy_selection | 5068 | 0.02079 | 0.03183 | 1.18292 |
| B | aif_decision_total | 5068 | 1.63252 | 2.4623 | 20.76558 |
| B | layer0_fast_control | 120018 | 0.42325 | 0.76347 | 103.85112 |
| B | controller_step_total | 120018 | 0.43254 | 1.50824 | 103.85938 |
| B | controller_step_with_decision | 5068 | 2.12035 | 3.40732 | 21.65983 |

## Active Inference decision budget

| budget | median below | p95 below | max below |
|---|---|---|---|
| < 200 ms | True | True | True |
| < 100 ms | True | True | True |
| < 50 ms | True | True | True |
| < 10 ms | True | True | False |
