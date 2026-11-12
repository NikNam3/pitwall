// `forecast-field` (SP4.3a spec 6.1, plan Task 16; C3, C8, C26, C28, C43, C50): the only builder of the simulators'
// starting point. Rows 1 to 6 and 8 of the task; row 7 (the budget) is `forecast-field.budget.test.ts`.
//
// The live build is `buildStartingPoint` on the view after frame N (uncut, `asOfNow`) with the lap progress at the
// leader's crossing given; the as-of build is `startingPointAt` on the race's final projection, cut at N. Both views
// carry the time of the leader's crossing as `at` (the moment the scoreboard forecasts from) and the same fixed inputs.
// The truth of the lap progress is the generator's: each car's distance between its own crossings, and the gap the
// time since the leader was at that distance.
import {
  carId,
  known,
  MINI_SECTORS,
  NOISE_COMPOUNDS,
  unknown,
  type CarId,
  type Corners,
  type FrameNumber,
  type Known,
  type LapRecord,
  type MiniSectorCrossing,
  type OpenSpan,
  type Percent,
  type StartingPoint,
  type TrackData,
  type TyreSet,
} from '@pitwall/domain';
import { asOfNow, runAsOf, type AsOfView, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION, type DegradationOutput, type StintDegradation } from '../../../src/degradation/index.ts';
import { DRIVER_NOISE } from '../../../src/driver-noise/index.ts';
import { PIT_LOSS } from '../../../src/pit-loss/index.ts';
import { RACE_INTERACTION } from '../../../src/race-interaction/index.ts';
import { RIVAL_STOPS } from '../../../src/rival-stops/index.ts';
import { TRACK_WETNESS } from '../../../src/track-wetness/index.ts';
import { TYRE_LIFE } from '../../../src/tyre-life/index.ts';
import {
  buildStartingPoint,
  FORECAST_FIELD_CONFIG,
  FORECAST_UNITS,
  lapModelParams,
  startingPointAt,
} from '../../../src/shared/forecast-field/index.ts';
import { engineView } from '../../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../../test-support/track.ts';
import {
  arraysOf,
  asOfViewAt,
  FACT_LISTS,
  generated,
  materialised,
  PARAMS,
  plainNoise,
  segmentsAt,
  timeAtSegments,
  upstreamOf,
  WEAR_RATES,
} from './support.ts';

const TOLERANCE_MS = FORECAST_FIELD_CONFIG.defaults.placementToleranceMs;
/** The generator race's human cars: slots 6 and 7 (`PARAMS.field` is the defaults' cars 12 to 19). */
const HUMANS = [6, 7];

const g = generated();

/** The value of a starting point the test needs known. */
function valueOf(sp: Known<StartingPoint>, what: string): StartingPoint {
  if (!sp.known) throw new Error(`${what}: the starting point is unknown (${sp.reason})`);
  return sp.value;
}

/** The leader's crossing of the line that starts its lap `n`: the frame N, the leader and the time. */
function leaderCrossing(n: number): { frame: FrameNumber; leader: CarId; at: number } {
  const frame = g.race.framesOfLap(n)[0]!;
  const line = (g.full.history.crossings as readonly MiniSectorCrossing[])
    .filter((c) => c.lap === n && c.segment === 0 && c.frame === frame)
    .sort((a, b) => a.at - b.at)[0]!;
  return { frame, leader: line.carId, at: line.at };
}

/** The view after frame N as an `AsOfView`, uncut, as a plain object with `over` on top. */
const liveViewAt = (frame: FrameNumber, over: Partial<AsOfView> = {}): AsOfView => materialised(asOfNow(g.viewAt(frame)), over);

/** The shortest distance between two lap fractions, across the line. */
const fractionApart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

/** Every element of every numeric array of `sp` is finite (C3: never `NaN`). */
function expectFinite(sp: StartingPoint): void {
  for (const [name, values] of arraysOf(sp)) {
    for (let i = 0; i < values.length; i++) expect(Number.isFinite(values[i]), `${name}[${i}]`).toBe(true);
  }
}

describe('forecast-field (Task 16)', () => {
  it('at every crossing frame the as-of build equals the live build, but lap fraction and gap within placementToleranceMs; the crossing car exactly', () => {
    // the seven units, run in their reads' order
    expect(FORECAST_UNITS.map((u) => u.id).sort()).toEqual(
      [DEGRADATION, PIT_LOSS, TYRE_LIFE, TRACK_WETNESS, DRIVER_NOISE, RIVAL_STOPS, RACE_INTERACTION].sort(),
    );
    const cars = PARAMS.cars;
    let checked = 0;
    for (let n = 2; n <= g.race.laps; n++) {
      const { frame, leader, at } = leaderCrossing(n);
      // the live lap progress at the leader's crossing: each car's distance and the time since the leader was there
      const leaderCrossings = g.crossingsOf(leader);
      const lapFraction: number[] = [];
      const gapMs: number[] = [];
      for (let car = 0; car < cars; car++) {
        const s = segmentsAt(g.crossingsOf(carId(car)), at);
        lapFraction.push((s % MINI_SECTORS) / MINI_SECTORS);
        gapMs.push(at - timeAtSegments(leaderCrossings, s));
      }
      const liveView = liveViewAt(frame, { at });
      const live = valueOf(buildStartingPoint(liveView, runAsOf(FORECAST_UNITS, liveView), { lapFraction, gapMs }), `live, lap ${n}`);
      const asOf = valueOf(startingPointAt(asOfViewAt(g, frame, at), frame), `as of, lap ${n}`);

      expect(asOf.cars, `lap ${n}`).toBe(cars);
      const { lapFraction: asOfFraction, gapMs: asOfGap, ...asOfRest } = asOf;
      const { lapFraction: liveFraction, gapMs: liveGap, ...liveRest } = live;
      expect(asOfRest, `lap ${n}: every entry but lap fraction and gap`).toEqual(liveRest);
      for (let car = 0; car < cars; car++) {
        // a lap fraction's difference in ms at the car's pace
        expect(fractionApart(asOfFraction[car]!, liveFraction[car]!) * live.paceMs[car]!, `lap ${n}, car ${car}: lap fraction`).toBeLessThan(TOLERANCE_MS);
        expect(Math.abs(asOfGap[car]! - liveGap[car]!), `lap ${n}, car ${car}: gap`).toBeLessThan(TOLERANCE_MS);
      }
      // the crossing car (the leader, on the line) exactly
      expect(asOfFraction[leader], `lap ${n}: the leader's lap fraction`).toBe(liveFraction[leader]);
      expect(asOfGap[leader], `lap ${n}: the leader's gap`).toBe(liveGap[leader]);
      checked++;
    }
    expect(checked).toBe(g.race.laps - 1);
  });

  it("pace σ and degradation σ come from degradation's posterior covariance", () => {
    // lap 7, before the stops: every car in its first stint
    const view = liveViewAt(g.race.framesOfLap(7)[0]!);
    const outputs = upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at));
    const sp = valueOf(buildStartingPoint(view, outputs), 'lap 7');
    const degradation = outputs.get(DEGRADATION) as DegradationOutput;
    let stints = 0;
    for (let car = 0; car < PARAMS.cars; car++) {
      const stint = degradation[carId(car)]?.at(-1);
      if (stint === undefined || !stint.cov.known || !stint.nuMsPerLap.known) continue;
      const [[aa], [, nn]] = stint.cov.value;
      // paceSdMs² = cov[0][0]
      expect(sp.paceSdMs[car]! ** 2, `car ${car}: pace σ²`).toBeCloseTo(aa, 6);
      // degradation per % wear (ruling R18): times the car's wear rate it is ν per lap, and its σ² is cov[1][1]
      const wear = sp.wearRatePct[car]!;
      expect(wear, `car ${car}: wear rate`).toBeGreaterThan(0);
      expect(sp.degMsPerLap[car]! * wear, `car ${car}: ν`).toBeCloseTo(stint.nuMsPerLap.value, 6);
      expect((sp.degSdMs[car]! * wear) ** 2, `car ${car}: degradation σ²`).toBeCloseTo(nn, 6);
      stints++;
    }
    expect(stints).toBeGreaterThan(0);
  });

  it('a retired car is marked and keeps its last place', () => {
    // car 3 retires at the leader's lap 6 crossing (before its stop): none of its facts after; its car-status span is `retired`
    const retiredCar = carId(3);
    const { frame: retiredOn } = leaderCrossing(6);
    const { frame, at } = leaderCrossing(12);
    const now = g.viewAt(frame);
    const keep = <T extends { carId?: CarId; otherCarId?: CarId; frame: FrameNumber }>(list: readonly T[]): T[] =>
      list.filter((f) => !((f.carId === retiredCar || f.otherCarId === retiredCar) && f.frame > retiredOn));
    const h = now.history as Projection;
    const history: Projection = {
      ...h,
      laps: keep(h.laps),
      crossings: keep(h.crossings),
      stints: keep(h.stints),
      pitStops: keep(h.pitStops),
      events: keep(h.events as readonly (Projection['events'][number] & { otherCarId?: CarId })[]),
    };
    const retiredAt = g.viewAt(retiredOn).live.sessionTime;
    const byMachine = Object.fromEntries(
      Object.entries(now.situation.byMachine).map(([machine, spans]) => [
        machine,
        machine !== 'car-status'
          ? spans
          : spans.map((s): OpenSpan =>
              s.carId === retiredCar
                ? { ...(s as OpenSpan), id: s.id + 1, kind: 'retired', start: retiredAt, startFrame: retiredOn, detail: { cause: known('mechanical', retiredAt) } }
                : (s as OpenSpan),
            ),
      ]),
    );
    const view = liveViewAt(frame, { at, history, situation: { ...now.situation, byMachine } });
    const sp = valueOf(buildStartingPoint(view, upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, at))), 'lap 12');

    for (let car = 0; car < PARAMS.cars; car++) expect(sp.retired[car], `car ${car} retired`).toBe(car === retiredCar ? 1 : 0);
    // its last place: where its newest crossing put it, not moved on by the time since
    const last = (history.crossings as readonly MiniSectorCrossing[]).filter((c) => c.carId === retiredCar).at(-1)!;
    expect(sp.lapFraction[retiredCar]).toBe(last.segment / MINI_SECTORS);
    expectFinite(sp);
  });

  it("a realism-hidden rival's wear is tyre age × driver-noise's wear rate, never NaN", () => {
    // lap 6, every car on its medium start set; car 2's wear is `unknown('realism')` in every lap record (C8)
    const rival = carId(2);
    const hidden: Corners<Known<Percent>> = { fl: unknown('realism'), fr: unknown('realism'), rl: unknown('realism'), rr: unknown('realism') };
    const frame = g.race.framesOfLap(6)[0]!;
    const h = g.viewAt(frame).history as Projection;
    const laps = (h.laps as readonly LapRecord[]).map((l): LapRecord => (l.carId === rival ? { ...l, wearAtStartPct: hidden, wearAtEndPct: hidden } : l));
    const view = liveViewAt(frame, { history: { ...h, laps } });
    const sp = valueOf(buildStartingPoint(view, upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at))), 'lap 6');

    expect(NOISE_COMPOUNDS[sp.compound[rival]!]).toBe('medium');
    expect(sp.wearRatePct[rival]).toBe(WEAR_RATES.medium);
    expect(sp.tyreAge[rival]).toBeGreaterThan(0);
    expect(sp.wearPct[rival]).toBeCloseTo(sp.tyreAge[rival]! * WEAR_RATES.medium, 9);
    expectFinite(sp);
  });

  it('sets left only for our cars', () => {
    // every car's sets in the fixed inputs (as a run without realism holds them); our car is car 4
    const frame = g.race.framesOfLap(6)[0]!;
    const now = g.viewAt(frame);
    const at = now.live.sessionTime;
    const set = (visualCompound: 'medium' | 'hard', wearPct: number, fitted: boolean): TyreSet => ({
      actualCompound: visualCompound === 'medium' ? 'C2' : 'C1',
      visualCompound,
      wearPct,
      available: true,
      fitted,
      recommendedSession: 0,
      lifeSpanLaps: 20,
      usableLifeLaps: 18,
      lapDeltaMs: 0,
    });
    const sets = known({ sets: [set('medium', 9, true), set('hard', 0, false), set('medium', 24, false)], fittedIdx: 0 }, at);
    const base = asOfNow(now);
    const view = liveViewAt(frame, { fixed: { ...base.fixed, playerCar: known(carId(4), at), setsNow: now.live.cars.map(() => sets) } });
    const sp = valueOf(buildStartingPoint(view, upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, at))), 'lap 6');

    expect(Object.keys(sp.sets).map(Number)).toEqual([4]);
    for (const s of sp.sets[carId(4)]!) expect(NOISE_COMPOUNDS).toContain(s.compound);
  });

  it('a projection cut never reads a fact after the frame', () => {
    for (const n of [4, 9, 15]) {
      const { frame, at } = leaderCrossing(n);
      const reads = { after: 0, upTo: 0 };
      const full = g.full.history;
      // every fact list counts the reads of its entries by their append frame
      const guarded = Object.fromEntries(
        FACT_LISTS.map((list) => {
          const frames = full.appendedAt[list] as readonly FrameNumber[];
          const entries = full[list] as readonly unknown[];
          const proxy = new Proxy(entries, {
            get(target, key, receiver) {
              if (typeof key === 'string' && /^\d+$/.test(key) && Number(key) < target.length) {
                if (frames[Number(key)]! > frame) reads.after++;
                else reads.upTo++;
              }
              return Reflect.get(target, key, receiver);
            },
          });
          return [list, proxy];
        }),
      );
      const view: AsOfView = { ...asOfViewAt(g, frame, at), history: { ...full, ...guarded } as Projection };
      valueOf(startingPointAt(view, frame), `lap ${n}`);
      expect(reads.after, `lap ${n}: facts read that were appended after frame ${frame}`).toBe(0);
      expect(reads.upTo, `lap ${n}: the guard sees the reads`).toBeGreaterThan(0);
    }
  });

  describe("lapModelParams: offsets from degradation's α per compound, the track file's offsets when a compound has no stint", () => {
    /** The track's offsets against medium: soft 700 ms faster, hard 350 ms slower. */
    const TRACK_OFFSETS = { soft: -700, medium: 0, hard: 350 };
    const track: TrackData = (() => {
      const t = zandvoortTrack();
      return { ...t, defaults: { ...t.defaults, compoundOffsetsMs: known({ value: TRACK_OFFSETS, source: 'test' }, 0) } };
    })();
    const view = materialised(asOfNow(engineView({ track: known(track, 0) })));
    /** One stint of base pace `alpha` on `visual`, well determined (a small covariance). */
    const stint = (n: number, visual: 'medium' | 'hard', alpha: number): StintDegradation => ({
      stint: n,
      firstLap: n === 1 ? 1 : 15,
      lastLap: n === 1 ? 14 : 30,
      actual: visual === 'medium' ? 'C2' : 'C1',
      visual,
      basePaceMs: known(alpha, 0),
      nuMsPerLap: known(40, 0),
      nuSdMs: known(5, 0),
      basis: 'wear',
      fuelCorrected: true,
      wearRatePctPerLap: { fl: known(2, 0), fr: known(2, 0), rl: known(2, 0), rr: known(2, 0) },
      source: { kind: 'session', sessionShare: 0.9, parts: '12 laps + default' },
      cov: known(
        [
          [400, 0],
          [0, 25],
        ],
        0,
      ),
      startPrior: { nuMsPerLap: 40, nuSdMs: 20, alphaOffsetMs: known(0, 0), source: { kind: 'default', note: 'test', sessionShare: 0, parts: 'default' } },
      laps: [],
    });

    it('a compound without a stint takes the track file’s offset; fuel 30 ms per kg', () => {
      const p = lapModelParams(view, new Map([[DEGRADATION, {} satisfies DegradationOutput]]));
      expect(p.compoundOffsetMs.soft - p.compoundOffsetMs.medium).toBeCloseTo(TRACK_OFFSETS.soft - TRACK_OFFSETS.medium, 9);
      expect(p.compoundOffsetMs.hard - p.compoundOffsetMs.medium).toBeCloseTo(TRACK_OFFSETS.hard - TRACK_OFFSETS.medium, 9);
      expect(p.fuelMsPerKg).toBe(30);
      expect(p.convexFlagged).toBe(true);
    });

    it("the fitted compounds' offsets come from degradation's α, the track file a weak prior", () => {
      // ten cars, each a medium stint and then a hard stint 900 ms slower (the track file says 350 ms)
      const degradation: DegradationOutput = {};
      for (let car = 0; car < 10; car++) degradation[carId(car)] = [stint(1, 'medium', 90_000 + 100 * car), stint(2, 'hard', 90_900 + 100 * car)];
      const p = lapModelParams(view, new Map([[DEGRADATION, degradation]]));
      const hard = p.compoundOffsetMs.hard - p.compoundOffsetMs.medium;
      expect(hard).toBeGreaterThanOrEqual(TRACK_OFFSETS.hard);
      expect(hard).toBeLessThanOrEqual(900);
      expect(Math.abs(hard - 900)).toBeLessThan(100);
      // soft has no stint: the track file's offset against medium
      expect(p.compoundOffsetMs.soft - p.compoundOffsetMs.medium).toBeCloseTo(TRACK_OFFSETS.soft - TRACK_OFFSETS.medium, 9);
    });
  });
});
