// `race-monte-carlo` after the weather generator's move to `weather-paths` (SP4.3c Task 14 row 2, O3b, spec §5.4a): the
// Monte Carlo draws u per scenario as before and calls `weatherPath`, so its scenario results are bit-identical. The
// golden hashes were first taken from the unit before the move (at a04a0396), over seeded runs with a perfect and an
// approximate forecast, a wet start and a rain trigger; each hash is the sha256 of the result in `stableText`.
//
// SP4.3d1 Task 3 (spec §5.1, ruling R17) deleted the triggers: a policy is a stop list, so car 2's rain-trigger
// candidate became the stop list `stopAt(7, 'inter')` and no policy carries a `triggers` key. The goldens were
// regenerated on 43bbf5c4 and checked against the unit before Task 3 (ecd9b4d1~1, loaded from git): run on these
// candidates (each with `triggers: []`), its results with every `triggers` key dropped hash to exactly the new goldens,
// in all 12 hashes; its `scenarios` and `field` hashes with the keys kept equal the a04a0396 goldens. The test below
// checks the input side: the old candidates, `triggers` dropped and the rain-trigger candidate replaced, are these.
import { createHash } from 'node:crypto';
import { known, type LapModelParams, type Policy, type StartingPoint } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { drawnScenario, fieldPositions, raceMonteCarlo, scoreAll, type FieldInput, type McInput } from '../../src/race-monte-carlo/index.ts';
import { LAP_MODEL, NOISY, startingPoint, type CarSpec } from '../race-forecast/start.ts';
import { byCar, hazard, mcInput, NO_STOP, RIVAL_RULES, stopAt } from './support.ts';

/** A value as text, typed arrays as plain arrays, keys in insertion order (the unit's own order, part of "bit-identical"); the row keys SP4.3d1 Task 5 added (`slot`, `diffPlan`, `sePlan`) are left out, so the goldens stand. */
const stableText = (value: unknown): string =>
  JSON.stringify(value, (key, v: unknown) =>
    key === 'slot' || key === 'diffPlan' || key === 'sePlan' ? undefined : ArrayBuffer.isView(v) && !(v instanceof DataView) ? Array.from(v as unknown as ArrayLike<number>) : v,
  );

const sha = (value: unknown): string => createHash('sha256').update(stableText(value)).digest('hex');

const WET_MODEL: LapModelParams = {
  ...LAP_MODEL,
  compoundOffsetMs: { soft: 0, medium: 0, hard: 0, inter: 3_500, wet: 8_100 },
  wetnessMsPerMs: { slick: 1, inter: 0.5, wet: 0.25 },
};

/** Six noisy cars, our cars 2 and 3 with inters and wets; the forecast `pct` per lap with `accuracy`; wetness as given. */
function field(accuracy: 'perfect' | 'approximate', pct: (lap: number) => number, wetnessMs: number): StartingPoint {
  const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
  const start = startingPoint({ lapsTotal: 14, cars, ours: [2, 3], lapModel: WET_MODEL });
  start.wetness = { wetnessMs, sdMs: 500, wet: wetnessMs > 0 };
  start.weather = known({ byLap: Array.from({ length: 14 }, (_, i) => ({ lap: i + 1, rainPct: pct(i + 1) })), accuracy }, 0);
  for (const sets of Object.values(start.sets)) for (const compound of ['inter', 'wet'] as const) for (let i = 0; i < 5; i++) sets.push({ compound, wearPct: 0 });
  return start;
}

const CANDIDATES: Record<number, Policy[]> = {
  2: [NO_STOP, stopAt(4, 'inter'), stopAt(7, 'inter')],
  3: [NO_STOP, stopAt(6, 'hard')],
};

const INPUTS: Record<string, () => McInput> = {
  perfect: () => mcInput(field('perfect', (l) => (l >= 5 ? 45 : 5), 0), CANDIDATES, { hazard: hazard(14, { sc: { 3: 0.2 }, vsc: { 5: 0.1 } }) }),
  approximate: () => mcInput(field('approximate', (l) => (l >= 4 && l <= 9 ? 60 : 10), 0), CANDIDATES, { hazard: hazard(14, { sc: { 2: 0.15 } }) }),
  wetStart: () => mcInput(field('perfect', (l) => (l <= 6 ? 30 : 0), 9_000), CANDIDATES, { hazard: hazard(14) }),
};

/** The candidates before Task 3 (ecd9b4d1~1) as plain data: every policy with `triggers`, car 2's third one a rain trigger. */
const OLD_CANDIDATES: Record<number, unknown[]> = {
  2: [
    { stops: [], triggers: [] },
    { stops: [{ lap: 4, compound: 'inter' }], triggers: [] },
    { stops: [], triggers: [{ kind: 'rain', wetnessMs: 1_500, action: { box: 'inter' } }] },
  ],
  3: [
    { stops: [], triggers: [] },
    { stops: [{ lap: 6, compound: 'hard' }], triggers: [] },
  ],
};

/** The rain-trigger candidate's replacement, a planned inter stop (car 2, position 2). */
const RAIN_REPLACEMENT = { car: 2, index: 2, policy: stopAt(7, 'inter') };

/** The hashes on 43bbf5c4: the unit before Task 3 gives the same, every `triggers` key dropped (header). */
const GOLDEN: Record<string, { mc: string; scores: string; scenarios: string; field: string }> = {
  perfect: {
    mc: '191a72bdd8aae72ee3028b4e5210bfa6655b99e687a31fc2076b5be69ee739c9',
    scores: 'f55cd4f3b0b361ada616362b848f9a65fb9565eae40e04d7079302cedd65c9ef',
    scenarios: '32182288c2e51a3d33ef3853c0ddb513915946aaf953346564b164de55a34ecd',
    field: 'd217144f4788b93ff3359c25a9aa24a671dc0c37e30026958e5fc13da9392c1e',
  },
  approximate: {
    mc: '7312bf34e0731abb47e5a01cce7ddc11666dee164979e45f655f04f607c4529b',
    scores: 'b6b47f1bad925b2975e5f5aa67b359a3ab6b0e564212791e5aa33c4a8f4a6abd',
    scenarios: '34919c7bbc941c12b79be12e6be166cfe873a67181ea6ef86b230878c20451ea',
    field: '818b8477ddb36e1f23b3dd14c6d0b4337699c8c6d92cf41efee1aa9bba5f2c7e',
  },
  wetStart: {
    mc: '5f57e05d9f89c4d49dcbf7ee811bdb385d42cd107710618be52fbdaf557b0aed',
    scores: 'c042e604cc67546a36e054557d4e77f8546181ac1eba4a001934c5354ca2d58a',
    scenarios: 'e311c9b361072351024ce6a268454e3b067e3dc2ea4c28b8626ac411346b011c',
    field: 'cb317f566bd549642bd6932a3b23ede24ac9a3b59bd198a6a6eefef81a42d36f',
  },
};

/** `value` as text with every `triggers` key dropped. */
const withoutTriggers = (value: unknown): string => JSON.stringify(value, (key, v: unknown) => (key === 'triggers' ? undefined : v));

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

describe('race-monte-carlo: the inputs after Task 3 (R17)', () => {
  it('the old candidates, triggers dropped and the rain-trigger candidate replaced, are the candidates the goldens run', () => {
    const old = Object.fromEntries(
      Object.entries(OLD_CANDIDATES).map(([car, list]) => [
        car,
        list.map((p, i) => (Number(car) === RAIN_REPLACEMENT.car && i === RAIN_REPLACEMENT.index ? RAIN_REPLACEMENT.policy : p)),
      ]),
    );
    expect(sha(JSON.parse(withoutTriggers(old)))).toBe(sha(CANDIDATES));
    expect(OLD_CANDIDATES[RAIN_REPLACEMENT.car]?.[RAIN_REPLACEMENT.index]).toMatchObject({ triggers: [{ kind: 'rain' }] });
  });
});

describe('race-monte-carlo: bit-identical across the weather move (row 2, seeded, C2)', () => {
  for (const name of Object.keys(INPUTS)) {
    it(`${name}: the search, the scoring, the drawn scenarios and the field positions equal the results before the move`, () => {
      expect(hashesOf(name)).toEqual(GOLDEN[name]);
    });
  }
});
