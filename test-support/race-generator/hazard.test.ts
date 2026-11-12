// The generator's SC/VSC and rain (SP4.3b spec §10, plan 4.3b1 Task 15): neutralisations drawn per leader lap from a
// known `TrackHazard` (lap 1 from `lapOne`, later laps from `byFraction` by race fraction, lengths from `durationLaps`),
// recorded as `neutralised` session-phase spans; rain from a timeline. A start on lap n lasting d laps is deployed during
// the leader's lap n and in during its lap n + d - 1 (as 4.3a's fixed `sc` from `fromLap` to `toLap`). The statistical
// rows share one sample of 2,000 lone-car races, generated once (P8). Seeded, so each row's verdict is fixed (C2).
import { describe, expect, it } from 'vitest';
import type { MachineId, OpenSpan, Span, TrackHazard } from '../../packages/domain/src/index.ts';
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

const params = (field: GeneratorCar[], over: Partial<GeneratorParams> = {}): GeneratorParams => ({ ...GENERATOR_DEFAULTS, cars: field.length, field, ...over });

const NO_DEG = Object.fromEntries(
  Object.entries(GENERATOR_DEFAULTS.compounds).map(([c, v]) => [c, { ...v, degMsPerLap: 0 }]),
) as GeneratorParams['compounds'];

const PHASES = 'session-phase-race' as MachineId;
const RACES = 2_000;
const LAPS = 12;

/** Chances high enough that 2,000 races of 12 laps give every lap and every duration a few hundred draws. */
const HAZARD: TrackHazard = {
  races: 50,
  lapOne: { sc: 0.12, vsc: 0.08 },
  byFraction: [
    { upTo: 0.37, sc: 0.05, vsc: 0.04 },
    { upTo: 0.71, sc: 0.03, vsc: 0.06 },
    { upTo: 1, sc: 0.07, vsc: 0.03 },
  ],
  durationLaps: { sc: [0.25, 0.45, 0.3], vsc: [0.55, 0.45] },
};
const MAX_DURATION = Math.max(HAZARD.durationLaps.sc.length, HAZARD.durationLaps.vsc.length);

/**
 * The table's chance for lap `lap` of `laps`, or `undefined` where the bin depends on how the race fraction is read
 * ((lap - 1) / laps, (lap - 0.5) / laps or lap / laps; `upTo` inclusive or not): such a lap is not checked.
 */
function chanceOn(hazard: TrackHazard, lap: number, laps: number, kind: 'sc' | 'vsc'): number | undefined {
  if (lap === 1) return hazard.lapOne[kind];
  const binOf = (f: number, inclusive: boolean): number => hazard.byFraction.findIndex((b) => (inclusive ? f <= b.upTo : f < b.upTo));
  const bins = new Set([lap - 1, lap - 0.5, lap].flatMap((x) => [binOf(x / laps, true), binOf(x / laps, false)].filter((b) => b >= 0)));
  return bins.size === 1 ? hazard.byFraction[[...bins][0]!]![kind] : undefined;
}

type Neutralisation = { kind: 'sc' | 'vsc'; startLap: number; /** `Infinity` while still out at the race's end. */ endLap: number };

/** The race's neutralisations in start order, each with the leader laps it was deployed and in during. */
function neutralisations(race: BuilderRace): Neutralisation[] {
  const lapOf = new Map<number, number>();
  for (let lap = 1; lap <= race.laps; lap++) for (const frame of race.framesOfLap(lap)) lapOf.set(frame, lap);
  const { history, situation } = race.viewAt(race.lastFrame);
  const spans: Array<Span | OpenSpan> = [...(history.spans[PHASES] ?? []), ...(situation.byMachine[PHASES] ?? [])];
  return spans
    .filter((s) => s.kind === 'neutralised')
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((s) => {
      const car = (s.detail as { car: 'SC' | 'VSC' }).car;
      const endFrame = 'endFrame' in s ? s.endFrame : undefined;
      return {
        kind: car === 'SC' ? 'sc' : 'vsc',
        startLap: lapOf.get(s.startFrame) ?? Number.NaN,
        endLap: endFrame === undefined ? Infinity : (lapOf.get(endFrame) ?? Infinity),
      };
    });
}

/** 2,000 lone-car races of 12 laps under `HAZARD`, seeds 1 to 2,000: each race's neutralisations. */
const sample = memo(() => {
  const p = params([car()], { laps: LAPS, hazard: HAZARD });
  return Array.from({ length: RACES }, (_, i) => neutralisations(generateRace(p, i + 1).race));
});

/** Whether `lap` is open to a start: no earlier neutralisation is out on it or ended on the lap before it. */
const eligible = (race: Neutralisation[], lap: number): boolean => race.every((n) => n.startLap >= lap || n.endLap <= lap - 2);

const within3Se = (observed: number, n: number, p: number, label: string): void => {
  const se = Math.sqrt((p * (1 - p)) / n);
  expect(Math.abs(observed / n - p), `${label}: ${observed}/${n} against ${p} (SE ${se.toFixed(4)})`).toBeLessThanOrEqual(3 * se);
};

describe('generateRace: SC and VSC from a hazard table (Task 15)', () => {
  it(`over 2,000 generated races the SC and VSC start counts per lap match the hazard within 3 SE`, { timeout: 120_000 }, () => {
    const races = sample();
    expect(races.flat().length).toBeGreaterThan(RACES / 2);
    let checked = 0;
    for (let lap = 1; lap <= LAPS; lap++) {
      const open = races.filter((r) => eligible(r, lap));
      for (const kind of ['sc', 'vsc'] as const) {
        const p = chanceOn(HAZARD, lap, LAPS, kind);
        if (p === undefined) continue;
        const starts = open.filter((r) => r.some((n) => n.kind === kind && n.startLap === lap)).length;
        within3Se(starts, open.length, p, `${kind} on lap ${lap}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2 * (LAPS - 2));
  });

  it('durations follow the pmf', { timeout: 120_000 }, () => {
    // Only starts whose longest duration still ends within the race: none is cut short by the flag.
    const full = sample()
      .flat()
      .filter((n) => n.startLap + MAX_DURATION - 1 <= LAPS);
    for (const kind of ['sc', 'vsc'] as const) {
      const mine = full.filter((n) => n.kind === kind);
      const pmf = HAZARD.durationLaps[kind];
      expect(mine.length, kind).toBeGreaterThan(200);
      for (const n of mine) expect(n.endLap - n.startLap + 1, `${kind} from lap ${n.startLap}`).toBeLessThanOrEqual(pmf.length);
      pmf.forEach((p, i) => within3Se(mine.filter((n) => n.endLap - n.startLap + 1 === i + 1).length, mine.length, p, `${kind} lasting ${i + 1}`));
    }
  });

  it('no start while one is out or on the lap after', { timeout: 120_000 }, () => {
    const races = sample();
    expect(races.filter((r) => r.length >= 2).length).toBeGreaterThan(50);
    for (const race of races) {
      for (let i = 1; i < race.length; i++) {
        const [before, next] = [race[i - 1]!, race[i]!];
        expect(next.startLap, `a start after one in during lap ${before.endLap}`).toBeGreaterThanOrEqual(before.endLap + 2);
      }
    }
  });
});

describe('generateRace: rain from a timeline (Task 15)', () => {
  it('a rain timeline sets the wetness per lap', () => {
    const timeline = [
      { fromLap: 3, wetnessMs: 2_000 },
      { fromLap: 6, wetnessMs: 5_000 },
      { fromLap: 9, wetnessMs: 0 },
    ];
    const expected = (lap: number): number => timeline.filter((e) => e.fromLap <= lap).at(-1)?.wetnessMs ?? 0;
    const lapTimes = (over: Partial<GeneratorParams>): number[] => {
      const { race } = generateRace(params([car()], { laps: 11, compounds: NO_DEG, ...over }), 4);
      return race
        .viewAt(race.lastFrame)
        .history.laps.filter((l) => l.status === 'confirmed' && (l.carId as number) === 0)
        .sort((a, b) => a.lapNumber - b.lapNumber)
        .map((l) => l.lapTimeMs);
    };
    const dry = lapTimes({});
    const wet = lapTimes({ rain: { timeline } });
    expect(wet).toHaveLength(11);
    wet.forEach((t, i) => expect(Math.abs(t - dry[i]! - expected(i + 1)), `lap ${i + 1}`).toBeLessThanOrEqual(250));
  });
});

describe('generateRace: hazard and rain stay seeded (Task 15, C2)', () => {
  it('same seed, same race', () => {
    const p = params([car({ sigmaMs: 200, rho: 0.3 }), car({ paceMs: 90_400, sigmaMs: 200, rho: 0.3 })], {
      laps: 10,
      hazard: { ...HAZARD, lapOne: { sc: 0.3, vsc: 0.2 }, byFraction: [{ upTo: 1, sc: 0.15, vsc: 0.1 }] },
      rain: { timeline: [{ fromLap: 4, wetnessMs: 3_000 }] },
    });
    const a = generateRace(p, 7).race;
    const b = generateRace(p, 7).race;
    expect(b.lastFrame).toBe(a.lastFrame);
    expect(b.viewAt(b.lastFrame).history).toEqual(a.viewAt(a.lastFrame).history);
    expect(b.viewAt(b.lastFrame).situation).toEqual(a.viewAt(a.lastFrame).situation);
    const bySeed = Array.from({ length: 10 }, (_, i) => JSON.stringify(neutralisations(generateRace(p, i + 1).race)));
    expect(bySeed.some((s) => s !== '[]')).toBe(true);
    expect(new Set(bySeed).size).toBeGreaterThan(1);
  });
});
