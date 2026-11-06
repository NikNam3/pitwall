// `degradation`'s declared fallbacks (SP4.1a fx3, ruling R35; C43, C62a, C62b): per priors key the value a run uses
// when its snapshot has none, with its default source, the one rule the calculator's default start and the
// calibration panel's `ᵈ` values both read. The calculator runs through its guarded view (C41); no priors (C84).
import { carId, known, unknown, type LapRecord, type VisualCompound } from '@pitwall/domain';
import type { EngineView, FallbackCtx, PriorDecl } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION_CONFIG, DEGRADATION_PRIORS, type StintDegradation } from '../../src/degradation/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { guardedQuick, situatedView } from '../situated.ts';
import { stintLaps } from './support.ts';

const calc = guardedQuick(degradationCalculator);

const fallbackOf = (key: string): NonNullable<PriorDecl['fallback']> => {
  const fallback = DEGRADATION_PRIORS.entries[key]?.fallback;
  if (fallback === undefined) throw new Error(`${key} declares no fallback`);
  return fallback;
};

/** The start of car 0's one stint on `visual` without priors (laps 1..2: lap 2 its only pace lap). */
const startOf = (visual: VisualCompound, track: EngineView['track'], config: EngineView['config']): StintDegradation['startPrior'] => {
  const laps: LapRecord[] = stintLaps({ from: 1, to: 2, visual, actual: visual === 'inter' ? 'inter' : 'C3' });
  const stint = calc.compute(situatedView({ cars: [carState()], history: { laps }, track, config }))[carId(0)]?.[0];
  if (stint === undefined) throw new Error('no stint for car 0');
  return stint.startPrior;
};

const track = zandvoortTrack();
if (!track.defaults.compoundOffsetsMs.known) throw new Error('the Zandvoort fixture has compound offsets');

const TRACKS: [string, VisualCompound, EngineView['track']][] = [
  ['soft, the track file holding its offset', 'soft', known(track, 0)],
  ['inter, the track file holding no offset for it', 'inter', known(track, 0)],
  ['soft, no track file', 'soft', unknown('notApplicable')],
];
const CONFIGS: [string, EngineView['config']][] = [
  ['the config defaults', {}],
  ['an overridden config', { [DEGRADATION_CONFIG.key]: { defaultNuMsPerLap: 70, defaultNuSdMs: 30 } }],
];

describe('degradation fallback (R35)', () => {
  describe.each(TRACKS)('%s', (_, visual, trackOf) => {
    it.each(CONFIGS)('the declared fallback equals the default the calculator uses (%s)', (_name, config) => {
      const start = startOf(visual, trackOf, config);
      const ctx: FallbackCtx = { config, track: trackOf };
      const nu = fallbackOf(`degradation.nuMsPerLap.${visual}`)(ctx);
      const sd = fallbackOf(`degradation.nuSdMs.${visual}`)(ctx);
      const alpha = fallbackOf(`degradation.alphaOffsetMs.${visual}`)(ctx);
      // the values the stint started from
      expect(nu.value).toMatchObject({ known: true, value: start.nuMsPerLap });
      expect(sd.value).toMatchObject({ known: true, value: start.nuSdMs });
      expect(alpha.value).toEqual(start.alphaOffsetMs);
      // with the default source the stint started from (kind `default`, its note, no session share)
      expect(start.source.kind).toBe('default');
      expect(nu.source).toEqual(start.source);
      expect(sd.source).toEqual(start.source);
      expect(alpha.source).toEqual(start.source);
    });
  });

  it('a key without a default declares no fallback', () => {
    // every key of `degradation` has a run-time default: ν and its sd the config's, the α offset the track file's (or
    // unknown without one), so none declares none
    const without = Object.entries(DEGRADATION_PRIORS.entries).filter(([, decl]) => decl.fallback === undefined).map(([key]) => key);
    expect(without).toEqual([]);
  });
});
