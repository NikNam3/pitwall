// The AI-difficulty bands of `race-interaction` (SP4.3a spec 5.4, 5.5, T4) and each band's default curve: the one rule
// the calculator and the priors entries both use (C43).
import type { EstimateSource, PassCurve } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { RACE_INTERACTION_CONFIG, type RaceInteractionConfig } from './config.ts';

/** One band: the AI difficulties it covers, inclusive. */
export type DifficultyBand = { fromDifficulty: number; toDifficulty: number };

/** The bands of `difficultyBands` (`from-to` inclusive, comma-separated), in order; a malformed entry is a config bug (C3). */
export function parseBands(spec: string): DifficultyBand[] {
  return spec.split(',').map((part) => {
    const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part);
    if (match === null) throw new Error(`race-interaction: difficultyBands entry "${part}" is not "from-to"`);
    return { fromDifficulty: Number(match[1]), toDifficulty: Number(match[2]) };
  });
}

/** The index of the band covering `difficulty`, else -1. */
export const bandIndexOf = (bands: readonly DifficultyBand[], difficulty: number): number =>
  bands.findIndex((b) => b.fromDifficulty <= difficulty && difficulty <= b.toDifficulty);

/** The effective config from a view's or a priors context's config record (C47). */
export const configOf = (config: EngineView['config']): RaceInteractionConfig => ({
  ...RACE_INTERACTION_CONFIG.defaults,
  ...config[RACE_INTERACTION_CONFIG.key],
});

/** The config's default pass curve: every band's prior without a calibration entry. */
export const defaultCurve = (config: RaceInteractionConfig): PassCurve => ({
  level: config.passLevel,
  slopePerMs: config.passSlopePerMs,
  cap: config.passCap,
  wetFactor: config.wetFactor,
});

/** The source of the config's default curve. */
export const DEFAULT_SOURCE: EstimateSource = {
  kind: 'default',
  note: 'race-interaction config (placeholder until the pooled fit)',
  sessionShare: 0,
  parts: 'default',
};
