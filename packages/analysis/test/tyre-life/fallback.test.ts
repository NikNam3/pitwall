// `tyre-life`'s declared fallbacks (SP4.1a fx3, ruling R35; C43, C62a, C47): an entry left falls back to the value a
// run uses unless the set overrides it, with a default source. SP4.3c Task 12: the age-loss limit and the wear-rate
// entries are deleted (spec §5.2); the wear limit a run uses is `tyre-model`'s (`limitPct`, its config default 70 %).
// The calculator runs through its guarded view (C41); `tyre-model`'s output is passed explicitly (C84).
import { carId, known, unknown, type Corners, type Percent } from '@pitwall/domain';
import type { EngineView, FallbackCtx } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { TYRE_LIFE_PRIORS } from '../../src/tyre-life/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { TYRE_MODEL } from '../../src/tyre-model/index.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { guardedQuick, situatedView } from '../situated.ts';
import { plainModelCar } from '../tyre-model/support.ts';

const calc = guardedQuick(tyreLifeCalculator);

const corners = <T>(v: T): Corners<T> => ({ fl: v, fr: v, rl: v, rr: v });

/** The limit car 0's set is judged with, without priors, on `tyre-model`'s defaults. */
const limitOf = (track: EngineView['track']): number => {
  const car = carState({ tyres: { corners: corners({ wearPct: known(10 as Percent, 0) }) } });
  const view = situatedView({ cars: [car], track, priors: unknown('notApplicable'), outputs: new Map([[TYRE_MODEL, { [carId(0)]: plainModelCar() }]]) });
  const out = calc.compute(view)[carId(0)];
  if (out === undefined) throw new Error('no set for car 0');
  return out.limitPct;
};

const TRACKS: [string, EngineView['track']][] = [
  ['with a track file', known(zandvoortTrack(), 0)],
  ['without a track file', unknown('notApplicable')],
];

describe('tyre-life fallback (R35)', () => {
  it.each(TRACKS)('every entry left declares a fallback, a default with its note, equal to the limit the calculator uses (%s)', (_, track) => {
    for (const [key, decl] of Object.entries(TYRE_LIFE_PRIORS.entries)) {
      expect(decl.fallback, `${key} declares a fallback`).toBeDefined();
      const ctx: FallbackCtx = { config: {}, track };
      const fallback = decl.fallback!(ctx);
      expect(fallback.source, key).toMatchObject({ kind: 'default', sessionShare: 0 });
      if (key === 'tyreLife.wearLimitPct') expect(fallback.value, key).toMatchObject({ known: true, value: limitOf(track) });
    }
  });
});
