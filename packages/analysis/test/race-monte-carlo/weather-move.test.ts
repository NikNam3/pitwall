// `race-monte-carlo` after the weather generator's move to `weather-paths` (SP4.3c Task 14 row 2, O3b, spec §5.4a): the
// Monte Carlo draws u per scenario as before and calls `weatherPath`, so its scenario results are bit-identical. The
// golden hashes below were taken from the unit before the move (at a04a0396), over seeded runs with a perfect and an
// approximate forecast, a wet start and a rain trigger; each hash is the sha256 of the result in `stableText`.
import { createHash } from 'node:crypto';
import { known, type LapModelParams, type Policy, type StartingPoint, type Trigger } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { drawnScenario, fieldPositions, raceMonteCarlo, scoreAll, type FieldInput, type McInput } from '../../src/race-monte-carlo/index.ts';
import { LAP_MODEL, NOISY, startingPoint, type CarSpec } from '../race-forecast/start.ts';
import { byCar, hazard, mcInput, NO_STOP, RIVAL_RULES, stopAt } from './support.ts';

/** A value as text, typed arrays as plain arrays, keys in insertion order (the unit's own order, part of "bit-identical"). */
const stableText = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (ArrayBuffer.isView(v) && !(v instanceof DataView) ? Array.from(v as unknown as ArrayLike<number>) : v));

const sha = (value: unknown): string => createHash('sha256').update(stableText(value)).digest('hex');

const WET_MODEL: LapModelParams = {
  ...LAP_MODEL,
  compoundOffsetMs: { soft: 0, medium: 0, hard: 0, inter: 3_500, wet: 8_100 },
  wetnessMsPerMs: { slick: 1, inter: 0.5, wet: 0.25 },
};

const rainBox = (wetnessMs: number): Trigger => ({ kind: 'rain', wetnessMs, action: { box: 'inter' } });

/** Six noisy cars, our cars 2 and 3 with inters and wets; the forecast `pct` per lap with `accuracy`; wetness as given. */
function field(accuracy: 'perfect' | 'approximate', pct: (lap: number) => number, wetnessMs: number): StartingPoint {
  const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
  const start = startingPoint({ lapsTotal: 14, cars, ours: [2, 3], lapModel: WET_MODEL });
  start.wetness = { wetnessMs, sdMs: 500 };
  start.weather = known({ byLap: Array.from({ length: 14 }, (_, i) => ({ lap: i + 1, rainPct: pct(i + 1) })), accuracy }, 0);
  for (const sets of Object.values(start.sets)) for (const compound of ['inter', 'wet'] as const) for (let i = 0; i < 5; i++) sets.push({ compound, wearPct: 0 });
  return start;
}

const CANDIDATES: Record<number, Policy[]> = {
  2: [NO_STOP, stopAt(4, 'inter'), { stops: [], triggers: [rainBox(1_500)] }],
  3: [NO_STOP, stopAt(6, 'hard')],
};

const INPUTS: Record<string, () => McInput> = {
  perfect: () => mcInput(field('perfect', (l) => (l >= 5 ? 45 : 5), 0), CANDIDATES, { hazard: hazard(14, { sc: { 3: 0.2 }, vsc: { 5: 0.1 } }) }),
  approximate: () => mcInput(field('approximate', (l) => (l >= 4 && l <= 9 ? 60 : 10), 0), CANDIDATES, { hazard: hazard(14, { sc: { 2: 0.15 } }) }),
  wetStart: () => mcInput(field('perfect', (l) => (l <= 6 ? 30 : 0), 9_000), CANDIDATES, { hazard: hazard(14) }),
};

/** The hashes taken before the move (a04a0396). */
const GOLDEN: Record<string, { mc: string; scores: string; scenarios: string; field: string }> = {
  perfect: {
    mc: 'd2bd3edf3a7caa1a3f67dbbd8ea8fad8f838337e7ce87956557b1925c31b4894',
    scores: '7e7163c585caa28f11fc765a51421608355885d42a74b0e84e0a2845d5f49e8d',
    scenarios: '7cb58fca996232dd396215ea2b67f941ce5b229329744c151688f38ed6713185',
    field: 'd217144f4788b93ff3359c25a9aa24a671dc0c37e30026958e5fc13da9392c1e',
  },
  approximate: {
    mc: '008d380fc4e20a61be46ec98e741b57d2d070ab429ee15fc3075ca4767ce925a',
    scores: 'f8e43bc4a4f39aa2472516dcf560574fda8e6a0bd2b0374aee628c4ac41e363e',
    scenarios: 'bca7494745b6828bb41c02f81a13224bd36d53f5ca50949a2736e468132a0b0d',
    field: '818b8477ddb36e1f23b3dd14c6d0b4337699c8c6d92cf41efee1aa9bba5f2c7e',
  },
  wetStart: {
    mc: '81f9a1084a6b59476716e2dbeb074d02f442606f32a9533670e4c7cd00d2842e',
    scores: '17b9233bf52dea52a4c243a19278de939d4d2f2bad01d60663239e2452b8295c',
    scenarios: 'a349c71d58a70cda8d944577e0050e40af0a852520a7f8f237f222913c3b69d7',
    field: 'cb317f566bd549642bd6932a3b23ede24ac9a3b59bd198a6a6eefef81a42d36f',
  },
};

/** What a case's run gives: the search, the full scoring, 200 drawn scenarios and the field positions. */
function hashesOf(name: string): { mc: string; scores: string; scenarios: string; field: string } {
  const input = INPUTS[name] as () => McInput;
  const fieldInput = (): FieldInput => ({ start: input().start, plans: byCar({ 2: NO_STOP, 3: stopAt(6, 'inter') }), hazard: input().hazard, rivalRules: RIVAL_RULES, scenarios: 200, laps: [5, 14] });
  return {
    mc: sha(raceMonteCarlo(input(), createRng(61), 1_500)),
    scores: sha(scoreAll(input(), createRng(62), 300)),
    scenarios: sha(Array.from({ length: 200 }, (_, i) => drawnScenario(input(), createRng(63), i + 1))),
    field: sha(fieldPositions(fieldInput(), createRng(64))),
  };
}

describe('race-monte-carlo: bit-identical across the weather move (row 2, seeded, C2)', () => {
  for (const name of Object.keys(INPUTS)) {
    it(`${name}: the search, the scoring, the drawn scenarios and the field positions equal the results before the move`, () => {
      expect(hashesOf(name)).toEqual(GOLDEN[name]);
    });
  }
});
