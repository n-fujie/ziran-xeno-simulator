// Preset library. Areas are descriptive groupings for the interface, not ontological partitions.
import { registerPreset, listPresets } from '../core/experiment.ts';
import { FOUNDATION_PRESETS } from '../domains/foundations.ts';
import { PHYSICAL_PRESETS } from '../domains/physical.ts';
import { BODY_PRESETS } from '../domains/body.ts';
import { SCIENCE_PRESETS } from '../domains/science.ts';
import { INSTITUTION_PRESETS } from '../domains/institution.ts';
import { MARKET_PRESETS } from '../domains/market.ts';
import { THOUGHT_PRESETS } from '../domains/thought.ts';
import { AI_PRESETS } from '../domains/ai.ts';
import { HYBRID_PRESETS } from '../domains/hybrid.ts';
import { CIVILIZATION_PRESETS } from '../domains/civilization.ts';
import { OPEN_PRESETS } from '../domains/open.ts';
import { META_PRESETS } from '../domains/meta-worlds.ts';

let done = false;
export function ensurePresets(): void {
  if (done) return;
  done = true;
  for (const p of [...OPEN_PRESETS, ...META_PRESETS, ...FOUNDATION_PRESETS, ...PHYSICAL_PRESETS, ...BODY_PRESETS, ...SCIENCE_PRESETS, ...INSTITUTION_PRESETS,
    ...MARKET_PRESETS, ...THOUGHT_PRESETS, ...AI_PRESETS, ...HYBRID_PRESETS, ...CIVILIZATION_PRESETS]) registerPreset(p);
}

export { listPresets };
