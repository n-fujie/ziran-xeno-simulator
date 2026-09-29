"""Xeno-14 principle registry.

Canonical names and operational definitions come from the existing specification in
src/domains/body.ts (XENO14). Names used in the X14-1 request are recorded as aliases; nothing is renamed.
The principles are starting hypotheses: each may ignite, fail to ignite, split, merge, conflict, become redundant,
become embodiment-specific or disappear. Only three are implemented in X14-1.
"""
from dataclasses import dataclass, field

# canonical (src/domains/body.ts)  ->  alias used in the X14-1 request
CANONICAL = [
    ("lower-abdominal-continuity", "lower-center persistence"),
    ("whole-skin-sensing", "whole-surface sensing"),
    ("axis-maintenance", "axial maintenance"),
    ("endpoint-removal", "terminal-point removal"),
    ("low-noise-movement", "low-noise movement"),
    ("minimal-approach-distance", "upward abdominal organization / minimum-distance action (alias mapping uncertain)"),
    ("zero-run-up-transition", "minimum-distance / zero-run-up action"),
    ("tensegrity", "tensegrity-like distributed organization"),
    ("slow-movement", "slow-control / locomotor coordination"),
    ("narrow-step-balance", "narrow-step balance"),
    ("fingertip-tension", "distal / fingertip tension"),
    ("breathing-synchronization", "respiration-action synchronization"),
    ("anti-collapse-posture", "anti-slouch / postural organization"),
    ("long-duration-sedimentation", "long-horizon bodily deposition"),
]


@dataclass
class Principle:
    canonical: str
    alias: str
    status: str                       # 'implemented-X14-1' | 'not-implemented'
    source_definition: str = ""       # operational definition in src/domains/body.ts (paraphrased)
    walker2d_operationalization: str = ""
    ignition: str = ""
    organization_metric: str = ""
    transfer_note: str = ""
    extra: dict = field(default_factory=dict)


IMPLEMENTED = {
    "axis-maintenance": Principle(
        "axis-maintenance", "axial maintenance", "implemented-X14-1",
        source_definition="ignites when |body axis| > 0.02; adds a lean correction proportional to the axis to every segment; costs energy",
        walker2d_operationalization="module proposing joint torques from torso pitch and pitch rate",
        ignition="learned sigmoid gate on |torso pitch| and |pitch rate|",
        organization_metric="mean torso pitch² over surviving steps (lower = better axis maintenance)",
        transfer_note="changes operationalization: the 5-segment lean stack becomes a single torso pitch plus hip/knee/ankle joints"),
    "lower-abdominal-continuity": Principle(
        "lower-abdominal-continuity", "lower-center persistence", "implemented-X14-1",
        source_definition="maintains a lower-abdominal tension ≥ 0.6 that is coupled to the tension (stiffness) of every segment; tonic, slow clock; costs energy",
        walker2d_operationalization="tonic module proposing joint torques from torso height deviation and joint angles (lower-body stiffness)",
        ignition="learned sigmoid gate with a tonic bias term (may stay on)",
        organization_metric="mean (torso height − initial height)² over surviving steps",
        transfer_note="changes operationalization: 'tension' becomes torque-level stiffness; there is no abdominal state in Walker2d"),
    "low-noise-movement": Principle(
        "low-noise-movement", "low-noise movement", "implemented-X14-1",
        source_definition="ignites when an external push is registered; damps the push and reduces lean",
        walker2d_operationalization="module proposing damping torques from joint velocities",
        ignition="learned sigmoid gate on the magnitude of joint and torso angular velocities (disturbance proxy)",
        organization_metric="mean squared action change ‖a_t − a_{t−1}‖² (jerk proxy)",
        transfer_note="changes operationalization: 'push registered' becomes a velocity-magnitude proxy; no push sensor is given to any controller"),
}


def registry() -> list[Principle]:
    out = []
    for canon, alias in CANONICAL:
        out.append(IMPLEMENTED.get(canon) or Principle(canon, alias, "not-implemented"))
    return out
