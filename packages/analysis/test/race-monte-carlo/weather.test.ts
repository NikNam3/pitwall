// `race-monte-carlo`'s weather (SP4.3b spec §7.1, §7.2; S12; Task 19b; plans are stop lists, SP4.3d spec §5.1; C2, C3, C50). Starting points are built by hand (`../race-forecast/start.ts`) with a
// forecast in `StartingPoint.weather`; how these tests read the inputs and outputs is stated in `support.ts` and here.
//
// What these tests take as the simulator's model (the test agent's decisions, Task 19b report):
// - `drawnScenario(input, rng, id)` (exported by the unit) is scenario `id` exactly as `raceMonteCarlo`, `scoreAll` and
//   `fieldPositions` draw it for `input` under a generator seeded like `rng` (a fresh `createRng` of the same seed): per
//   lap from `start.lap` to `start.lapsTotal` (one entry each, in order) whether it rained (`rain`) and the track
//   wetness the lap model reads for that lap (`wetnessMs`); and every car slot's policy in it as a rival follows it
//   (`rivals[k]`; our cars' entries are not read). `scoreAll` runs scenario ids 1 … n.
// - `start.weather` `byLap[i].rainPct` (0–100) is the forecast's chance of rain on lap `byLap[i].lap`. Unknown: no rain
//   model; the wetness stays the starting point's on every lap (dry, as before this task).
// - A rain lap's wetness is above the lap before's unless it is already at its ceiling; a dry lap's is below it until 0.
// - A rival switches type at the end of lap L + `reactionLaps`, L the first lap whose wetness makes its type slower than
//   another type's in the lap model (offset + wetness term), to the fastest type at L; at the end of the first lap of
//   L … L + `reactionLaps` that an SC is out on instead, if there is one (at once under an SC).
import { known, unknown, type LapModelParams, type NoiseCompound, type Policy, type StartingPoint } from '@pitwall/domain';
import { createRng, type Rng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import * as mc from '../../src/race-monte-carlo/index.ts';
import { fieldPositions, raceMonteCarlo, scoreAll, type FieldInput, type McInput } from '../../src/race-monte-carlo/index.ts';
import { LAP_MODEL, NOISY, startingPoint, type CarSpec } from '../race-forecast/start.ts';
import { byCar, carOf, hazard, mcInput, NO_STOP, RIVAL_RULES, rowOf, stopAt, type Row } from './support.ts';

type WeatherLap = { lap: number; rain: boolean; wetnessMs: number };
type Drawn = { weather: WeatherLap[]; rivals: Policy[] };
type DrawnScenario = (input: McInput, rng: Rng, id: number) => Drawn;

/** The unit's `drawnScenario`; throws (the row fails) until the unit exports it. */
function drawnScenario(input: McInput, seed: number, id: number): Drawn {
  const f = (mc as Record<string, unknown>)['drawnScenario'];
  if (typeof f !== 'function') throw new Error('race-monte-carlo/index.ts exports no drawnScenario');
  return (f as DrawnScenario)(input, createRng(seed), id);
}

/** A forecast for laps `from` … `to`: per lap the rain chance `pct(lap)`. */
function forecast(from: number, to: number, pct: (lap: number) => number, accuracy: 'perfect' | 'approximate' = 'perfect'): StartingPoint['weather'] {
  const byLap = Array.from({ length: to - from + 1 }, (_, i) => ({ lap: from + i, rainPct: pct(from + i) }));
  return known({ byLap, accuracy }, 0);
}

/** Research 19 §4's wet values: offsets against the slick inter 3,500 and wet 8,100 ms; slopes 1, 0.5, 0.25. */
const WET_MODEL: LapModelParams = {
  ...LAP_MODEL,
  compoundOffsetMs: { soft: 0, medium: 0, hard: 0, inter: 3_500, wet: 8_100 },
  wetnessMsPerMs: { slick: 1, inter: 0.5, wet: 0.25 },
};

/** Only the wetness terms (no offsets), so an inter's loss to rain is half a slick's. */
const SLOPES_ONLY: LapModelParams = { ...LAP_MODEL, wetnessMsPerMs: { slick: 1, inter: 0.5, wet: 0.25 } };

/** A field built by `startingPoint` with forecast `weather`; our cars also get five inters and five wets each. */
function withWeather(spec: Parameters<typeof startingPoint>[0], weather: StartingPoint['weather']): StartingPoint {
  const start = startingPoint(spec);
  start.weather = weather;
  for (const sets of Object.values(start.sets)) for (const compound of ['inter', 'wet'] as const) for (let i = 0; i < 5; i++) sets.push({ compound, wearPct: 0 });
  return start;
}

/** The first lap (or undefined) whose entry satisfies `p`. */
const firstLap = (weather: readonly WeatherLap[], p: (w: WeatherLap) => boolean): number | undefined => weather.find(p)?.lap;

function sd(xs: readonly number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
}

/** A type's lap time at wetness `w` in `model`, from the offset and the wetness term only. */
function typeMs(model: LapModelParams, compound: NoiseCompound, w: number): number {
  const type = compound === 'inter' ? 'inter' : compound === 'wet' ? 'wet' : 'slick';
  return model.compoundOffsetMs[compound] + model.wetnessMsPerMs[type] * w;
}

const outcome = (r: Row) => ({ positionPmf: r.positionPmf, ePos: r.ePos, ePoints: r.ePoints, meanMs: r.meanMs, quantiles: r.quantiles, pGain: r.pGain });

describe('race-monte-carlo: the rain timeline (spec §7.1, S12)', () => {
  // row 1
  it('a forecast of 0 % rain gives no rain in any scenario and the same result as before', () => {
    const cars: CarSpec[] = Array.from({ length: 5 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
    const spec = { lapsTotal: 8, cars, ours: [2], lapModel: WET_MODEL };
    const dry = withWeather(spec, forecast(1, 8, () => 0, 'perfect'));
    const none = withWeather(spec, unknown('notReceived'));
    const hz = hazard(8, { sc: { 3: 0.2 } });
    const candidates = { 2: [NO_STOP, stopAt(3, 'hard'), stopAt(5, 'inter')] };
    for (let id = 1; id <= 100; id++) {
      for (const w of drawnScenario(mcInput(dry, candidates, { hazard: hz }), 5, id).weather) {
        expect(w.rain).toBe(false);
        expect(w.wetnessMs).toBe(0);
      }
    }
    expect(raceMonteCarlo(mcInput(dry, candidates, { hazard: hz }), createRng(5), 2_000)).toStrictEqual(raceMonteCarlo(mcInput(none, candidates, { hazard: hz }), createRng(5), 2_000));
  });

  // row 2
  it('a forecast of 100 % rain from lap 10 gives rain on lap 10 in every scenario (perfect accuracy)', () => {
    const start = withWeather({ lapsTotal: 16, cars: [{}], ours: [0] }, forecast(1, 16, (lap) => (lap >= 10 ? 100 : 0)));
    const input = mcInput(start, { 0: [NO_STOP] });
    for (let id = 1; id <= 200; id++) {
      const weather = drawnScenario(input, 9, id).weather;
      expect(weather.map((w) => w.lap)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
      for (const w of weather) expect(w.rain).toBe(w.lap >= 10);
    }
  });

  // row 3
  it('an approximate forecast widens the spread of the first-rain lap', () => {
    const pct = (lap: number): number => (lap >= 10 ? 100 : 0);
    const firsts = (accuracy: 'perfect' | 'approximate'): number[] => {
      const input = mcInput(withWeather({ lapsTotal: 20, cars: [{}], ours: [0] }, forecast(1, 20, pct, accuracy)), { 0: [NO_STOP] });
      return Array.from({ length: 400 }, (_, i) => firstLap(drawnScenario(input, 11, i + 1).weather, (w) => w.rain) ?? 21);
    };
    const perfect = firsts('perfect');
    const approximate = firsts('approximate');
    expect(sd(perfect)).toBe(0);
    expect(new Set(perfect)).toEqual(new Set([10]));
    expect(sd(approximate)).toBeGreaterThan(0);
    expect(approximate.filter((l) => l !== 10).length).toBeGreaterThanOrEqual(20);
  });

  // row 4
  it('wetness rises under rain and falls on dry laps; slicks lose time by the wetness term, inters less', () => {
    // rain on laps 3–6 only, one car alone and quiet, the lap model's wetness terms without offsets
    const weather = forecast(1, 14, (lap) => (lap >= 3 && lap <= 6 ? 100 : 0));
    const spec = (compound: NoiseCompound) => ({ lapsTotal: 14, cars: [{ compound }], ours: [0], lapModel: SLOPES_ONLY });
    const wet = (compound: NoiseCompound) => mcInput(withWeather(spec(compound), weather), { 0: [NO_STOP] });
    const dry = (compound: NoiseCompound) => mcInput(withWeather(spec(compound), unknown('notReceived')), { 0: [NO_STOP] });

    const path = drawnScenario(wet('medium'), 13, 1).weather;
    expect(path[0]!.wetnessMs).toBe(0);
    expect(path[2]!.wetnessMs).toBeGreaterThan(path[1]!.wetnessMs);
    for (let i = 1; i < path.length; i++) {
      const [prev, now] = [path[i - 1]!, path[i]!];
      if (now.rain) expect(now.wetnessMs).toBeGreaterThanOrEqual(prev.wetnessMs);
      else if (prev.wetnessMs > 0) expect(now.wetnessMs).toBeLessThan(prev.wetnessMs);
      expect(now.wetnessMs).toBeGreaterThanOrEqual(0);
    }
    expect(path[6]!.wetnessMs).toBeLessThan(path[5]!.wetnessMs);

    // the lap model's wetness term: a slick loses the wetness of every lap, an inter half of it
    const n = 20;
    const mean = (input: McInput): number => carOf(scoreAll(input, createRng(13), n), 0).rows[0]!.meanMs;
    let sum = 0;
    for (let id = 1; id <= n; id++) sum += drawnScenario(wet('medium'), 13, id).weather.reduce((s, w) => s + w.wetnessMs, 0);
    const slickLoss = mean(wet('medium')) - mean(dry('medium'));
    const interLoss = mean(wet('inter')) - mean(dry('inter'));
    expect(slickLoss).toBeGreaterThan(0);
    expect(Math.abs(slickLoss - sum / n)).toBeLessThanOrEqual(1e-6 * Math.max(1, slickLoss));
    expect(Math.abs(interLoss - 0.5 * slickLoss)).toBeLessThanOrEqual(1e-6 * Math.max(1, slickLoss));
  });
});

describe('race-monte-carlo: rivals in the wet (spec §7.2, O8)', () => {
  // row 5
  it('a rival switches to inters at the crossover lap (+ reactionLaps), at once under an SC', () => {
    // a rival on mediums with no dry stop ahead, our car a minute behind; rain from lap 3 to the flag
    const start = withWeather({ lapsTotal: 30, cars: [{ gapMs: 0, compound: 'medium' }, { gapMs: 60_000 }], ours: [1], lapModel: WET_MODEL }, forecast(1, 30, (lap) => (lap >= 3 ? 100 : 0)));
    const allSc = new Float64Array(30);
    allSc[29] = 1;
    const switchOf = (o: { reactionLaps: number; sc: boolean }, id: number): { expected: { lap: number; compound: NoiseCompound }; got: Policy['stops'][number] | undefined } => {
      const input = mcInput(start, { 1: [NO_STOP] }, { rivalRules: { reactionLaps: o.reactionLaps }, hazard: o.sc ? hazard(30, { active: { condition: 'sc', remaining: allSc } }) : hazard(30) });
      const drawn = drawnScenario(input, 19, id);
      const crossing = drawn.weather.find((w) => typeMs(WET_MODEL, 'medium', w.wetnessMs) > Math.min(typeMs(WET_MODEL, 'inter', w.wetnessMs), typeMs(WET_MODEL, 'wet', w.wetnessMs)));
      expect(crossing).toBeDefined();
      const at = crossing!.wetnessMs;
      const compound = typeMs(WET_MODEL, 'inter', at) <= typeMs(WET_MODEL, 'wet', at) ? 'inter' : 'wet';
      const lap = o.sc ? crossing!.lap : crossing!.lap + o.reactionLaps;
      return { expected: { lap, compound }, got: drawn.rivals[0]?.stops[0] };
    };
    for (let id = 1; id <= 20; id++) {
      const plain = switchOf({ reactionLaps: 0, sc: false }, id);
      expect(plain.expected.compound).toBe('inter');
      expect(plain.got).toEqual(plain.expected);
      const late = switchOf({ reactionLaps: 2, sc: false }, id);
      expect(late.got).toEqual(late.expected);
      const underSc = switchOf({ reactionLaps: 2, sc: true }, id);
      expect(underSc.got).toEqual(underSc.expected);
    }
  });
});

describe('race-monte-carlo: weather under common random numbers and seeds (C2, S25)', () => {
  const field = (): StartingPoint => {
    const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
    return withWeather({ lapsTotal: 10, cars, ours: [2, 3], lapModel: WET_MODEL }, forecast(1, 10, (lap) => (lap >= 4 ? 40 : 10), 'approximate'));
  };

  // row 9
  it('weather draws are common across candidates (CRN): one more stop of one candidate leaves the rain timeline unchanged', () => {
    const start = field();
    const a = stopAt(3, 'hard');
    const aMore: Policy = { stops: [{ lap: 3, compound: 'hard' }, { lap: 6, compound: 'inter' }] };
    const b: Policy = { stops: [{ lap: 5, compound: 'medium' }, { lap: 8, compound: 'inter' }] };
    const hz = hazard(10, { sc: { 3: 0.2 } });
    for (let id = 1; id <= 60; id++) {
      expect(drawnScenario(mcInput(start, { 2: [aMore, b] }, { hazard: hz }), 43, id).weather).toStrictEqual(drawnScenario(mcInput(start, { 2: [a, b] }, { hazard: hz }), 43, id).weather);
    }
    const before = carOf(scoreAll(mcInput(start, { 2: [a, b] }, { hazard: hz }), createRng(43), 400), 2).rows;
    const after = carOf(scoreAll(mcInput(start, { 2: [aMore, b] }, { hazard: hz }), createRng(43), 400), 2).rows;
    expect(outcome(rowOf(after, b))).toStrictEqual(outcome(rowOf(before, b)));
  });

  // row 10
  it('a seeded run is bit-identical with weather', () => {
    const start = field();
    const hz = hazard(10, { sc: { 2: 0.2 }, vsc: { 3: 0.1 } });
    const input = () => mcInput(start, { 2: [NO_STOP, stopAt(4, 'inter'), stopAt(7, 'inter')], 3: [NO_STOP, stopAt(5)] }, { hazard: hz });
    const one = raceMonteCarlo(input(), createRng(47), 2_000);
    expect(raceMonteCarlo(input(), createRng(47), 2_000)).toStrictEqual(one);
    // the weather is in the result: it differs from the same run without a forecast
    const dry = mcInput({ ...start, weather: unknown('notReceived') }, { 2: [NO_STOP, stopAt(4, 'inter'), stopAt(7, 'inter')], 3: [NO_STOP, stopAt(5)] }, { hazard: hz });
    expect(raceMonteCarlo(dry, createRng(47), 2_000)).not.toStrictEqual(one);
    expect(drawnScenario(input(), 47, 7)).toStrictEqual(drawnScenario(input(), 47, 7));
    const fieldInput = (): FieldInput => ({ start, plans: byCar({ 2: NO_STOP, 3: stopAt(5, 'inter') }), hazard: hz, rivalRules: RIVAL_RULES, scenarios: 200, laps: [4, 10] });
    expect(fieldPositions(fieldInput(), createRng(48))).toStrictEqual(fieldPositions(fieldInput(), createRng(48)));
  });
});
