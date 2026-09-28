# Xeno-Body + Active Inference — Milestone 1 results (generated)

Experiment 1, balance recovery on Walker2d-v5; 5 seeds × 10 episodes per condition and mode; Mode A = existing Xeno-Body controller, Mode B = the same controller with the Active Inference layer. Values: mean over seeds [95% bootstrap interval]; B − A paired by seed. Claim status: synthetic-world result.

| condition | metric | Mode A | Mode B | B − A |
|---|---|---|---|---|
| forward|80N|noise0.0 | fell | 0.74 [0.36, 0.98] | 0.78 [0.38, 1.0] | 0.04 [0.0, 0.12] |
| forward|80N|noise0.0 | max_axis_deviation | 0.7053 [0.3938, 0.8948] | 0.7494 [0.4488, 0.908] | 0.0441 [0.0034, 0.1049] |
| forward|80N|noise0.0 | recovered | 0.52 [0.16, 0.88] | 0.46 [0.08, 0.84] | -0.06 [-0.14, 0.0] |
| forward|80N|noise0.0 | recovery_steps | 0.3 [0.0, 0.9] | 2.325 [0.0, 6.975] | 2.025 [0.0, 6.075] |
| forward|80N|noise0.0 | corrective_movement | 1.1748 [0.1542, 3.1125] | 1.5664 [0.443, 3.6844] | 0.3915 [0.2042, 0.5822] |
| forward|80N|noise0.0 | motor_effort | 70.2563 [37.3458, 118.4851] | 81.0967 [43.0311, 130.8262] | 10.8404 [2.739, 20.0686] |
| forward|80N|noise0.05 | fell | 0.7 [0.34, 0.96] | 0.8 [0.6, 0.96] | 0.1 [0.0, 0.26] |
| forward|80N|noise0.05 | max_axis_deviation | 0.6955 [0.3995, 0.8773] | 0.7703 [0.6176, 0.8848] | 0.0749 [-0.0152, 0.2243] |
| forward|80N|noise0.05 | recovered | 0.52 [0.14, 0.9] | 0.52 [0.2, 0.82] | 0.0 [-0.12, 0.12] |
| forward|80N|noise0.05 | recovery_steps | 0.225 [0.0, 0.675] | 0.9722 [0.0, 2.9167] | 0.7472 [0.0, 2.2417] |
| forward|80N|noise0.05 | corrective_movement | 7.04 [4.5859, 9.4941] | 7.3951 [4.9845, 9.8056] | 0.355 [0.1308, 0.5413] |
| forward|80N|noise0.05 | motor_effort | 71.196 [38.3134, 120.0728] | 79.306 [45.0299, 127.2059] | 8.1099 [3.2908, 12.929] |
| forward|140N|noise0.0 | fell | 0.84 [0.52, 1.0] | 0.92 [0.76, 1.0] | 0.08 [0.0, 0.24] |
| forward|140N|noise0.0 | max_axis_deviation | 0.8288 [0.674, 0.9086] | 0.8615 [0.7707, 0.91] | 0.0327 [-0.0006, 0.0972] |
| forward|140N|noise0.0 | recovered | 0.56 [0.16, 0.96] | 0.54 [0.14, 0.94] | -0.02 [-0.06, 0.0] |
| forward|140N|noise0.0 | recovery_steps | 0.7417 [0.0, 2.125] | 1.7476 [0.0, 3.1] | 1.006 [0.0, 3.0] |
| forward|140N|noise0.0 | corrective_movement | 1.0486 [0.2442, 2.5367] | 1.523 [0.4815, 3.252] | 0.4744 [0.2146, 0.7341] |
| forward|140N|noise0.0 | motor_effort | 67.0151 [36.2538, 107.1785] | 75.0651 [42.9099, 115.9857] | 8.0501 [2.4607, 12.7858] |
| forward|140N|noise0.05 | fell | 0.84 [0.56, 1.0] | 0.86 [0.62, 1.0] | 0.02 [-0.04, 0.08] |
| forward|140N|noise0.05 | max_axis_deviation | 0.8236 [0.6631, 0.9056] | 0.8319 [0.6919, 0.9063] | 0.0083 [-0.0072, 0.0303] |
| forward|140N|noise0.05 | recovered | 0.56 [0.16, 0.96] | 0.52 [0.18, 0.86] | -0.04 [-0.18, 0.08] |
| forward|140N|noise0.05 | recovery_steps | 0.45 [0.0, 1.25] | 0.4722 [0.0, 1.0] | 0.1796 [-0.6944, 1.2333] |
| forward|140N|noise0.05 | corrective_movement | 6.5009 [4.4459, 8.5559] | 6.7418 [4.7071, 8.7765] | 0.2409 [-0.2588, 0.6842] |
| forward|140N|noise0.05 | motor_effort | 67.355 [37.1889, 107.8007] | 74.3313 [43.7033, 118.4271] | 6.9763 [1.2732, 12.6793] |
| forward|200N|noise0.0 | fell | 0.9 [0.7, 1.0] | 0.88 [0.64, 1.0] | -0.02 [-0.06, 0.0] |
| forward|200N|noise0.0 | max_axis_deviation | 0.8734 [0.8064, 0.9085] | 0.8526 [0.7445, 0.9086] | -0.0208 [-0.0623, 0.0005] |
| forward|200N|noise0.0 | recovered | 0.54 [0.16, 0.92] | 0.48 [0.1, 0.86] | -0.06 [-0.18, 0.0] |
| forward|200N|noise0.0 | recovery_steps | 0.4074 [0.0, 1.2222] | 1.2963 [0.0, 2.8889] | 0.8889 [0.0, 1.6667] |
| forward|200N|noise0.0 | corrective_movement | 0.9852 [0.3155, 2.2339] | 1.4172 [0.5597, 2.9019] | 0.432 [0.2177, 0.6836] |
| forward|200N|noise0.0 | motor_effort | 61.1017 [34.6049, 97.0697] | 70.3083 [41.083, 108.0269] | 9.2067 [2.4283, 15.9851] |
| forward|200N|noise0.05 | fell | 0.92 [0.76, 1.0] | 0.92 [0.76, 1.0] | 0.0 [0.0, 0.0] |
| forward|200N|noise0.05 | max_axis_deviation | 0.8749 [0.8071, 0.9116] | 0.8715 [0.8049, 0.9071] | -0.0034 [-0.0048, -0.0021] |
| forward|200N|noise0.05 | recovered | 0.58 [0.18, 0.98] | 0.48 [0.14, 0.82] | -0.1 [-0.26, 0.04] |
| forward|200N|noise0.05 | recovery_steps | 1.0333 [0.0, 3.1] | 0.1187 [0.0, 0.2812] | -0.875 [-3.0, 0.375] |
| forward|200N|noise0.05 | corrective_movement | 5.6212 [3.8778, 7.3646] | 5.7385 [4.1178, 7.3592] | 0.1173 [-0.2893, 0.4491] |
| forward|200N|noise0.05 | motor_effort | 61.5215 [35.5009, 97.7382] | 67.9326 [39.6307, 106.5871] | 6.4111 [0.4557, 11.8576] |
| backward|80N|noise0.0 | fell | 0.94 [0.82, 1.0] | 0.86 [0.62, 1.0] | -0.08 [-0.36, 0.12] |
| backward|80N|noise0.0 | max_axis_deviation | 0.8579 [0.8023, 0.8927] | 0.8516 [0.8081, 0.8912] | -0.0063 [-0.0541, 0.0347] |
| backward|80N|noise0.0 | recovered | 0.36 [0.0, 0.76] | 0.3 [0.0, 0.7] | -0.06 [-0.18, 0.0] |
| backward|80N|noise0.0 | recovery_steps | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| backward|80N|noise0.0 | corrective_movement | 1.2344 [0.2103, 2.9452] | 1.4914 [0.4551, 3.1777] | 0.257 [0.1585, 0.3555] |
| backward|80N|noise0.0 | motor_effort | 72.3244 [39.8826, 124.5773] | 82.6829 [47.0279, 128.6825] | 10.3585 [-0.7389, 23.617] |
| backward|80N|noise0.05 | fell | 0.92 [0.8, 1.0] | 0.86 [0.72, 0.98] | -0.06 [-0.22, 0.08] |
| backward|80N|noise0.05 | max_axis_deviation | 0.8623 [0.8181, 0.8931] | 0.8277 [0.7561, 0.886] | -0.0346 [-0.1152, 0.0361] |
| backward|80N|noise0.05 | recovered | 0.36 [0.0, 0.76] | 0.36 [0.12, 0.64] | 0.0 [-0.22, 0.22] |
| backward|80N|noise0.05 | recovery_steps | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| backward|80N|noise0.05 | corrective_movement | 6.906 [5.3024, 8.6878] | 7.7497 [5.5077, 9.9917] | 0.8437 [-0.0919, 2.0003] |
| backward|80N|noise0.05 | motor_effort | 72.9357 [41.1419, 123.3535] | 82.7534 [45.9972, 132.8073] | 9.8177 [1.5651, 19.3883] |
| backward|140N|noise0.0 | fell | 0.86 [0.66, 1.0] | 0.92 [0.76, 1.0] | 0.06 [0.0, 0.14] |
| backward|140N|noise0.0 | max_axis_deviation | 0.8339 [0.7516, 0.8855] | 0.859 [0.8058, 0.893] | 0.0252 [-0.0061, 0.0615] |
| backward|140N|noise0.0 | recovered | 0.44 [0.08, 0.8] | 0.36 [0.02, 0.74] | -0.08 [-0.24, 0.08] |
| backward|140N|noise0.0 | recovery_steps | 1.8333 [0.0, 5.5] | 2.3333 [0.0, 7.0] | 0.5 [0.0, 1.5] |
| backward|140N|noise0.0 | corrective_movement | 1.0285 [0.2566, 2.182] | 1.2486 [0.506, 2.2328] | 0.2201 [0.1383, 0.3011] |
| backward|140N|noise0.0 | motor_effort | 68.1076 [40.5174, 111.2353] | 77.2428 [49.1577, 114.3997] | 9.1352 [-0.4994, 19.2668] |
| backward|140N|noise0.05 | fell | 0.86 [0.66, 1.0] | 0.92 [0.84, 1.0] | 0.06 [-0.08, 0.22] |
| backward|140N|noise0.05 | max_axis_deviation | 0.8426 [0.7802, 0.8915] | 0.8384 [0.7833, 0.8926] | -0.0042 [-0.0636, 0.0493] |
| backward|140N|noise0.05 | recovered | 0.46 [0.08, 0.84] | 0.32 [0.1, 0.58] | -0.14 [-0.42, 0.14] |
| backward|140N|noise0.05 | recovery_steps | 0.1667 [0.0, 0.5] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| backward|140N|noise0.05 | corrective_movement | 6.5979 [5.0415, 7.7214] | 7.2238 [5.5608, 8.5404] | 0.6259 [-0.1639, 1.455] |
| backward|140N|noise0.05 | motor_effort | 69.1184 [40.926, 111.7387] | 77.9014 [47.6146, 119.917] | 8.7831 [1.7036, 16.1421] |
| backward|200N|noise0.0 | fell | 0.78 [0.42, 1.0] | 0.78 [0.54, 1.0] | 0.0 [-0.18, 0.18] |
| backward|200N|noise0.0 | max_axis_deviation | 0.793 [0.6481, 0.8806] | 0.7924 [0.6679, 0.8897] | -0.0006 [-0.0444, 0.035] |
| backward|200N|noise0.0 | recovered | 0.46 [0.08, 0.84] | 0.54 [0.14, 0.94] | 0.08 [-0.12, 0.36] |
| backward|200N|noise0.0 | recovery_steps | 2.3333 [0.0, 7.0] | 3.2571 [0.0, 7.5714] | 0.9238 [0.0, 2.2] |
| backward|200N|noise0.0 | corrective_movement | 0.9768 [0.3742, 1.8831] | 1.1777 [0.5196, 2.0243] | 0.2009 [0.0739, 0.3352] |
| backward|200N|noise0.0 | motor_effort | 65.3429 [38.9699, 104.4098] | 75.706 [46.7883, 108.9595] | 10.3631 [-0.7511, 21.4773] |
| backward|200N|noise0.05 | fell | 0.76 [0.36, 1.0] | 0.84 [0.56, 1.0] | 0.08 [0.0, 0.2] |
| backward|200N|noise0.05 | max_axis_deviation | 0.783 [0.6117, 0.8875] | 0.7906 [0.6266, 0.8933] | 0.0076 [0.0011, 0.0147] |
| backward|200N|noise0.05 | recovered | 0.48 [0.08, 0.88] | 0.52 [0.22, 0.82] | 0.04 [-0.16, 0.26] |
| backward|200N|noise0.05 | recovery_steps | 1.7 [0.0, 5.1] | 3.5516 [0.0, 7.1032] | 3.0354 [0.0, 6.4286] |
| backward|200N|noise0.05 | corrective_movement | 6.2295 [4.5643, 8.124] | 7.1987 [5.2114, 9.1776] | 0.9692 [0.5901, 1.4981] |
| backward|200N|noise0.05 | motor_effort | 66.2476 [40.5465, 104.6411] | 76.6208 [46.7275, 110.7422] | 10.3732 [3.0475, 17.6989] |

## Latency by layer (ms, mean of per-episode means / p95 / max)

| mode | layer | mean | p95 | max |
|---|---|---|---|---|
| A | layer1_state_estimation | 0.03438 | 0.05819 | 9.52454 |
| A | layer0_fast_control | 0.64605 | 1.11122 | 166.36163 |
| B | layer1_state_estimation | 0.03498 | 0.05601 | 13.36975 |
| B | layer2_active_inference | 2.06093 | 2.35722 | 35.10787 |
| B | layer0_fast_control | 0.65903 | 1.13835 | 130.82621 |

Mode B policy usage (episodes in which a configuration was chosen at least once): {"(0.1, 1.2)": 348, "(0.0, 1.0)": 324, "(0.1, 1.0)": 320, "(-0.1, 0.8)": 303, "(-0.1, 1.2)": 303, "(0.0, 1.2)": 237, "(-0.1, 1.0)": 203, "(0.0, 0.8)": 196, "(0.1, 0.8)": 46}

Calibration (Mode B only): [{"transitions": 482, "seconds": 8.5, "episodes": 60}, {"transitions": 530, "seconds": 9.8, "episodes": 60}, {"transitions": 468, "seconds": 8.3, "episodes": 60}, {"transitions": 488, "seconds": 9.0, "episodes": 60}, {"transitions": 535, "seconds": 10.4, "episodes": 60}]
