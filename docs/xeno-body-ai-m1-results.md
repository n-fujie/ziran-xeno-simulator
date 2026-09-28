# Xeno-Body + Active Inference — Milestone 1 results (generated)

Planar Xeno-Body prototype (Walker2d-v5). Experiment 1, balance recovery; seeds 1–5 (paired: each seed has one trained base controller used by both modes) × 10 episodes per condition and mode. Values: mean over seeds [95% bootstrap interval over seeds]; B − A paired by seed. Claim status: synthetic-world result. Lateral impulses are not included: the embodiment is planar.

## forward|80N|noise0.0

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.74 [0.36, 0.98] | 0.78 [0.38, 1.0] | 0.04 [0.0, 0.12] | no difference established |
| max_posture_deviation | 0.7053 [0.3938, 0.8948] | 0.7494 [0.4496, 0.908] | 0.0441 [0.0029, 0.104] | B higher |
| recovered_fraction | 0.52 [0.16, 0.88] | 0.46 [0.08, 0.84] | -0.06 [-0.14, 0.0] | no difference established |
| recovery_latency_steps | 0.3 [0.0, 0.9] | 2.325 [0.0, 6.975] | 2.025 [0.0, 6.075] | no difference established |
| corrective_action_magnitude | 1.1748 [0.1542, 3.1125] | 1.5664 [0.443, 3.681] | 0.3915 [0.2042, 0.5822] | B higher |
| motor_effort | 70.2563 [37.3458, 118.4851] | 81.0967 [43.0311, 130.8262] | 10.8404 [2.739, 20.0686] | B higher |
| episode_return_secondary | 208.0497 [178.9201, 235.9168] | 201.2589 [173.2693, 228.6014] | -6.7908 [-11.0048, -2.5769] | B lower |

Prediction error (Mode B, 414 decisions): mean log loss 1.3, argmax hit rate 0.6135; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.264, "(0.0, 1.2)": 0.169, "(0.0, 1.0)": 0.153, "(0.1, 1.0)": 0.129, "(-0.1, 1.2)": 0.127, "(-0.1, 0.8)": 0.092, "(-0.1, 1.0)": 0.042, "(0.0, 0.8)": 0.024}

## forward|80N|noise0.05

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.7 [0.34, 0.96] | 0.8 [0.6, 0.96] | 0.1 [0.0, 0.26] | no difference established |
| max_posture_deviation | 0.6955 [0.4002, 0.8773] | 0.7703 [0.617, 0.8848] | 0.0749 [-0.0152, 0.2242] | no difference established |
| recovered_fraction | 0.52 [0.14, 0.9] | 0.52 [0.2, 0.82] | 0.0 [-0.12, 0.12] | no difference established |
| recovery_latency_steps | 0.225 [0.0, 0.675] | 0.9722 [0.0, 2.9167] | 0.7472 [0.0, 2.2417] | no difference established |
| corrective_action_magnitude | 7.04 [4.5859, 9.4941] | 7.3951 [4.9845, 9.8056] | 0.355 [0.1308, 0.5358] | B higher |
| motor_effort | 71.196 [38.3134, 120.0728] | 79.306 [45.0299, 127.2059] | 8.1099 [3.2908, 12.929] | B higher |
| episode_return_secondary | 208.9288 [179.6583, 237.6159] | 202.3007 [175.7095, 228.8919] | -6.6281 [-13.3285, 0.0723] | no difference established |

Prediction error (Mode B, 415 decisions): mean log loss 1.9398, argmax hit rate 0.3614; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.249, "(0.1, 1.0)": 0.139, "(-0.1, 1.2)": 0.139, "(0.0, 1.2)": 0.129, "(-0.1, 0.8)": 0.111, "(0.0, 1.0)": 0.106, "(0.0, 0.8)": 0.052, "(-0.1, 1.0)": 0.052, "(0.1, 0.8)": 0.024}

## forward|140N|noise0.0

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.84 [0.52, 1.0] | 0.92 [0.76, 1.0] | 0.08 [0.0, 0.24] | no difference established |
| max_posture_deviation | 0.8288 [0.674, 0.9086] | 0.8615 [0.7707, 0.91] | 0.0327 [-0.0006, 0.0972] | no difference established |
| recovered_fraction | 0.56 [0.16, 0.96] | 0.54 [0.14, 0.94] | -0.02 [-0.06, 0.0] | no difference established |
| recovery_latency_steps | 0.7417 [0.0, 2.125] | 1.7476 [0.0, 3.1] | 1.006 [0.0, 3.0] | no difference established |
| corrective_action_magnitude | 1.0486 [0.2424, 2.5495] | 1.523 [0.4815, 3.252] | 0.4744 [0.2146, 0.7341] | B higher |
| motor_effort | 67.0151 [36.2538, 107.1785] | 75.0651 [42.9099, 115.926] | 8.0501 [2.4607, 12.7858] | B higher |
| episode_return_secondary | 202.013 [170.0445, 233.9815] | 195.7049 [164.9769, 226.4329] | -6.3081 [-8.4708, -4.1454] | B lower |

Prediction error (Mode B, 415 decisions): mean log loss 1.5306, argmax hit rate 0.5663; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.217, "(0.1, 1.0)": 0.143, "(0.0, 1.2)": 0.143, "(-0.1, 1.2)": 0.138, "(0.0, 1.0)": 0.136, "(-0.1, 0.8)": 0.119, "(-0.1, 1.0)": 0.048, "(0.0, 0.8)": 0.031, "(0.1, 0.8)": 0.024}

## forward|140N|noise0.05

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.84 [0.56, 1.0] | 0.86 [0.62, 1.0] | 0.02 [-0.04, 0.08] | no difference established |
| max_posture_deviation | 0.8236 [0.663, 0.9056] | 0.8319 [0.6919, 0.9063] | 0.0083 [-0.0072, 0.0303] | no difference established |
| recovered_fraction | 0.56 [0.16, 0.96] | 0.52 [0.18, 0.86] | -0.04 [-0.18, 0.08] | no difference established |
| recovery_latency_steps | 0.45 [0.0, 1.25] | 0.4722 [0.0, 1.0] | 0.1796 [-0.6944, 1.2333] | no difference established |
| corrective_action_magnitude | 6.5009 [4.4459, 8.5559] | 6.7418 [4.7071, 8.7765] | 0.2409 [-0.2588, 0.6842] | no difference established |
| motor_effort | 67.355 [37.1889, 107.8007] | 74.3313 [43.7033, 118.4271] | 6.9763 [1.2979, 12.6793] | B higher |
| episode_return_secondary | 201.4726 [170.2034, 232.7419] | 194.4857 [166.3133, 222.658] | -6.987 [-14.6266, -2.1468] | B lower |

Prediction error (Mode B, 410 decisions): mean log loss 2.0753, argmax hit rate 0.3293; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.225, "(-0.1, 1.2)": 0.173, "(-0.1, 0.8)": 0.125, "(0.1, 1.0)": 0.118, "(0.0, 1.2)": 0.113, "(0.0, 1.0)": 0.086, "(0.0, 0.8)": 0.062, "(-0.1, 1.0)": 0.06, "(0.1, 0.8)": 0.038}

## forward|200N|noise0.0

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.9 [0.7, 1.0] | 0.88 [0.64, 1.0] | -0.02 [-0.06, 0.0] | no difference established |
| max_posture_deviation | 0.8734 [0.8066, 0.9085] | 0.8526 [0.7444, 0.9086] | -0.0208 [-0.0624, 0.0004] | no difference established |
| recovered_fraction | 0.54 [0.16, 0.92] | 0.48 [0.1, 0.86] | -0.06 [-0.18, 0.0] | no difference established |
| recovery_latency_steps | 0.4074 [0.0, 1.2222] | 1.2963 [0.0, 2.8889] | 0.8889 [0.0, 1.6667] | no difference established |
| corrective_action_magnitude | 0.9852 [0.3155, 2.2339] | 1.4172 [0.5597, 2.9019] | 0.432 [0.2177, 0.6524] | B higher |
| motor_effort | 61.1017 [34.6049, 97.0697] | 70.3083 [41.083, 108.0269] | 9.2067 [2.4283, 15.9851] | B higher |
| episode_return_secondary | 188.1789 [161.1682, 218.0229] | 185.6097 [158.9634, 215.0451] | -2.5692 [-4.8128, -0.0251] | B lower |

Prediction error (Mode B, 393 decisions): mean log loss 1.728, argmax hit rate 0.5165; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.223, "(-0.1, 1.2)": 0.163, "(0.0, 1.2)": 0.148, "(0.0, 1.0)": 0.13, "(0.1, 1.0)": 0.105, "(-0.1, 0.8)": 0.093, "(0.0, 0.8)": 0.07, "(-0.1, 1.0)": 0.055, "(0.1, 0.8)": 0.013}

## forward|200N|noise0.05

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.92 [0.76, 1.0] | 0.92 [0.76, 1.0] | 0.0 [0.0, 0.0] | no difference established |
| max_posture_deviation | 0.8749 [0.8077, 0.9116] | 0.8715 [0.8055, 0.907] | -0.0034 [-0.0048, -0.0021] | B lower |
| recovered_fraction | 0.58 [0.18, 0.98] | 0.48 [0.14, 0.82] | -0.1 [-0.28, 0.04] | no difference established |
| recovery_latency_steps | 1.0333 [0.0, 3.1] | 0.1187 [0.0, 0.2812] | -0.875 [-3.0, 0.375] | no difference established |
| corrective_action_magnitude | 5.6212 [3.8778, 7.3646] | 5.7385 [4.1178, 7.3592] | 0.1173 [-0.2893, 0.4491] | no difference established |
| motor_effort | 61.5215 [35.5009, 97.7382] | 67.9326 [39.6307, 106.5743] | 6.4111 [0.4557, 11.8576] | B higher |
| episode_return_secondary | 187.6985 [161.3871, 215.0339] | 181.8321 [157.9585, 208.0739] | -5.8664 [-8.6447, -3.4014] | B lower |

Prediction error (Mode B, 386 decisions): mean log loss 2.2558, argmax hit rate 0.2927; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.221, "(-0.1, 1.2)": 0.172, "(-0.1, 0.8)": 0.156, "(0.0, 1.2)": 0.118, "(0.0, 0.8)": 0.087, "(0.1, 1.0)": 0.082, "(0.0, 1.0)": 0.077, "(-0.1, 1.0)": 0.064, "(0.1, 0.8)": 0.023}

## backward|80N|noise0.0

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.94 [0.82, 1.0] | 0.86 [0.62, 1.0] | -0.08 [-0.36, 0.12] | no difference established |
| max_posture_deviation | 0.8579 [0.8034, 0.8927] | 0.8516 [0.8081, 0.8912] | -0.0063 [-0.055, 0.0347] | no difference established |
| recovered_fraction | 0.36 [0.0, 0.76] | 0.3 [0.0, 0.7] | -0.06 [-0.18, 0.0] | no difference established |
| recovery_latency_steps | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | no difference established |
| corrective_action_magnitude | 1.2344 [0.2103, 2.9452] | 1.4914 [0.4551, 3.1777] | 0.257 [0.1585, 0.3533] | B higher |
| motor_effort | 72.3244 [39.8826, 123.6751] | 82.6829 [47.0279, 128.6825] | 10.3585 [-0.8663, 22.7978] | no difference established |
| episode_return_secondary | 208.5077 [188.0218, 227.1226] | 208.4773 [184.7462, 232.0037] | -0.0304 [-10.5482, 11.2972] | no difference established |

Prediction error (Mode B, 434 decisions): mean log loss 1.4176, argmax hit rate 0.5806; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.254, "(0.0, 1.2)": 0.197, "(0.0, 1.0)": 0.17, "(0.1, 1.0)": 0.098, "(-0.1, 0.8)": 0.093, "(-0.1, 1.2)": 0.093, "(0.0, 0.8)": 0.061, "(-0.1, 1.0)": 0.034}

## backward|80N|noise0.05

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.92 [0.8, 1.0] | 0.86 [0.72, 0.98] | -0.06 [-0.22, 0.08] | no difference established |
| max_posture_deviation | 0.8623 [0.8181, 0.8931] | 0.8277 [0.7561, 0.886] | -0.0346 [-0.1087, 0.0361] | no difference established |
| recovered_fraction | 0.36 [0.0, 0.76] | 0.36 [0.1, 0.64] | 0.0 [-0.24, 0.24] | no difference established |
| recovery_latency_steps | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | no difference established |
| corrective_action_magnitude | 6.906 [5.3043, 8.6878] | 7.7497 [5.5077, 9.9917] | 0.8437 [-0.0919, 1.9048] | no difference established |
| motor_effort | 72.9357 [41.1419, 123.9836] | 82.7534 [45.7911, 132.8073] | 9.8177 [1.5651, 19.3883] | B higher |
| episode_return_secondary | 208.7471 [189.0564, 226.238] | 208.1172 [186.6717, 229.5628] | -0.6298 [-14.8289, 11.7459] | no difference established |

Prediction error (Mode B, 429 decisions): mean log loss 1.9544, argmax hit rate 0.3893; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.236, "(0.0, 1.2)": 0.158, "(0.0, 1.0)": 0.149, "(-0.1, 0.8)": 0.115, "(-0.1, 1.2)": 0.112, "(0.1, 1.0)": 0.092, "(0.0, 0.8)": 0.069, "(-0.1, 1.0)": 0.06, "(0.1, 0.8)": 0.009}

## backward|140N|noise0.0

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.86 [0.66, 1.0] | 0.92 [0.76, 1.0] | 0.06 [0.0, 0.14] | no difference established |
| max_posture_deviation | 0.8339 [0.7516, 0.8855] | 0.859 [0.8066, 0.893] | 0.0252 [-0.0061, 0.0615] | no difference established |
| recovered_fraction | 0.44 [0.08, 0.8] | 0.36 [0.02, 0.74] | -0.08 [-0.24, 0.08] | no difference established |
| recovery_latency_steps | 1.8333 [0.0, 5.5] | 2.3333 [0.0, 7.0] | 0.5 [0.0, 1.5] | no difference established |
| corrective_action_magnitude | 1.0285 [0.2566, 2.1822] | 1.2486 [0.506, 2.367] | 0.2201 [0.1444, 0.3011] | B higher |
| motor_effort | 68.1076 [40.5174, 111.2353] | 77.2428 [49.3736, 114.3997] | 9.1352 [-0.7734, 19.2158] | no difference established |
| episode_return_secondary | 204.5119 [181.2399, 227.7277] | 202.8428 [179.8151, 222.7783] | -1.6691 [-8.9892, 5.6509] | no difference established |

Prediction error (Mode B, 428 decisions): mean log loss 1.4058, argmax hit rate 0.6005; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.289, "(0.0, 1.2)": 0.176, "(0.0, 1.0)": 0.164, "(-0.1, 0.8)": 0.106, "(-0.1, 1.2)": 0.081, "(0.1, 1.0)": 0.076, "(0.0, 0.8)": 0.069, "(-0.1, 1.0)": 0.037}

## backward|140N|noise0.05

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.86 [0.66, 1.0] | 0.92 [0.84, 1.0] | 0.06 [-0.08, 0.22] | no difference established |
| max_posture_deviation | 0.8426 [0.7802, 0.8921] | 0.8384 [0.7833, 0.8926] | -0.0042 [-0.0636, 0.0493] | no difference established |
| recovered_fraction | 0.46 [0.08, 0.84] | 0.32 [0.1, 0.58] | -0.14 [-0.42, 0.14] | no difference established |
| recovery_latency_steps | 0.1667 [0.0, 0.5] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | no difference established |
| corrective_action_magnitude | 6.5979 [5.0415, 7.7214] | 7.2238 [5.5701, 8.5404] | 0.6259 [-0.1419, 1.455] | no difference established |
| motor_effort | 69.1184 [41.0404, 111.7387] | 77.9014 [47.6146, 119.917] | 8.7831 [1.7036, 16.1421] | B higher |
| episode_return_secondary | 205.7509 [182.559, 229.2264] | 203.3421 [184.3536, 214.4031] | -2.4088 [-16.1635, 11.2089] | no difference established |

Prediction error (Mode B, 426 decisions): mean log loss 1.9999, argmax hit rate 0.3826; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.253, "(0.0, 1.2)": 0.14, "(0.0, 1.0)": 0.133, "(-0.1, 0.8)": 0.126, "(-0.1, 1.2)": 0.114, "(0.1, 1.0)": 0.093, "(0.0, 0.8)": 0.077, "(-0.1, 1.0)": 0.056, "(0.1, 0.8)": 0.009}

## backward|200N|noise0.0

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.78 [0.42, 1.0] | 0.78 [0.54, 1.0] | 0.0 [-0.18, 0.18] | no difference established |
| max_posture_deviation | 0.793 [0.6482, 0.8806] | 0.7924 [0.6678, 0.8897] | -0.0006 [-0.0452, 0.035] | no difference established |
| recovered_fraction | 0.46 [0.08, 0.84] | 0.54 [0.14, 0.94] | 0.08 [-0.12, 0.36] | no difference established |
| recovery_latency_steps | 2.3333 [0.0, 7.0] | 3.2571 [0.0, 7.5714] | 0.9238 [0.0, 2.2] | no difference established |
| corrective_action_magnitude | 0.9768 [0.3742, 1.8831] | 1.1777 [0.5196, 2.0243] | 0.2009 [0.0739, 0.3352] | B higher |
| motor_effort | 65.3429 [39.7643, 105.1844] | 75.706 [46.7883, 108.9595] | 10.3631 [-0.7511, 21.4773] | no difference established |
| episode_return_secondary | 197.9747 [170.7988, 229.5461] | 201.2243 [173.348, 229.9851] | 3.2496 [-2.7425, 9.2156] | no difference established |

Prediction error (Mode B, 413 decisions): mean log loss 1.4373, argmax hit rate 0.586; Mode A: not applicable. Policy distribution (Mode B, share of decisions): {"(0.1, 1.2)": 0.311, "(0.0, 1.2)": 0.16, "(0.0, 1.0)": 0.153, "(-0.1, 0.8)": 0.134, "(0.1, 1.0)": 0.08, "(-0.1, 1.2)": 0.068, "(0.0, 0.8)": 0.061, "(-0.1, 1.0)": 0.031}

## backward|200N|noise0.05

| metric | Mode A | Mode B | B − A | interval |
|---|---|---|---|---|
| fall_rate | 0.76 [0.36, 1.0] | 0.84 [0.56, 1.0] | 0.08 [0.0, 0.2] | no difference established |
| max_posture_deviation | 0.783 [0.6117, 0.8875] | 0.7906 [0.6266, 0.8933] | 0.0076 [0.0011, 0.0147] | B higher |
| recovered_fraction | 0.48 [0.08, 0.88] | 0.52 [0.2, 0.82] | 0.04 [-0.16, 0.26] | no difference established |
| recovery_latency_steps | 1.7 [0.0, 5.1] | 3.5516 [0.0, 7.1032] | 3.0354 [0.0, 6.4286] | no difference established |
| corrective_action_magnitude | 6.2295 [4.5643, 8.124] | 7.1987 [5.2114, 9.1761] | 0.9692 [0.5732, 1.4981] | B higher |
| motor_effort | 66.2476 [40.5465, 105.7797] | 76.6208 [48.5215, 112.6041] | 10.3732 [3.0475, 17.6989] | B higher |
| episode_return_secondary | 199.2338 [171.5385, 230.6041] | 203.9034 [178.3295, 229.4772] | 4.6696 [0.0658, 9.1105] | B higher |

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
| A | observation_adaptation | 121597 | 0.00854 | 0.01733 | 11.71271 |
| A | layer0_fast_control | 121597 | 0.47621 | 0.96737 | 389.10175 |
| A | controller_step_total | 121597 | 0.48733 | 0.99234 | 389.12613 |
| B | observation_adaptation | 120018 | 0.00892 | 0.01812 | 5.51179 |
| B | latent_state_inference | 5068 | 0.05342 | 0.08003 | 8.43675 |
| B | vfe | 5068 | 0.01733 | 0.02539 | 4.41779 |
| B | efe_preference | 5068 | 0.04179 | 0.07818 | 4.82358 |
| B | efe_epistemic | 5068 | 1.39244 | 2.45844 | 21.27904 |
| B | efe_total | 5068 | 1.72154 | 3.06953 | 47.047 |
| B | policy_selection | 5068 | 0.02367 | 0.0379 | 3.98858 |
| B | aif_decision_total | 5068 | 1.8575 | 3.31313 | 47.23725 |
| B | layer0_fast_control | 120018 | 0.49517 | 1.0926 | 389.74725 |
| B | controller_step_total | 120018 | 0.511 | 2.06198 | 389.77342 |
| B | controller_step_with_decision | 5068 | 2.497 | 4.47266 | 54.15221 |

## Active Inference decision budget

| budget | median below | p95 below | max below |
|---|---|---|---|
| < 200 ms | True | True | True |
| < 100 ms | True | True | True |
| < 50 ms | True | True | True |
| < 10 ms | True | True | False |
