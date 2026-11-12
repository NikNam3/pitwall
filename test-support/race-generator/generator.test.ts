// The test-race generator (SP4.3a spec 6.4, plan Task 7): seeded and pure (C2), its views hold the builders' invariants
// (the long race's, `builders/long-race.test.ts`), and its races show the parameters they were generated from. Each race
// is generated once per file, lazily, at the smallest size that shows its property (P8).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CarId, MachineId, OpenSpan, Span } from '../../packages/domain/src/index.ts';
import type { EngineView } from '../../packages/engine/src/index.ts';
import type { BuilderRace } from '../builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar, type GeneratorParams } from './index.ts';

const memo = <T>(make: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= make());
};

/** A quiet AI car: 90 s a lap, no scatter, no mistakes, no stops. */
const car = (over: Partial<GeneratorCar> = {}): GeneratorCar => ({
  paceMs: 90_000,
  human: false,
  sigmaMs: 0,
  rho: 0,
  mistakeRate: 0,
  mistakeMedianMs: 1_000,
  mistakeSigmaLog: 0.5,
  wearFactor: 1,
  stops: [],
  ...over,
});

/** The defaults with this field (so `cars` is its length) and `over`. */
const params = (field: GeneratorCar[], over: Partial<GeneratorParams> = {}): GeneratorParams => ({ ...GENERATOR_DEFAULTS, cars: field.length, field, ...over });

const NO_DEG = Object.fromEntries(
  Object.entries(GENERATOR_DEFAULTS.compounds).map(([c, v]) => [c, { ...v, degMsPerLap: 0 }]),
) as GeneratorParams['compounds'];

type Lap = EngineView['history']['laps'][number];

const finalView = (race: BuilderRace): EngineView => race.viewAt(race.lastFrame);

/** A car's confirmed laps, by lap number. */
const lapsOf = (race: BuilderRace, id: number): Lap[] =>
  finalView(race)
    .history.laps.filter((l) => l.status === 'confirmed' && l.carId === id)
    .sort((a, b) => a.lapNumber - b.lapNumber);

/** A sub-machine's spans of one car (or the session's, without `id`) at the race's end, closed and open, by start frame. */
function spansOf(race: BuilderRace, machine: MachineId, id?: number): Array<Span | OpenSpan> {
  const { history, situation } = finalView(race);
  return [...(history.spans[machine] ?? []), ...(situation.byMachine[machine] ?? [])]
    .filter((s) => id === undefined || s.carId === id)
    .sort((a, b) => a.startFrame - b.startFrame);
}

/** The frame car `id` crosses the line to start lap `lap`. */
const lineFrame = (race: BuilderRace, id: number, lap: number): number =>
  finalView(race).history.crossings.find((c) => c.carId === id && c.lap === lap && c.segment === 0)!.frame;

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** The residuals of `ys` after a least-squares line over their index (takes out a linear fuel or tyre trend). */
function detrended(ys: number[]): number[] {
  const xs = ys.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(ys);
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return ys.map((y, i) => y - my - slope * (xs[i]! - mx));
}

const sd = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/** The race's passes: over consecutive laps, the pairs of cars (classified on both) whose order at the line flipped. */
function passes(race: BuilderRace, cars: number, laps: number): number {
  const positions = (n: number): Map<number, number> =>
    new Map(finalView(race).history.laps.filter((l) => l.status === 'confirmed' && l.lapNumber === n).map((l) => [l.carId as number, l.positionAtEnd]));
  let count = 0;
  for (let n = 2; n <= laps; n++) {
    const before = positions(n - 1);
    const after = positions(n);
    for (let a = 0; a < cars; a++) {
      for (let b = a + 1; b < cars; b++) {
        const [pa, pb, qa, qb] = [before.get(a), before.get(b), after.get(a), after.get(b)];
        if (pa === undefined || pb === undefined || qa === undefined || qb === undefined) continue;
        if (pa < pb !== qa < qb) count++;
      }
    }
  }
  return count;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** 4 cars over 8 laps with scatter and mistakes, a stop, a human handed to the AI and a safety car: every kind of fact and span. */
const busy = memo(() =>
  generateRace(
    params(
      [
        car({ paceMs: 90_000, sigmaMs: 200, rho: 0.3, mistakeRate: 0.1 }),
        car({ paceMs: 90_200, sigmaMs: 200, rho: 0.3, mistakeRate: 0.1 }),
        car({ paceMs: 90_400, sigmaMs: 200, rho: 0.3, stops: [{ lap: 4, compound: 'hard' }], startCompound: 'medium' }),
        car({ paceMs: 90_600, human: true, sigmaMs: 500, rho: 0.4, mistakeRate: 0.1, takeoverLap: 5 }),
      ],
      { laps: 8, sc: { fromLap: 6, toLap: 7 } },
    ),
    11,
  ),
);

describe('generateRace: seeded and pure (C2)', () => {
  it('the same parameters and seed give bit-identical races; another seed another race', () => {
    const p = params([car({ sigmaMs: 300, rho: 0.3, mistakeRate: 0.2 }), car({ paceMs: 90_500, sigmaMs: 300, rho: 0.3, mistakeRate: 0.2 })], { laps: 5 });
    const a = generateRace(p, 3).race;
    const b = generateRace(p, 3).race;
    const c = generateRace(p, 4).race;
    expect(b.lastFrame).toBe(a.lastFrame);
    expect(finalView(b).history).toEqual(finalView(a).history);
    expect(finalView(b).situation).toEqual(finalView(a).situation);
    const mid = Math.floor(a.lastFrame / 2);
    expect(b.viewAt(mid).live).toEqual(a.viewAt(mid).live);
    expect(lapsOf(c, 0).map((l) => l.lapTimeMs)).not.toEqual(lapsOf(a, 0).map((l) => l.lapTimeMs));
  });

  it('reads no clock and no Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    const perf = vi.spyOn(performance, 'now');
    const { race } = generateRace(params([car({ sigmaMs: 300, mistakeRate: 0.2 }), car({ paceMs: 90_300, sigmaMs: 300 })], { laps: 3 }), 5);
    finalView(race);
    race.viewAt(Math.floor(race.lastFrame / 2));
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(perf).not.toHaveBeenCalled();
  });

  it('returns the parameters it generated from as the truth', () => {
    const p = params([car({ sigmaMs: 250 }), car({ paceMs: 90_400, human: true })], { laps: 2 });
    const { truth } = generateRace(p, 1);
    expect(truth).toEqual(p);
  });

  it('throws when the field does not have `cars` cars', () => {
    expect(() => generateRace({ ...params([car(), car()]), cars: 3 }, 1)).toThrow(/cars/);
  });
});

describe("generateRace: the builders' invariants", () => {
  const LISTS = ['laps', 'crossings', 'stints', 'pitStops', 'events'] as const;

  it('the leader’s laps cover consecutive frames, every lap of the race has frames, and the last lap ends by the last frame', () => {
    const { race } = busy();
    expect([race.cars, race.laps]).toEqual([4, 8]);
    const frames = Array.from({ length: race.laps }, (_, i) => race.framesOfLap(i + 1));
    for (const f of frames) expect(f.length).toBeGreaterThan(0);
    const all = frames.flat();
    for (let i = 1; i < all.length; i++) expect(all[i]).toBe(all[i - 1]! + 1);
    expect(all.at(-1)!).toBeLessThanOrEqual(race.lastFrame);
  });

  it("a frame's view holds the frame before's facts and its own, each describing a frame by then; its delta says so; one frame is 500 ms", () => {
    const { race } = busy();
    for (let frame = 2; frame <= race.lastFrame; frame += 37) {
      const before = race.viewAt(frame - 1);
      const view = race.viewAt(frame);
      expect(view.live.sessionTime - before.live.sessionTime).toBe(500);
      for (const list of LISTS) {
        expect(view.history[list].slice(0, before.history[list].length)).toEqual(before.history[list]);
        expect(view.history[list].every((fact) => fact.frame <= frame)).toBe(true);
        expect([view.delta.before[list], view.delta.after[list]]).toEqual([before.history[list].length, view.history[list].length]);
      }
      for (const span of Object.values(view.history.spans).flat()) expect(span.endFrame).toBeLessThanOrEqual(frame);
      for (const span of Object.values(view.situation.byMachine).flat()) expect(span.startFrame).toBeLessThanOrEqual(frame);
      expect(view.live.cars.slice(0, race.cars).map((c) => c.timing.position).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    }
  });

  it('records each lap provisional, then confirmed naming the provisional (C25); laps and sectors in integer ms', () => {
    const { race } = busy();
    const { laps } = finalView(race).history;
    const confirmed = laps.filter((l) => l.status === 'confirmed');
    expect(confirmed.length).toBeGreaterThan(0);
    for (const l of confirmed) {
      const provisional = laps[l.supersedes!.index]!;
      expect([provisional.status, provisional.carId, provisional.lapNumber, provisional.frame]).toEqual(['provisional', l.carId, l.lapNumber, l.frame]);
      expect(Number.isInteger(l.lapTimeMs) && Number.isInteger(l.completedAt)).toBe(true);
      expect(l.sectorTimesMs.every(Number.isInteger)).toBe(true);
      expect(l.sectorTimesMs.reduce((s, x) => s + x, 0)).toBe(l.lapTimeMs);
    }
  });

  it('every car runs consecutive laps from 1, the leader all of them, each with its 50 crossings in time order', () => {
    const { race } = busy();
    const { crossings } = finalView(race).history;
    const counts: number[] = [];
    for (let id = 0; id < race.cars; id++) {
      const laps = lapsOf(race, id);
      expect(laps.map((l) => l.lapNumber)).toEqual(laps.map((_, i) => i + 1));
      counts.push(laps.length);
      for (const l of laps) {
        const mine = crossings.filter((c) => c.carId === id && c.lap === l.lapNumber);
        expect(mine.map((c) => c.segment)).toEqual(Array.from({ length: 50 }, (_, i) => i));
        const times = mine.map((c) => c.at);
        expect(times).toEqual([...times].sort((a, b) => a - b));
      }
    }
    expect(Math.max(...counts)).toBe(race.laps);
  });

  it("every sub-machine's spans of a scope are contiguous: each opens on the frame the one before closed on, the last open", () => {
    const { race } = busy();
    const { history, situation } = finalView(race);
    const all = [...Object.values(history.spans).flat(), ...Object.values(situation.byMachine).flat()];
    const scopes = new Map<string, Array<{ startFrame: number; endFrame?: number }>>();
    for (const s of all) {
      const key = `${s.machine}:${s.carId ?? ''}:${s.zone ?? ''}`;
      (scopes.get(key) ?? scopes.set(key, []).get(key)!).push(s);
    }
    expect(scopes.size).toBeGreaterThan(0);
    for (const [key, spans] of scopes) {
      const sorted = [...spans].sort((a, b) => a.startFrame - b.startFrame || (a.endFrame ?? Infinity) - (b.endFrame ?? Infinity));
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.startFrame, key).toBe(sorted[i - 1]!.endFrame);
      expect(sorted.at(-1)!.endFrame, `${key} ends open`).toBeUndefined();
    }
  });
});

describe('generateRace: the parameters show in the race', () => {
  it("a car's lap times recover its sigmaMs within 15 % and its rho within 0.15 over 60 free-air laps (five lone-car races)", () => {
    const SIGMA = 300;
    const RHO = 0.3;
    const sds: number[] = [];
    const pairs: Array<[number, number]> = [];
    for (let seed = 1; seed <= 5; seed++) {
      const { race } = generateRace(params([car({ sigmaMs: SIGMA, rho: RHO })], { laps: 61 }), seed);
      const residuals = detrended(lapsOf(race, 0).slice(1).map((l) => l.lapTimeMs));
      expect(residuals).toHaveLength(60);
      sds.push(sd(residuals));
      for (let i = 1; i < residuals.length; i++) pairs.push([residuals[i - 1]!, residuals[i]!]);
    }
    expect(Math.abs(mean(sds) - SIGMA) / SIGMA).toBeLessThan(0.15);
    const [xs, ys] = [pairs.map((p) => p[0]), pairs.map((p) => p[1])];
    const [mx, my] = [mean(xs), mean(ys)];
    const rho = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
    expect(Math.abs(rho - RHO)).toBeLessThan(0.15);
  });

  /** 6 cars on a 10-lap reverse grid (the slowest on pole, 120 ms a lap apart): passes need the hazard. */
  const reverseGrid = (hazard: number, seed: number) =>
    generateRace(
      params(
        Array.from({ length: 6 }, (_, i) => car({ paceMs: 90_600 - 120 * i, sigmaMs: 50 })),
        { laps: 10, pass: { ...GENERATOR_DEFAULTS.pass, hazardPerS: (advantageMs) => (advantageMs > 0 ? hazard : 0) } },
      ),
      seed,
    ).race;

  it('no pass happens with hazardPerS 0', () => {
    for (const seed of [1, 2]) expect(passes(reverseGrid(0, seed), 6, 10)).toBe(0);
  });

  it('the pass count rises with the hazard', () => {
    const count = (hazard: number) => [1, 2, 3].reduce((s, seed) => s + passes(reverseGrid(hazard, seed), 6, 10), 0);
    const low = count(0.0005);
    const high = count(0.2);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeGreaterThanOrEqual(5);
  });

  it('a takeoverLap closes the human span on the frame the car starts that lap, and an ai span opens there', () => {
    const { race } = busy();
    const human = spansOf(race, 'car-driver', 3);
    expect(human.map((s) => s.kind)).toEqual(['human', 'ai']);
    expect(human[0]!.startFrame).toBe(1);
    expect((human[0] as Span).endFrame).toBe(lineFrame(race, 3, 5));
    expect(human[1]!.startFrame).toBe(lineFrame(race, 3, 5));
    for (const id of [0, 1, 2]) expect(spansOf(race, 'car-driver', id).map((s) => [s.kind, s.startFrame])).toEqual([['ai', 1]]);
  });

  it('a human without a takeover stays human the whole race', () => {
    const { race } = generateRace(params([car(), car({ paceMs: 90_500, human: true })], { laps: 3 }), 2);
    expect(spansOf(race, 'car-driver', 1).map((s) => [s.kind, s.startFrame, 'endFrame' in s])).toEqual([['human', 1, false]]);
  });

  it("an SC gives the race's session-phase span: neutralised by the SC from the leader's lap fromLap to its lap toLap, racing around it", () => {
    const { race } = busy();
    const phases = spansOf(race, 'session-phase-race');
    const neutralised = phases.filter((s) => s.kind === 'neutralised');
    expect(neutralised).toHaveLength(1);
    const [sc] = neutralised as [Span];
    expect((sc.detail as { car: string }).car).toBe('SC');
    expect(race.framesOfLap(6)).toContain(sc.startFrame);
    expect(race.framesOfLap(7)).toContain(sc.endFrame);
    const at = phases.indexOf(sc);
    expect([phases[at - 1]!.kind, phases[at + 1]!.kind]).toEqual(['racing', 'racing']);
    const leaderLaps = lapsOf(race, 0);
    expect(leaderLaps.filter((l) => l.lapNumber < 6).every((l) => l.scShare === 0)).toBe(true);
    expect(leaderLaps.filter((l) => l.lapNumber === 6 || l.lapNumber === 7).every((l) => l.scShare > 0)).toBe(true);
  });

  it('without an SC no span is neutralised', () => {
    const { race } = generateRace(params([car(), car({ paceMs: 90_300 })], { laps: 3 }), 2);
    expect(spansOf(race, 'session-phase-race').some((s) => s.kind === 'neutralised')).toBe(false);
  });

  /** A lone car without scatter or tyre loss: medium to hard at the end of lap 4, wear 1.5 × the compound's. */
  const stopper = memo(
    () =>
      generateRace(
        params([car({ stops: [{ lap: 4, compound: 'hard' }], startCompound: 'medium', wearFactor: 1.5 })], { laps: 8, compounds: NO_DEG }),
        3,
      ).race,
  );

  it('a stop is a pit stop at the end of its lap onto its compound: in lap, out lap, stint, stationary time', () => {
    const race = stopper();
    const laps = lapsOf(race, 0);
    expect(laps.map((l) => l.visualCompound)).toEqual(['medium', 'medium', 'medium', 'medium', 'hard', 'hard', 'hard', 'hard']);
    expect(laps.map((l) => [l.inLap, l.outLap])).toEqual(laps.map((l) => [l.lapNumber === 4, l.lapNumber === 5]));
    const { pitStops, stints } = finalView(race).history;
    expect(pitStops.map((p) => [p.carId, p.lap])).toEqual([[0 as CarId, 4]]);
    expect(Math.abs(pitStops[0]!.stationaryTimeMs - GENERATOR_DEFAULTS.stationaryMs)).toBeLessThanOrEqual(100);
    expect(stints.map((s) => [s.firstLap, s.lastLap, s.visualCompound])).toEqual([[1, 4, 'medium']]);
  });

  it('the stop costs pitLossMs: in lap and out lap against the laps around them', () => {
    const laps = lapsOf(stopper(), 0).map((l) => l.lapTimeMs);
    const loss = laps[3]! + laps[4]! - (laps[2]! + laps[5]!);
    expect(Math.abs(loss - GENERATOR_DEFAULTS.pitLossMs)).toBeLessThanOrEqual(200);
  });

  it('laps carry the fuel from fuelStartKg down by fuelPerLapKg, and wear by the compound’s rate times the car’s wearFactor', () => {
    const { fuelStartKg, fuelPerLapKg, compounds } = GENERATOR_DEFAULTS;
    for (const l of lapsOf(stopper(), 0)) {
      expect(l.fuelAtStartKg.known && l.fuelAtEndKg.known).toBe(true);
      if (!l.fuelAtStartKg.known || !l.fuelAtEndKg.known) continue;
      expect(l.fuelAtStartKg.value).toBeCloseTo(fuelStartKg - (l.lapNumber - 1) * fuelPerLapKg, 3);
      expect(l.fuelAtEndKg.value).toBeCloseTo(fuelStartKg - l.lapNumber * fuelPerLapKg, 3);
      const gain = Math.max(
        ...(['fl', 'fr', 'rl', 'rr'] as const).map((c) => {
          const [start, end] = [l.wearAtStartPct[c], l.wearAtEndPct[c]];
          return start.known && end.known ? end.value - start.value : Number.NaN;
        }),
      );
      expect(gain).toBeCloseTo(compounds[l.visualCompound === 'hard' ? 'hard' : 'medium'].wearPctPerLap * 1.5, 3);
    }
  });

  it('rain from fromLap makes every lap wetnessMs slower', () => {
    const { race } = generateRace(params([car()], { laps: 10, compounds: NO_DEG, rain: { fromLap: 6, wetnessMs: 4_000 } }), 4);
    const laps = lapsOf(race, 0).map((l) => l.lapTimeMs);
    const step = mean(laps.slice(5, 9)) - mean(laps.slice(1, 5));
    expect(Math.abs(step - 4_000)).toBeLessThanOrEqual(400);
  });
});
