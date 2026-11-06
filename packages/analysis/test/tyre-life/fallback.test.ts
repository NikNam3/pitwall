// `tyre-life`'s declared fallbacks (SP4.1a fx3, ruling R35; C43, C62a, C47): the set's limits fall back to the unit's
// config (the value a run uses unless the set overrides it), with a default source; the wear rates have no run-time
// default (a fresh set's life falls back to `ν`, not to a rate), so they declare none. The calculator runs through its
// guarded view (C41); `degradation`'s output and the priors are passed explicitly (C84).
import { carId, known, unknown, type Corners, type Percent } from '@pitwall/domain';
import type { EngineView, FallbackCtx, PriorDecl } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { AGE_LOSS_LIMIT_KEY, TYRE_LIFE_CONFIG, TYRE_LIFE_PRIORS, WEAR_LIMIT_KEY, wearRateKey } from '../../src/tyre-life/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { guardedQuick, situatedView } from '../situated.ts';

const calc = guardedQuick(tyreLifeCalculator);

const fallbackOf = (key: string): NonNullable<PriorDecl['fallback']> => {
  const fallback = TYRE_LIFE_PRIORS.entries[key]?.fallback;
  if (fallback === undefined) throw new Error(`${key} declares no fallback`);
  return fallback;
};

const corners = <T>(v: T): Corners<T> => ({ fl: v, fr: v, rl: v, rr: v });

/** The limits car 0's set is judged with, without priors, under `config`. */
const limitsOf = (track: EngineView['track'], config: EngineView['config']): { limitPct: number; ageLossLimitMs: number } => {
  const car = carState({ tyres: { corners: corners({ wearPct: known(10 as Percent, 0) }) } });
  const view = situatedView({ cars: [car], track, config, priors: unknown('notApplicable'), outputs: new Map([[DEGRADATION, {}]]) });
  const out = calc.compute(view)[carId(0)];
  if (out === undefined) throw new Error('no set for car 0');
  return { limitPct: out.limitPct, ageLossLimitMs: out.ageLossLimitMs };
};

const TRACKS: [string, EngineView['track']][] = [
  ['with a track file', known(zandvoortTrack(), 0)],
  ['without a track file', unknown('notApplicable')],
];
const CONFIGS: [string, EngineView['config']][] = [
  ['the config defaults', {}],
  ['an overridden config', { [TYRE_LIFE_CONFIG.key]: { wearLimitPct: 80, ageLossLimitMs: 3000 } }],
];

describe('tyre-life fallback (R35)', () => {
  describe.each(TRACKS)('%s', (_, trackOf) => {
    it.each(CONFIGS)('the declared fallback equals the default the calculator uses (%s)', (_name, config) => {
      const limits = limitsOf(trackOf, config);
      const ctx: FallbackCtx = { config, track: trackOf };
      const wear = fallbackOf(WEAR_LIMIT_KEY)(ctx);
      const age = fallbackOf(AGE_LOSS_LIMIT_KEY)(ctx);
      expect(wear.value).toMatchObject({ known: true, value: limits.limitPct });
      expect(age.value).toMatchObject({ known: true, value: limits.ageLossLimitMs });
      // a config default: kind `default` with its note, no session share
      for (const { source } of [wear, age]) {
        expect(source).toMatchObject({ kind: 'default', sessionShare: 0 });
        if (source.kind === 'default') expect(source.note).not.toBe('');
      }
    });
  });

  it('a key without a default declares no fallback', () => {
    const without = Object.entries(TYRE_LIFE_PRIORS.entries).filter(([, decl]) => decl.fallback === undefined).map(([key]) => key);
    const rates = (['soft', 'medium', 'hard', 'inter', 'wet'] as const).flatMap((c) => (['fl', 'fr', 'rl', 'rr'] as const).map((corner) => wearRateKey(c, corner)));
    expect(without.toSorted()).toEqual(rates.toSorted());
  });
});
