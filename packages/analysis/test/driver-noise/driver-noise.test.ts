// `driver-noise` on generated races (SP4.3a spec 5.2, plan Task 10; contract C3, C33, C41, C44): per car its core
// scatter σ (1.4826 · MAD of its free-air residuals against `degradation`'s stint, minus `track-wetness`'s common mode),
// its lag-1 correlation ρ, its mistakes, big events and retirements, AI or human by its car-driver span at the lap's
// frame. A quick calculator (C31) recomputing at every completed lap; its scheduled run is its "as of" form at the
// current frame (spec 6.1).
//
// Rows (plan Task 10): R1 recovery, R2 as of frame N, R3 rewind, R4 the generic tests see it, row 6 a takeover, and the
// weekend-phase row (notApplicable outside the race). R5 is `driver-noise.budget.test.ts`; rows 7-11 `rows.test.ts`.
//
// Races come from the test-race generator (spec 6.4), each generated once per file in `beforeAll`, at the smallest
// size that shows its row (plan review P8). R1's field is the brief's (20 AI cars σ 200, two humans σ 450 and 900, 50
// laps), laid out so most laps are free air: the AI cars 55 ms a lap apart from the pole (fastest) back, so nobody is
// lapped and the gaps open, the humans behind them 0.8 and 1.6 s a lap slower, no stops. One race of that size holds
// about 25 free-air laps per car, too few for one car's σ and ρ: R1 pools six seeds of it and compares the means.
import { carId, unknown, type CarNoise, type DriverNoise, type WeekendPhase } from '@pitwall/domain';
import { asOfNow, projectionAsOf, type EngineView } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { driverNoiseCalculator } from '../../src/driver-noise/calculator.ts';
import { DRIVER_NOISE, driverNoiseAsOf } from '../../src/driver-noise/index.ts';
import { CAR_STATUS_READS } from '../../src/shared/car-status.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { guardedQuick, NONE, PRACTICE, QUALIFYING } from '../situated.ts';
import { CALCULATORS, loadUnitFolders } from '../units.ts';
import { lapConfirmedFrame, leaderCrossings, viewAt, withAppendFrames } from './support.ts';

const calc = guardedQuick(driverNoiseCalculator);

/** A generator car on mediums all race, no stop. */
const genCar = (paceMs: number, over: Partial<GeneratorCar> = {}): GeneratorCar => ({
  paceMs,
  human: false,
  sigmaMs: 200,
  rho: 0.3,
  mistakeRate: 0.02,
  mistakeMedianMs: 1_500,
  mistakeSigmaLog: 0.6,
  wearFactor: 1,
  stops: [],
  startCompound: 'medium',
  ...over,
});

const params = (field: GeneratorCar[], over: Partial<GeneratorParams> = {}): GeneratorParams => ({ ...GENERATOR_DEFAULTS, cars: field.length, field, ...over });

/** Shrinkage off (`shrinkLaps` 0): the output is the session's own estimate, the thing R1 recovers. */
const SESSION_ONLY: EngineView['config'] = { 'driver-noise': { shrinkLaps: 0 } };

// R1's truth: the brief's field.
const AI = { sigmaMs: 200, rho: 0.3, mistakeRate: 0.02 } as const;
const HUMANS = [
  { car: 20, sigmaMs: 450, rho: 0.4 },
  { car: 21, sigmaMs: 900, rho: 0.4 },
] as const;
const R1_FIELD: GeneratorCar[] = [
  ...Array.from({ length: 20 }, (_, i) => genCar(90_000 + 55 * i, { sigmaMs: AI.sigmaMs, rho: AI.rho, mistakeRate: AI.mistakeRate })),
  ...HUMANS.map((h, k) => genCar(90_000 + 55 * 19 + 800 * (k + 1), { human: true, sigmaMs: h.sigmaMs, rho: h.rho, mistakeRate: 0.05 })),
];
const R1_SEEDS = [1, 2, 3, 4, 5, 6];

/** R2, R3: 6 cars over 12 laps 400 ms a lap apart, car 5 a human, car 2 stopping once for hards. */
const SMALL = params(
  Array.from({ length: 6 }, (_, i) => genCar(90_000 + 400 * i, { ...(i === 5 && { human: true, sigmaMs: 450 }), ...(i === 2 && { stops: [{ lap: 5, compound: 'hard' }] }) })),
  { laps: 12 },
);

/** Row 6: car 5, a human, handed to the AI at the start of lap 20 of 30; its twin race the same with car 5 an AI car from the start. */
const TAKEOVER_LAP = 20;
const TAKEOVER_LAPS = 30;
const takeoverField = (takeover: boolean): GeneratorCar[] =>
  Array.from({ length: 6 }, (_, i) => genCar(90_000 + 400 * i, i === 5 ? { human: takeover, sigmaMs: 450, ...(takeover && { takeoverLap: TAKEOVER_LAP }) } : {}));

let r1Races: BuilderRace[];
let small: BuilderRace;
let takeover: BuilderRace;
let twin: BuilderRace;

beforeAll(() => {
  r1Races = R1_SEEDS.map((seed) => generateRace(params(R1_FIELD), seed).race);
  small = generateRace(SMALL, 3).race;
  takeover = generateRace(params(takeoverField(true), { laps: TAKEOVER_LAPS }), 4).race;
  twin = generateRace(params(takeoverField(false), { laps: TAKEOVER_LAPS }), 4).race;
});

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const valueOf = (k: CarNoise['sigmaMs']): number => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

const carOf = (out: DriverNoise, car: number): CarNoise => {
  const noise = out.cars[carId(car)];
  if (noise === undefined) throw new Error(`no entry for car ${car}`);
  return noise;
};

describe('driver-noise on generated races (spec 5.2)', () => {
  it("R1: recovers the generator's parameters within its noise", () => {
    const aiCars = Array.from({ length: 20 }, (_, i) => i);
    // each race's output at the flag, shrinkage off
    const r1: { out: DriverNoise }[] = r1Races.map((race) => ({ out: calc.compute(viewAt(race, race.lastFrame, { config: SESSION_ONLY })) }));

    // σ within 15 %: the AI field's median σ per race, and each human's, averaged over the races
    const aiSigma = mean(r1.map(({ out }) => median(aiCars.map((c) => valueOf(carOf(out, c).sigmaMs)))));
    expect(Math.abs(aiSigma - AI.sigmaMs) / AI.sigmaMs, `AI σ ${aiSigma.toFixed(0)}`).toBeLessThanOrEqual(0.15);
    for (const h of HUMANS) {
      for (const { out } of r1) expect(carOf(out, h.car).driver).toBe('human');
      const sigma = mean(r1.map(({ out }) => valueOf(carOf(out, h.car).sigmaMs)));
      expect(Math.abs(sigma - h.sigmaMs) / h.sigmaMs, `human ${h.car} σ ${sigma.toFixed(0)}`).toBeLessThanOrEqual(0.15);
    }

    // ρ within 0.1: the AI field's mean ρ per race, and each human's, averaged over the races
    const aiRho = mean(r1.map(({ out }) => mean(aiCars.map((c) => valueOf(carOf(out, c).rho)))));
    expect(Math.abs(aiRho - AI.rho), `AI ρ ${aiRho.toFixed(2)}`).toBeLessThanOrEqual(0.1);
    for (const h of HUMANS) {
      const rho = mean(r1.map(({ out }) => valueOf(carOf(out, h.car).rho)));
      expect(Math.abs(rho - h.rho), `human ${h.car} ρ ${rho.toFixed(2)}`).toBeLessThanOrEqual(0.1);
    }

    // the AI field's mistake rate within its binomial 95 % band, over the laps the AI cars' models rest on
    let laps = 0;
    let mistakes = 0;
    for (const { out } of r1) {
      const n = aiCars.reduce((s, c) => s + carOf(out, c).laps, 0);
      laps += n;
      mistakes += valueOf(out.aiField.mistakeRatePerLap) * n;
    }
    expect(laps).toBeGreaterThan(0);
    const rate = mistakes / laps;
    const band = 1.96 * Math.sqrt((AI.mistakeRate * (1 - AI.mistakeRate)) / laps);
    expect(Math.abs(rate - AI.mistakeRate), `AI mistake rate ${rate.toFixed(4)} over ${laps} laps, band ±${band.toFixed(4)}`).toBeLessThanOrEqual(band);
  });

  it('R2: as of frame N equals the scheduled run at every leader crossing frame', () => {
    const frames = leaderCrossings(small);
    expect(frames.length).toBeGreaterThanOrEqual(SMALL.laps);
    const source = withAppendFrames(small, frames);
    for (const frame of frames) {
      // the upstream outputs of the scheduled run at N
      const view = viewAt(small, frame);
      const cut = projectionAsOf(source, frame);
      const asOf = { ...asOfNow(view), history: cut.history, situation: cut.situation, frame, outputs: view.outputs };
      expect(driverNoiseAsOf(asOf), `frame ${frame}`).toEqual(calc.compute(view));
    }
  });

  it('R3: rewind: after a flashback the output equals a run without the undone frames (C33)', () => {
    const target = small.framesOfLap(8)[0]!;
    const undone = small.framesOfLap(11)[0]!;
    // the view at the target whose delta rewinds from the later frame: the projection after the void
    const rewound = viewAt(small, target, { from: undone });
    expect(rewound.delta.rewound).toBeDefined();
    const fresh = calc.compute(viewAt(small, target));
    expect(calc.compute(rewound)).toEqual(fresh);
    // the undone laps did count before the flashback
    expect(calc.compute(viewAt(small, undone))).not.toEqual(fresh);
  });

  it('R4: guarded view and behaviour-table completeness pick it up (C41, C44)', async () => {
    expect(CALCULATORS.find((c) => c.id === DRIVER_NOISE)).toBe(driverNoiseCalculator);
    expect(driverNoiseCalculator.kind).toBe('quick');
    expect(driverNoiseCalculator.cadence).toBe('lapCompleted');
    // the brief's reads (`miniSectors` is the crossings list's change tag)
    expect(driverNoiseCalculator.reads).toEqual(
      expect.arrayContaining([
        'laps',
        'stints',
        'miniSectors',
        'events',
        'drivers',
        'spans:car-driver',
        CAR_STATUS_READS,
        'spans:weekend-phase',
        { calculator: 'degradation' },
        { calculator: 'track-wetness' },
      ]),
    );
    const folder = (await loadUnitFolders()).find((f) => f.unit === DRIVER_NOISE);
    expect(Object.keys(folder?.table ?? {}).sort()).toEqual(['car-driver', 'car-status', 'weekend-phase']);
  });

  it('6: a takeover at lap 20 switches the model: laps before count as human, after as AI', () => {
    const car = 5;
    // before the takeover (lap 17 confirmed): the human model
    const before = carOf(calc.compute(viewAt(takeover, lapConfirmedFrame(takeover, car, 17))), car);
    expect(before.driver).toBe('human');
    expect(before.laps).toBeGreaterThan(0);
    expect(before.laps).toBeLessThanOrEqual(17);

    // just after it (lap 21 confirmed): the AI model, from its prior, on the laps since the takeover only (lap 19's
    // record describes the takeover's frame, so at most laps 19 to 21)
    const after = carOf(calc.compute(viewAt(takeover, lapConfirmedFrame(takeover, car, TAKEOVER_LAP + 1))), car);
    expect(after.driver).toBe('ai');
    expect(after.laps).toBeLessThanOrEqual(3);

    // at the flag: the AI model rests on the laps after the takeover; the twin, an AI car all race, on many more
    const end = carOf(calc.compute(viewAt(takeover, takeover.lastFrame)), car);
    const all = carOf(calc.compute(viewAt(twin, twin.lastFrame)), car);
    expect(end.driver).toBe('ai');
    expect(all.driver).toBe('ai');
    expect(end.laps).toBeGreaterThan(0);
    expect(end.laps).toBeLessThanOrEqual(TAKEOVER_LAPS - TAKEOVER_LAP + 2);
    expect(all.laps - end.laps).toBeGreaterThanOrEqual(10);
  });

  it('outside the race phase it is notApplicable (its weekend-phase row, C14)', () => {
    const view = viewAt(small, small.lastFrame);
    /** The view with its weekend phase, and its open `weekend-phase` span, `phase`'s. */
    const inPhase = (phase: WeekendPhase): EngineView => {
      const { kind, ...detail } = phase;
      const spans = view.situation.byMachine['weekend-phase'] ?? [];
      return { ...view, situation: { weekendPhase: phase, byMachine: { ...view.situation.byMachine, 'weekend-phase': spans.map((s) => ({ ...s, kind, detail })) } } };
    };
    const na = unknown('notApplicable');
    for (const phase of [PRACTICE, QUALIFYING, NONE]) {
      const out = calc.compute(inPhase(phase));
      expect(out.aiField, phase.kind).toEqual({ mistakeRatePerLap: na, bigEventRatePerLap: na, retireRatePerLap: na });
      for (const [car, noise] of Object.entries(out.cars)) expect(noise.sigmaMs, `${phase.kind} car ${car}`).toEqual(na);
    }
  });
});
