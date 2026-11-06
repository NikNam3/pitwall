// `degradation`'s declared fallbacks (SP4.1a fx3, ruling R35; C43, C62a, C62b): per priors key the value a run uses
// when its snapshot has none, with its default source, the one rule the calculator's default start and the
// calibration panel's `ᵈ` values both read. Per key (ν, its sd, the α offset) a stint starts from the snapshot's entry
// when it is known, else from that key's declared fallback (ruling R41). The calculator runs through its guarded view
// (C41); priors passed explicitly (C84).
import { carId, known, unknown, type LapRecord, type VisualCompound } from '@pitwall/domain';
import type { EngineView, FallbackCtx, PriorDecl } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION_CONFIG, DEGRADATION_PRIORS, type StintDegradation } from '../../src/degradation/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { guardedQuick, situatedView } from '../situated.ts';
import { priorsSnapshot, stintLaps, viewPriors } from './support.ts';

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

describe('degradation start per key: the snapshot`s entry when known, else the key`s fallback (R41)', () => {
  type Key = 'nuMsPerLap' | 'nuSdMs' | 'alphaOffsetMs';
  const KEYS: readonly Key[] = ['nuMsPerLap', 'nuSdMs', 'alphaOffsetMs'];
  const SNAPSHOT_VALUE = { nuMsPerLap: 40, nuSdMs: 20, alphaOffsetMs: -300 } as const;
  /** A soft snapshot of set "Zandvoort long runs" (`SNAPSHOT_VALUE`), each key in `unknownKeys` unknown. */
  const softSnapshot = (unknownKeys: readonly Key[]) => {
    const snapshot = priorsSnapshot({ soft: SNAPSHOT_VALUE });
    for (const k of unknownKeys) snapshot.entries[`degradation.${k}.soft`] = unknown('insufficientData');
    return snapshot;
  };
  /** Car 0's one soft stint (laps 1..2: lap 2 its only pace lap) with the Zandvoort track file and `priors`. */
  const stintWith = (priors: EngineView['priors']): { stint: StintDegradation; ctx: FallbackCtx } => {
    const laps = stintLaps({ from: 1, to: 2 });
    const v = situatedView({ cars: [carState()], history: { laps }, track: known(track, 0), priors });
    const stint = calc.compute(v)[carId(0)]?.[0];
    if (stint === undefined) throw new Error('no stint for car 0');
    return { stint, ctx: { config: v.config, track: v.track } };
  };
  /** The start field of key `k` when the snapshot leaves it unknown: the key's declared fallback. */
  const fallbackStart = (k: Key, ctx: FallbackCtx): unknown => {
    const value = fallbackOf(`degradation.${k}.soft`)(ctx).value;
    if (k === 'alphaOffsetMs') return value;
    if (!value.known) throw new Error(`the fallback of ${k} is unknown`);
    return value.value;
  };
  /** The start field of key `k` when the snapshot holds it. */
  const snapshotStart = (k: Key): unknown => (k === 'alphaOffsetMs' ? known(SNAPSHOT_VALUE[k], 0) : SNAPSHOT_VALUE[k]);

  it.each<[string, readonly Key[]]>([
    ['the α offset unknown (soft sources, no medium source)', ['alphaOffsetMs']],
    ['an override of ν alone: its sd and the α offset unknown', ['nuSdMs', 'alphaOffsetMs']],
    ['an override of ν`s sd alone: ν and the α offset unknown', ['nuMsPerLap', 'alphaOffsetMs']],
    ['ν unknown, its sd and the α offset known', ['nuMsPerLap']],
    ['ν`s sd unknown, ν and the α offset known', ['nuSdMs']],
  ])('a key the snapshot leaves unknown starts from that key`s fallback, source calibration (%s)', (_, unknownKeys) => {
    const { stint, ctx } = stintWith(viewPriors(softSnapshot(unknownKeys)));
    // the fixture's fallback differs from the snapshot on every key, so each assertion tells them apart
    for (const k of KEYS) expect(fallbackStart(k, ctx), k).not.toEqual(snapshotStart(k));
    for (const k of KEYS) expect(stint.startPrior[k], k).toEqual(unknownKeys.includes(k) ? fallbackStart(k, ctx) : snapshotStart(k));
    // at least one key came from the snapshot: the start's source is the set, and so the stint's estimate's
    expect(stint.startPrior.source).toMatchObject({ kind: 'calibration', setName: 'Zandvoort long runs', sources: 3, sessionShare: 0 });
    expect(stint.source).toMatchObject({ kind: 'calibration', setName: 'Zandvoort long runs', parts: '1 lap + calibration' });
  });

  it('an override of ν alone is used, its sd from the fallback', () => {
    const { stint, ctx } = stintWith(viewPriors(softSnapshot(['nuSdMs', 'alphaOffsetMs'])));
    const sd = fallbackOf('degradation.nuSdMs.soft')(ctx).value;
    if (!sd.known) throw new Error('the fallback of ν`s sd is unknown');
    expect(stint.startPrior.nuMsPerLap).toBe(SNAPSHOT_VALUE.nuMsPerLap);
    expect(stint.startPrior.nuSdMs).toBe(sd.value);
    // the filter started from it: with one pace lap ν stays at the override, not at the config default
    if (!stint.nuMsPerLap.known) throw new Error('ν is unknown');
    expect(Math.abs(stint.nuMsPerLap.value - SNAPSHOT_VALUE.nuMsPerLap)).toBeLessThan(1);
  });

  it('with no key from the snapshot the start and its source are the default`s', () => {
    const { stint, ctx } = stintWith(viewPriors(softSnapshot(KEYS)));
    for (const k of KEYS) expect(stint.startPrior[k], k).toEqual(fallbackStart(k, ctx));
    expect(stint.startPrior.source).toEqual(fallbackOf('degradation.nuMsPerLap.soft')(ctx).source);
    expect(stint.source).toMatchObject({ kind: 'default', parts: '1 lap + default' });
  });
});
