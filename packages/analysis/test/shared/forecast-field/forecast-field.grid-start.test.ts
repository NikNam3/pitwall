// The grid start (SP4.3d2 Task 7, spec §7.2 calls 4, 8, 9; contract C3, C43, C50): `forecast-field`'s second entry,
// `buildGridStart(view, outputs, { laps, grid, fittedCompound })`, the one builder of the race's starting point on the
// grid (C50). Its order is the grid, its gaps `gridGapMsPerPlace` per place, every car on a fresh set, the fuel the
// entered laps at the shared burn (`planBurnKgPerLap`, C43); a car whose `fittedCompound` is `'free'` gets
// `start.freeCompound` (the DP chooses it), a car whose compound is unknown `start.odds` (config `rivalStartOdds`
// restricted to the compounds it has a fresh set of, where its sets are visible, each with `rival-stops`'
// `byStartCompound` window); each car's pace from `weekend-pace`; the weather from the next session's forecast
// (`nextForecast`) mapped onto laps by the grid leader's pace. `buildStartingPoint` on a race view before the leader's
// lap 2 builds through it with the race's order, each car's fitted compound, nothing free; in the race a car without a
// green race lap of its own keeps `weekend-pace`'s pace.
//
// How these tests read the interface (the test agent's decisions, Task 7):
// - the grid start's `lap` is 1 and the race is played from it to `laps` (`race-forecast`'s trace: laps 1 … laps);
// - a rival's tyre sets are visible where `tyre-model`'s `freshSets` are known (C43: availability is tyre-model's); a
//   compound with 0 fresh sets has no set; `rivalStartOdds` is read only through its effect (options summing to 1);
// - `weekend-pace`'s output is given as a plain `WeekendPace` (Task 6b's unit is written apart), under `WEEKEND_PACE`.
import { carId, known, NOISE_COMPOUNDS, unknown, type CarId, type ForecastSample, type Known, type LapRecord, type NoiseCompound, type RivalStop, type RivalStops, type StartingPoint, type WeekendPace } from '@pitwall/domain';
import { asOfNow, createRng, type AsOfView, type CalculatorId, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { history, lap } from '../../../../../test-support/builders/index.ts';
import { DEGRADATION, type DegradationOutput } from '../../../src/degradation/index.ts';
import { DRIVER_NOISE } from '../../../src/driver-noise/index.ts';
import { LAP_CLASSES_CONFIG } from '../../../src/lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../../../src/per-lap-rate/index.ts';
import { RACE_INTERACTION } from '../../../src/race-interaction/index.ts';
import { createRun, forecast, policiesIn, scenarioOf } from '../../../src/race-monte-carlo/scenarios.ts';
import { scoreAll } from '../../../src/race-monte-carlo/index.ts';
import { RIVAL_STOPS } from '../../../src/rival-stops/index.ts';
import { buildGridStart, buildStartingPoint, FORECAST_FIELD_CONFIG } from '../../../src/shared/forecast-field/index.ts';
import { burnPerLapKg } from '../../../src/shared/fuel-burn.ts';
import { TYRE_MODEL } from '../../../src/tyre-model/index.ts';
import { WEEKEND_PACE } from '../../../src/weekend-pace/index.ts';
import { carOf, mcInput, RIVAL_RULES, ZERO_HAZARD } from '../../race-monte-carlo/support.ts';
import { plainModelCar } from '../../tyre-model/support.ts';
import { openSpan } from '../../situated.ts';
import { arraysOf, generated, materialised, PARAMS, plainInteraction, plainNoise, TRACK, upstreamOf } from './support.ts';

/** The race's laps as entered in the planning round. */
const LAPS = 40;
/** The qualifying session's cars: slots 0 … 5; ours 0 (the player) and 1 (the teammate). */
const CARS = 6;
const PLAYER = 0;
const TEAMMATE = 1;
/** The grid as `gridOf` would give it: car 2 on pole. */
const GRID: CarId[] = [2, 0, 3, 1, 4, 5].map(carId);
/** The grid leader's race pace (`weekend-pace`): 90 s a lap, 1.5 minutes. */
const LEADER_PACE_MS = 90_000;
const DRY: readonly NoiseCompound[] = ['soft', 'medium', 'hard'];

/** Per car `weekend-pace`'s pace: the leader's 90 s, the others slower, each its own sd. */
const PACE: Record<number, { paceMs: number; sdMs: number }> = {
  2: { paceMs: LEADER_PACE_MS, sdMs: 310 },
  0: { paceMs: 90_150, sdMs: 320 },
  3: { paceMs: 90_420, sdMs: 330 },
  1: { paceMs: 90_610, sdMs: 340 },
  4: { paceMs: 90_880, sdMs: 350 },
  5: { paceMs: 91_070, sdMs: 360 },
};

/** `weekend-pace`'s output: every car of `PACE` known, except `without`'s (`insufficientData`). */
function weekendPace(without: readonly number[] = [], at = 0): WeekendPace {
  const out: WeekendPace = {};
  for (const [car, p] of Object.entries(PACE)) {
    out[carId(Number(car))] = without.includes(Number(car)) ? unknown('insufficientData') : known({ ...p, source: 'qualifying', laps: 3 }, at);
  }
  return out;
}

/** Each car's start-compound windows: soft, medium, hard each its own, shifted by the car slot. */
function byStartCompound(car: number): NonNullable<RivalStop['byStartCompound']> {
  return {
    soft: { lowLap: 6 + car, midLap: 9 + car, highLap: 12 + car },
    medium: { lowLap: 12 + car, midLap: 17 + car, highLap: 22 + car },
    hard: { lowLap: 18 + car, midLap: 25 + car, highLap: 32 + car },
  };
}

/** `rival-stops`' qualifying row (Task 6): no stop seen, every car its `byStartCompound`. */
function rivalStops(): RivalStops {
  const out: RivalStops = {};
  for (let k = 0; k < CARS; k++) {
    out[carId(k)] = {
      owesStop: unknown('notApplicable'),
      window: unknown('notApplicable'),
      nextCompound: unknown('notApplicable'),
      basis: 'tyreLife',
      switchLap: unknown('notApplicable'),
      switchTo: unknown('notApplicable'),
      byStartCompound: byStartCompound(k),
    };
  }
  return out;
}

/**
 * The cars' fresh sets as `tyre-model` sees them: ours visible; car 2 no fresh hard; car 3 hidden (realism); car 4 no
 * fresh soft; car 5 every dry compound.
 */
const FRESH: Record<number, Partial<Record<NoiseCompound, number>> | 'hidden'> = {
  0: { soft: 3, medium: 2, hard: 2 },
  1: { soft: 3, medium: 2, hard: 2 },
  2: { soft: 2, medium: 1, hard: 0 },
  3: 'hidden',
  4: { soft: 0, medium: 2, hard: 1 },
  5: { soft: 2, medium: 2, hard: 2 },
};

/** A car's qualifying laps: four push laps of 95 s, fuel known (2 kg a lap, the builder's gain), car `k`'s own. */
function qualifyingLaps(k: number): LapRecord[] {
  return Array.from({ length: 4 }, (_, i) => {
    const n = i + 2;
    const at = n * 100_000 + k * 1_000;
    return lap({ carId: carId(k), lapNumber: n, lapTimeMs: 95_000 + k * 50, completedAt: at, visualCompound: 'soft', fuelAtStartKg: known(20 - 2 * i, at), fuelAtEndKg: known(18 - 2 * i, at), frame: Math.floor(at / 100) });
  });
}

/** The next session's (the race's) forecast: dry for 15 minutes, 80 % rain from 30 minutes on. */
const sample = (offsetMin: number, rainPct: number): ForecastSample => ({
  offsetMin,
  weather: rainPct > 50 ? 'lightRain' : 'overcast',
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 22,
  airTempTrend: 'flat',
  rainPct,
});
const RACE_FORECAST: ForecastSample[] = [sample(0, 0), sample(15, 0), sample(30, 80), sample(45, 80), sample(60, 80)];
/** This (qualifying) session's own forecast: rain everywhere, which the race's weather must not read. */
const OWN_FORECAST: ForecastSample[] = [sample(0, 100), sample(30, 100), sample(60, 100)];

/** The ended qualifying session's planning view (C62d): its `fixed.totalLaps` the entered laps, our cars 0 and 1. */
function qualifyingView(o: { nextForecast?: ForecastSample[]; weatherNow?: null } = {}): AsOfView {
  const status = Array.from({ length: CARS }, (_, k) => openSpan('car-status', 'competing', { car: k }));
  return {
    history: history({ laps: Array.from({ length: CARS }, (_, k) => qualifyingLaps(k)).flat().sort((a, b) => a.frame - b.frame) }),
    situation: { weekendPhase: { kind: 'qualifying', format: 'grandPrix', segment: 3 }, byMachine: { 'car-status': status } },
    frame: 'now',
    at: 900_000,
    config: {},
    priors: unknown('notApplicable'),
    drivers: Array.from({ length: CARS }, () => unknown('notApplicable')),
    track: TRACK,
    basis: undefined,
    outputs: new Map(),
    fixed: {
      totalLaps: known(LAPS, 0),
      playerCar: known(carId(PLAYER), 0),
      teammateCar: known(carId(TEAMMATE), 0),
      aiDifficulty: known(90, 0),
      safetyCar: unknown('notReceived'),
      carKeys: known(Array.from({ length: CARS }, (_, k) => ({ teamId: k, raceNumber: k + 1 })), 0),
      setsNow: null,
      weatherNow: o.weatherNow === null ? null : { weather: 'overcast', forecast: OWN_FORECAST, forecastAccuracy: 'perfect', nextForecast: o.nextForecast ?? RACE_FORECAST },
    },
  };
}

/** The units' outputs on the qualifying view: plain values of their declared types; `weekend-pace` as given (absent: none). */
function qualifyingOutputs(pace: WeekendPace | null = weekendPace()): Map<CalculatorId, unknown> {
  const tyreModel = Object.fromEntries(
    Array.from({ length: CARS }, (_, k) => {
      const fresh = FRESH[k]!;
      return [carId(k), plainModelCar({ lives: { soft: 14, medium: 22, hard: 32 }, freshSets: fresh === 'hidden' ? unknown('realism') : fresh })];
    }),
  );
  const degradation: DegradationOutput = { stints: {}, standIn: unknown('notApplicable') };
  const out = new Map<CalculatorId, unknown>([
    [DRIVER_NOISE, plainNoise(CARS, [PLAYER, TEAMMATE])],
    [RACE_INTERACTION, plainInteraction()],
    [TYRE_MODEL, tyreModel],
    [RIVAL_STOPS, rivalStops()],
    [DEGRADATION, degradation],
  ]);
  if (pace !== null) out.set(WEEKEND_PACE, pace);
  return out;
}

/** The planning round's compounds: ours free; car 5 fitted on mediums; every other rival unknown (drawn). */
const planningCompound = (car: CarId): Known<NoiseCompound> | 'free' =>
  car === PLAYER || car === TEAMMATE ? 'free' : car === 5 ? known<NoiseCompound>('medium', 0) : unknown('notApplicable');

/** The grid start of the qualifying view (`view`, `outputs` as given); throws when unknown. */
function gridStart(view: AsOfView = qualifyingView(), outputs: Map<CalculatorId, unknown> = qualifyingOutputs()): StartingPoint {
  const sp = buildGridStart(view, outputs, { laps: LAPS, grid: GRID, fittedCompound: planningCompound });
  if (!sp.known) throw new Error(`the grid start is unknown (${sp.reason})`);
  return sp.value;
}

const OPTS = { lapClasses: LAP_CLASSES_CONFIG.defaults, rate: PER_LAP_RATE_CONFIG.defaults };
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

describe('the grid start (SP4.3d2 Task 7)', () => {
  it('3: grid start: the grid order, gaps per place, fuel = laps × burn, tyre age 0, our cars freeCompound 1, rival odds sum to 1 and hold no compound without a set', () => {
    const view = qualifyingView();
    const sp = gridStart(view);
    expect(sp.lapsTotal).toBe(LAPS);
    expect(sp.lap).toBe(1);
    expect(sp.cars).toBe(CARS);
    expect(Array.from(sp.order)).toEqual(GRID);
    // the gaps: the config's gap per place behind the leader
    const perPlace = (FORECAST_FIELD_CONFIG.defaults as Record<string, unknown>)['gridGapMsPerPlace'];
    expect(typeof perPlace).toBe('number');
    expect(perPlace as number).toBeGreaterThan(0);
    GRID.forEach((k, i) => expect(sp.gapMs[k], `car ${k}, place ${i + 1}`).toBeCloseTo(i * (perPlace as number), 6));
    // nothing retired, every car on a fresh set
    for (let k = 0; k < CARS; k++) {
      expect(sp.retired[k], `car ${k}: retired`).toBe(0);
      expect(sp.tyreAge[k], `car ${k}: tyre age`).toBe(0);
      expect(sp.wearPct[k], `car ${k}: wear`).toBe(0);
    }
    // fuel: the entered laps at the shared burn (its measured burn, `planBurnKgPerLap`, C43)
    const laps = view.history.laps as readonly LapRecord[];
    for (let k = 0; k < CARS; k++) {
      const measured = burnPerLapKg(laps.filter((l) => l.carId === k), OPTS);
      expect(measured.known, `car ${k}: a measured burn`).toBe(true);
      if (measured.known) expect(sp.fuelBurnKgPerLap[k], `car ${k}: burn`).toBeCloseTo(measured.value, 9);
      expect(sp.fuelKg[k], `car ${k}: fuel`).toBeCloseTo(LAPS * sp.fuelBurnKgPerLap[k]!, 6);
    }
    // the start: our cars free, the rest not
    expect(sp.start).not.toBeNull();
    const start = sp.start!;
    expect(Array.from(start.freeCompound)).toEqual([1, 1, 0, 0, 0, 0]);
    // our cars draw nothing; the fitted rival keeps its compound and draws nothing
    expect(start.odds[PLAYER]).toBeNull();
    expect(start.odds[TEAMMATE]).toBeNull();
    expect(start.odds[5]).toBeNull();
    expect(NOISE_COMPOUNDS[sp.compound[5]!]).toBe('medium');
    // the unknown rivals: odds summing to 1, each a dry compound with its byStartCompound window, none without a fresh set
    for (const k of [2, 3, 4]) {
      const options = start.odds[k];
      expect(options, `car ${k}: odds`).not.toBeNull();
      expect(options!.length, `car ${k}: options`).toBeGreaterThan(0);
      expect(sum(options!.map((o) => o.p)), `car ${k}: odds sum`).toBeCloseTo(1, 9);
      const fresh = FRESH[k]!;
      for (const o of options!) {
        expect(o.p, `car ${k} ${o.compound}`).toBeGreaterThanOrEqual(0);
        expect(DRY, `car ${k}: ${o.compound} is a dry compound`).toContain(o.compound);
        if (fresh !== 'hidden') expect(fresh[o.compound] ?? 0, `car ${k}: ${o.compound} has a fresh set`).toBeGreaterThan(0);
        const w = byStartCompound(k)[o.compound]!;
        expect({ stopLow: o.stopLow, stopMid: o.stopMid, stopHigh: o.stopHigh }, `car ${k} ${o.compound}: its window`).toEqual({ stopLow: w.lowLap, stopMid: w.midLap, stopHigh: w.highLap });
      }
    }
    expect(start.odds[2]!.map((o) => o.compound)).not.toContain('hard');
    expect(start.odds[4]!.map((o) => o.compound)).not.toContain('soft');
    // hidden sets: every compound of the config's odds (a hidden rival is not restricted)
    expect(start.odds[3]!.length).toBeGreaterThanOrEqual(start.odds[2]!.length);
    // no NaN anywhere (C3)
    for (const [name, values] of arraysOf(sp)) for (let i = 0; i < values.length; i++) expect(Number.isNaN(values[i]), `${name}[${i}]`).toBe(false);
  });

  it('4: the race\'s grid: a race view before the leader\'s lap 2 gives a known starting point with the fitted compounds and freeCompound all 0', () => {
    // a generated race whose even cars start on softs, the odd ones on mediums
    const params = { ...PARAMS, field: PARAMS.field.map((car, i) => ({ ...car, startCompound: (i % 2 === 0 ? 'soft' : 'medium') as NoiseCompound })) };
    const g = generated(params, 7);
    const lap1 = g.race.framesOfLap(1);
    for (const frame of [lap1[0]!, lap1[Math.floor(lap1.length / 2)]!]) {
      const view = materialised(asOfNow(g.viewAt(frame)));
      const pace: WeekendPace = Object.fromEntries(Array.from({ length: params.cars }, (_, k) => [carId(k), known({ paceMs: 90_000 + 100 * k, sdMs: 300, source: 'qualifying' as const, laps: 3 }, 0)]));
      const outputs = new Map([...upstreamOf(view, plainNoise(params.cars, [6, 7], view.at)), [WEEKEND_PACE, pace]]);
      const sp = buildStartingPoint(view, outputs);
      expect(sp.known, `frame ${frame}: ${sp.known ? '' : sp.reason}`).toBe(true);
      if (!sp.known) continue;
      expect(sp.value.lapsTotal, `frame ${frame}`).toBe(params.laps);
      expect(sp.value.start, `frame ${frame}: a grid start`).not.toBeNull();
      expect(Array.from(sp.value.start!.freeCompound), `frame ${frame}`).toEqual(Array.from({ length: params.cars }, () => 0));
      expect([...sp.value.order].sort((a, b) => a - b), `frame ${frame}: every car once`).toEqual(Array.from({ length: params.cars }, (_, k) => k));
      for (let k = 0; k < params.cars; k++) {
        expect(NOISE_COMPOUNDS[sp.value.compound[k]!], `frame ${frame}, car ${k}: its fitted compound`).toBe(k % 2 === 0 ? 'soft' : 'medium');
        // a fitted compound is known: nothing drawn
        expect(sp.value.start!.odds[k] ?? null, `frame ${frame}, car ${k}: no odds`).toBeNull();
      }
    }
  });

  it('5: laps: a 0-stop plan in the Monte Carlo plays exactly `laps` laps from the grid start', () => {
    const sp = gridStart();
    const run = createRun(sp, ZERO_HAZARD(LAPS), RIVAL_RULES, { [TEAMMATE]: { startCompound: 'medium', stops: [] } }, createRng(5));
    const noStop = { startCompound: 'hard' as const, stops: [] };
    for (let id = 0; id < 5; id++) {
      const r = forecast(run, policiesIn(run, id, PLAYER, noStop), scenarioOf(run, id).scenario, { trace: true });
      expect(r.trace!.map((t) => t.lap), `scenario ${id}`).toEqual(Array.from({ length: LAPS }, (_, i) => i + 1));
      // our car's race time is its `laps` lap times
      const laps = r.trace!.map((t) => t.lapTimeMs[PLAYER]!);
      // every lap played until the car finishes (lapped) or retires; none after (C3: 0 only past its race)
      const end = laps.findIndex((ms) => ms === 0);
      expect(laps.slice(0, end === -1 ? laps.length : end).every((ms) => ms > 0), `scenario ${id}: laps played`).toBe(true);
      if (end !== -1) expect(laps.slice(end).every((ms) => ms === 0), `scenario ${id}: nothing after its end`).toBe(true);
      // a retired car (plainNoise's retire rate) has no race time; it must have stopped playing laps
      if (r.raceTimeMs[PLAYER] === 0) {
        expect(end, `scenario ${id}: retired`).not.toBe(-1);
        continue;
      }
      expect(r.raceTimeMs[PLAYER], `scenario ${id}`).toBeGreaterThan(LAPS * 0.9 * PACE[PLAYER]!.paceMs);
      expect(r.raceTimeMs[PLAYER], `scenario ${id}`).toBeLessThan(LAPS * 1.2 * PACE[PLAYER]!.paceMs);
    }
    // the Monte Carlo scores the 0-stop plan from the grid start
    const result = scoreAll(mcInput(sp, { [PLAYER]: [noStop] }), createRng(3), 40);
    const row = carOf(result, PLAYER).rows[0]!;
    expect(Number.isFinite(row.meanMs)).toBe(true);
    expect(row.meanMs).toBeGreaterThan(LAPS * 0.9 * PACE[PLAYER]!.paceMs);
    expect(row.meanMs).toBeLessThan(LAPS * 1.2 * PACE[PLAYER]!.paceMs);
  });

  it("6b: pace: the grid start's paceMs and paceSdMs per car are weekend-pace's", () => {
    const sp = gridStart();
    for (let k = 0; k < CARS; k++) {
      expect(sp.paceMs[k], `car ${k}: pace`).toBeCloseTo(PACE[k]!.paceMs, 6);
      expect(sp.paceSdMs[k], `car ${k}: sd`).toBeCloseTo(PACE[k]!.sdMs, 6);
    }
  });

  it("6b: pace: weekend-pace's declared stand-in is read like any pace (SP4.3e Task 6); a car without weekend-pace's pace and without degradation's stand-in makes the grid start unknown('insufficientData'), never 0 (C3)", () => {
    const pace = weekendPace();
    pace[carId(3)] = known({ paceMs: 91_234, sdMs: 900, source: 'standIn', laps: 0 }, 0);
    const standIn = gridStart(qualifyingView(), qualifyingOutputs(pace));
    expect(standIn.paceMs[3], 'car 3: the stand-in pace').toBeCloseTo(91_234, 6);
    expect(standIn.paceSdMs[3], 'car 3: the stand-in sd').toBeCloseTo(900, 6);
    // without qualifying evidence in the field weekend-pace has no stand-in (G5): still insufficientData
    const missing = buildGridStart(qualifyingView(), qualifyingOutputs(weekendPace([3])), { laps: LAPS, grid: GRID, fittedCompound: planningCompound });
    expect(missing).toEqual(unknown('insufficientData'));
    const none = buildGridStart(qualifyingView(), qualifyingOutputs(null), { laps: LAPS, grid: GRID, fittedCompound: planningCompound });
    expect(none).toEqual(unknown('insufficientData'));
  });

  describe('6b: pace in the race after the grid (call 9)', () => {
    const g = generated();
    /** The car whose race laps are not green: every lap it completed behind the safety car. */
    const SLOW = 3;
    /** The leader's lap 4: every other car has completed a lap after lap 1. */
    const frame = g.race.framesOfLap(4)[0]!;
    const base = materialised(asOfNow(g.viewAt(frame)));
    const laps = (base.history.laps as readonly LapRecord[]).map((l): LapRecord => (l.carId === SLOW ? { ...l, scShare: 1 } : l));
    const view: AsOfView = { ...base, history: { ...base.history, laps } as Projection };
    const upstream = upstreamOf(view, plainNoise(PARAMS.cars, [6, 7], view.at));
    const racePace = (without: readonly number[] = []): WeekendPace =>
      Object.fromEntries(Array.from({ length: PARAMS.cars }, (_, k) => [carId(k), without.includes(k) ? unknown('insufficientData') : known({ paceMs: 93_000 + 37 * k, sdMs: 280 + k, source: 'longRun' as const, laps: 12 }, 0)]));
    const build = (pace: WeekendPace | undefined): StartingPoint => {
      const outputs = new Map(upstream);
      if (pace !== undefined) outputs.set(WEEKEND_PACE, pace);
      const sp = buildStartingPoint(view, outputs);
      if (!sp.known) throw new Error(`unknown (${sp.reason})`);
      return sp.value;
    };

    it('precondition: the leader is past lap 2, and every car but the slow one has a green race lap', () => {
      const sp = build(undefined);
      expect(sp.lap).toBeGreaterThanOrEqual(3);
      expect(sp.start).toBeNull();
      for (let k = 0; k < PARAMS.cars; k++) {
        const own = laps.filter((l) => l.carId === k);
        if (k === SLOW) expect(own.every((l) => l.scShare > 0), 'the slow car: no green lap').toBe(true);
        else expect(own.some((l) => l.lapNumber >= 2 && l.scShare === 0 && l.vscShare === 0), `car ${k}: a green lap`).toBe(true);
      }
    });

    it("a car whose race laps are not yet green keeps weekend-pace's pace after the leader's lap 2; the others race on their own laps", () => {
      const without = build(undefined);
      const withPace = build(racePace());
      expect(withPace.paceMs[SLOW]).toBeCloseTo(93_000 + 37 * SLOW, 6);
      expect(withPace.paceSdMs[SLOW]).toBeCloseTo(280 + SLOW, 6);
      for (let k = 0; k < PARAMS.cars; k++) {
        if (k === SLOW) continue;
        expect(withPace.paceMs[k], `car ${k}: its own laps`).toBeCloseTo(without.paceMs[k]!, 6);
        expect(withPace.paceSdMs[k], `car ${k}`).toBeCloseTo(without.paceSdMs[k]!, 6);
      }
    });

    it("without weekend-pace's pace for the car the stand-in rule as today: the build equals one without weekend-pace", () => {
      const without = build(undefined);
      const unknownForSlow = build(racePace([SLOW]));
      expect(Array.from(unknownForSlow.paceMs)).toEqual(Array.from(without.paceMs));
      expect(Array.from(unknownForSlow.paceSdMs)).toEqual(Array.from(without.paceSdMs));
    });
  });

  it('6: weather: the race forecast (nextForecast) with rain at +30 min → the laps after ~30 min carry it, by the grid leader\'s pace', () => {
    const sp = gridStart();
    expect(sp.weather.known).toBe(true);
    if (!sp.weather.known) return;
    const byLap = sp.weather.value.byLap;
    expect(byLap.map((l) => l.lap)).toEqual(Array.from({ length: LAPS }, (_, i) => i + 1));
    expect(sp.weather.value.accuracy).toBe('perfect');
    // the leader's lap L ends at L × 1.5 minutes: laps 1 … 9 lie before 15 minutes, laps 22 on after 30
    for (const l of byLap) {
      if (l.lap <= 9) expect(l.rainPct, `lap ${l.lap}`).toBe(0);
      if (l.lap >= 22) expect(l.rainPct, `lap ${l.lap}`).toBe(80);
    }
    for (let i = 1; i < byLap.length; i++) expect(byLap[i]!.rainPct, `lap ${byLap[i]!.lap}`).toBeGreaterThanOrEqual(byLap[i - 1]!.rainPct);
    // never this session's own forecast (rain everywhere)
    expect(byLap.some((l) => l.rainPct < 100)).toBe(true);
  });

  it("6: weather: without the race forecast's samples unknown('notReceived'); the grid start stays known", () => {
    expect(gridStart(qualifyingView({ nextForecast: [] })).weather).toEqual(unknown('notReceived'));
    expect(gridStart(qualifyingView({ weatherNow: null })).weather).toEqual(unknown('notReceived'));
  });
});
