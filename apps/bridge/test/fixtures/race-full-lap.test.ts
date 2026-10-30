// Behaviours that only exist over a whole race lap, on race-zandvoort-full-lap (facts in fixtures/index.json): car 1 (the
// player) runs lap 10 from line to line; every other car completes one lap whose start lies before the segment.
// One replay through the engine and the calculators under test feeds every test.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALARMS,
  alarmsCalculator,
  CAR_BANDS,
  CAR_BANDS_CONFIG,
  carBandsCalculator,
  damageCalculator,
  fuelCalculator,
  GAPS,
  gapsCalculator,
  gapsToCar,
  sessionRemainingCalculator,
  tyreWearCalculator,
  type AlarmsOutput,
  type CarBandsOutput,
  type GapsOutput,
} from '@pitwall/analysis';
import { currentLaps, type BandReading, type CarBands, type CarState, type ChannelRange, type Known, type LapRecord, type Range } from '@pitwall/domain';
import type { DeepReadonly, EngineState, SchedulerResult, StepResult } from '@pitwall/engine';
import { InvariantChecker } from '../../../../packages/engine/test/support/invariants.ts';
import { bandsAgainstPackets, type BandsAgainstPackets } from './car-bands-packets.ts';
import { replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

type Car = DeepReadonly<CarState>;
type Lap = DeepReadonly<LapRecord>;

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
const TYRE = { surfaceC: 'surfaceTempC', carcassC: 'carcassTempC', pressurePsi: 'pressurePsi' } as const;

/** A band channel under its `alarms` name: the live reading, the lap record's range and `car-bands`' reading of it. */
type Channel = {
  name: string;
  live: (car: Car) => Known<number>;
  range: (r: DeepReadonly<ChannelRange>) => DeepReadonly<Known<Range>>;
  band: (b: CarBands) => BandReading;
};
const CHANNELS: Channel[] = [
  ...CORNERS.flatMap((k) =>
    (['surfaceC', 'carcassC', 'pressurePsi'] as const).map(
      (t): Channel => ({ name: `tyre.${t}.${k}`, live: (car) => car.tyres.corners[k][TYRE[t]], range: (r) => r.tyres[k][t], band: (b) => b.tyres[k][t] }),
    ),
  ),
  ...CORNERS.map((k): Channel => ({ name: `brakesC.${k}`, live: (car) => car.condition.brakes[k].tempC, range: (r) => r.brakesC[k], band: (b) => b.brakesC[k] })),
  { name: 'engineC', live: (car) => car.condition.engineTempC, range: (r) => r.engineC, band: (b) => b.engineC },
];

/** What the player's car showed on the frames of one lap number. */
type LapSeen = {
  /** Per channel (in `CHANNELS` order), the min and max of the known live values; their sides of the band. */
  min: number[];
  max: number[];
  below: boolean[];
  above: boolean[];
  /** The per-lap ERS counters on the lap's last frame. */
  ers: { deployedJ: number; harvestedJ: number } | undefined;
  /** The car on the lap's first frame (the frame that completes the lap before). */
  first: Car;
};

const run: {
  state: DeepReadonly<EngineState>;
  last: SchedulerResult;
  seen: Map<number, LapSeen>;
  /** Per `carId:lap`, the session times of the last frame before the car started the lap and of the first frame on it. */
  lineBetween: Map<string, { from: number; to: number }>;
  /** `car ... lap ...` for every lap that `car-bands` or `alarms` judged as a whole lap without its start line crossing. */
  partialLapEvidence: Set<string>;
  invariantErrors: string[];
  bands: BandsAgainstPackets;
} = {} as never;

/**
 * The run's `car-bands` config: the defaults, except an engine band the engine is above on every frame, so the player's
 * lap is out of band for a whole lap whatever the defaults (the block below tests the rule, not the defaults).
 */
const BANDS = { engineHi: 0 };

const newLapSeen = (car: Car): LapSeen => ({
  min: CHANNELS.map(() => Infinity),
  max: CHANNELS.map(() => -Infinity),
  below: CHANNELS.map(() => true),
  above: CHANNELS.map(() => true),
  ers: undefined,
  first: structuredClone(car),
});

beforeAll(async () => {
  const seen = new Map<number, LapSeen>();
  const lineBetween = new Map<string, { from: number; to: number }>();
  const partialLapEvidence = new Set<string>();
  const invariantErrors: string[] = [];
  const checker = new InvariantChecker();
  const previous = new Map<number, { lap: number; at: number }>();
  const lineCrossed = new Set<string>();
  const lastLap = new Map<number, number>();
  let last: SchedulerResult | undefined;
  const bands = bandsAgainstPackets(BANDS);

  /** Laps, crossings and the lap ranges move on the frames that carry LapData only, so only those are observed. */
  const observeLapData = ({ state }: StepResult, scheduled: SchedulerResult): void => {
    for (const car of state.cars) {
      if (!car.active) continue;
      const before = previous.get(car.id);
      if (before && car.timing.lap === before.lap + 1) lineBetween.set(`${car.id}:${car.timing.lap}`, { from: before.at, to: state.sessionTime });
      previous.set(car.id, { lap: car.timing.lap, at: state.sessionTime });
    }
    const player = state.cars[state.playerCar]!;
    const lap = seen.get(player.timing.lap) ?? newLapSeen(player);
    seen.set(player.timing.lap, lap);
    const bands = (scheduled.outputs.get(CAR_BANDS) as CarBandsOutput | undefined)?.[player.id];
    CHANNELS.forEach((c, i) => {
      const value = c.live(player);
      if (!value.known) return;
      lap.min[i] = Math.min(lap.min[i]!, value.value);
      lap.max[i] = Math.max(lap.max[i]!, value.value);
      const band = bands && c.band(bands).band;
      lap.below[i] &&= band !== undefined && value.value < band.lo;
      lap.above[i] &&= band !== undefined && value.value > band.hi;
    });
    if (player.energy.ers.known) {
      const { deployedJ, harvestedMgukJ, harvestedMguhJ } = player.energy.ers.value;
      lap.ers = { deployedJ, harvestedJ: harvestedMgukJ + harvestedMguhJ };
    }
  };

  /** Notes every whole-lap verdict of `car-bands` and `alarms` on a lap whose start line crossing the engine never saw. */
  const judgePartialLaps = ({ state, delta }: StepResult, scheduled: SchedulerResult): void => {
    for (const m of state.history.miniSectors.slice(delta.before.miniSectors)) if (m.segment === 0) lineCrossed.add(`${m.carId}:${m.lap}`);
    for (const l of state.history.laps.slice(delta.before.laps)) lastLap.set(l.carId, Math.max(lastLap.get(l.carId) ?? 0, l.lapNumber));
    const withoutStart = (carId: number) => !lineCrossed.has(`${carId}:${lastLap.get(carId)}`);
    if (scheduled.ran.includes(CAR_BANDS)) {
      for (const [id, b] of Object.entries(scheduled.outputs.get(CAR_BANDS) as CarBandsOutput)) {
        if (CHANNELS.some((c) => c.band(b).outForFullLap) && withoutStart(Number(id))) partialLapEvidence.add(`car-bands: car ${id} lap ${lastLap.get(Number(id))}`);
      }
    }
    if (scheduled.ran.includes(ALARMS)) {
      for (const a of scheduled.outputs.get(ALARMS) as AlarmsOutput) {
        if (a.kind === 'bandOutLap' && withoutStart(a.carId!)) partialLapEvidence.add(`alarms: car ${a.carId} lap ${lastLap.get(a.carId!)}`);
      }
    }
  };

  const calculators = [gapsCalculator, carBandsCalculator, alarmsCalculator, tyreWearCalculator, fuelCalculator, damageCalculator, sessionRemainingCalculator];
  const runner = await replayScheduled(segmentPath('race-zandvoort-full-lap.pwrec.gz'), calculators, (r, scheduled, frame) => {
    try {
      checker.check(r);
    } catch (error) {
      if (invariantErrors.length === 0) invariantErrors.push(String(error));
    }
    if (frame.lapData) observeLapData(r, scheduled);
    judgePartialLaps(r, scheduled);
    bands.observe(r.state, scheduled, frame);
    last = scheduled;
  }, { [CAR_BANDS_CONFIG.key]: BANDS });
  Object.assign(run, { state: runner.state, last: last!, seen, lineBetween, partialLapEvidence, invariantErrors, bands: bands.seen });
});

const crossingsOf = (carId: number) => run.state.history.miniSectors.filter((m) => m.carId === carId);
const lineAt = (carId: number, lap: number) => run.state.history.miniSectors.find((m) => m.carId === carId && m.lap === lap && m.segment === 0)?.at;
const confirmedLap = (carId: number, lapNumber: number): Lap | undefined =>
  run.state.history.laps.find((l) => l.carId === carId && l.lapNumber === lapNumber && l.status === 'confirmed');

/** The laps the segment holds from line to line, as `[carId, lap]`. */
const fullLaps = (): Array<[number, number]> =>
  run.state.history.laps
    .filter((l) => l.status === 'confirmed' && lineAt(l.carId, l.lapNumber) !== undefined && lineAt(l.carId, l.lapNumber + 1) !== undefined)
    .map((l) => [l.carId, l.lapNumber]);

/** The value of a `Known` the test needs; an unknown one fails the test with its reason. */
const valueOf = <T>(k: DeepReadonly<Known<T>>): DeepReadonly<T> => {
  if (!k.known) throw new Error(`expected a known value, got unknown (${k.reason})`);
  return k.value;
};

/** The player's lap that the segment holds from line to line. */
const playerLap = (): Lap => {
  const [, lapNumber] = fullLaps().find(([carId]) => carId === run.state.playerCar)!;
  return confirmedLap(run.state.playerCar, lapNumber)!;
};

describe('race-zandvoort-full-lap: the engine over a whole lap', () => {
  it('the engine invariants hold on every frame of the lap', () => {
    expect(run.invariantErrors).toEqual([]);
  });

  it('the player runs a whole lap in the segment', () => {
    expect(fullLaps().map(([carId]) => carId)).toContain(run.state.playerCar);
  });

  it("every car's mini-sector crossings come one per mini-sector, in order of track position and of time", () => {
    const disorder: string[] = [];
    for (const car of run.state.cars.filter((c) => c.active)) {
      const mine = crossingsOf(car.id);
      mine.forEach((m, i) => {
        const before = mine[i - 1];
        if (before === undefined) return;
        const progress = (m.lap - 1) * 50 + m.segment;
        const previous = (before.lap - 1) * 50 + before.segment;
        if (progress !== previous + 1 || m.at <= before.at) disorder.push(`car ${car.id}: ${before.lap}/${before.segment}@${before.at} then ${m.lap}/${m.segment}@${m.at}`);
      });
    }
    expect(disorder).toEqual([]);
  });

  it('a car that runs a whole lap passes each of its 50 mini-sectors once', () => {
    for (const [carId, lap] of fullLaps()) {
      expect(crossingsOf(carId).filter((m) => m.lap === lap).map((m) => m.segment)).toEqual(Array.from({ length: 50 }, (_, s) => s));
    }
  });

  it('each line crossing lies between the last frame of the old lap and the first of the new one, and line to line is the game lap time to within those frame gaps', () => {
    for (const [carId, lap] of fullLaps()) {
      const start = run.lineBetween.get(`${carId}:${lap}`)!;
      const end = run.lineBetween.get(`${carId}:${lap + 1}`)!;
      const [from, to] = [lineAt(carId, lap)!, lineAt(carId, lap + 1)!];
      expect(from).toBeGreaterThanOrEqual(start.from);
      expect(from).toBeLessThanOrEqual(start.to);
      expect(to).toBeGreaterThanOrEqual(end.from);
      expect(to).toBeLessThanOrEqual(end.to);
      const slack = start.to - start.from + (end.to - end.from);
      expect(Math.abs(to - from - confirmedLap(carId, lap)!.lapTimeMs)).toBeLessThanOrEqual(slack);
    }
  });

  it('every lap LapData completes is confirmed by SessionHistory with the same lap time, and the current laps are the confirmed ones', () => {
    const key = (l: Lap) => `${l.carId}:${l.lapNumber}:${l.lapTimeMs}`;
    const { laps } = run.state.history;
    const provisional = laps.filter((l) => l.status === 'provisional').map(key).sort();
    expect(laps.filter((l) => l.status === 'confirmed').map(key).sort()).toEqual(provisional);
    expect(currentLaps(laps as LapRecord[]).every((l) => l.status === 'confirmed')).toBe(true);
    expect(new Set(laps.map((l) => l.carId))).toEqual(new Set(run.state.cars.filter((c) => c.active).map((c) => c.id)));
  });
});

describe('race-zandvoort-full-lap: the lap-end samples of the player lap', () => {
  it("the lap's channel ranges are the min and max of the values on the lap's frames", () => {
    const lap = playerLap();
    const seen = run.seen.get(lap.lapNumber)!;
    for (const [i, c] of CHANNELS.entries()) {
      expect(c.range(lap.channelRange), c.name).toMatchObject({ known: true, value: { min: seen.min[i], max: seen.max[i] } });
    }
  });

  it("the lap's deployed and harvested ERS are the game's per-lap counters on its last frame, not the reset ones of the completing frame", () => {
    const lap = playerLap();
    const { ers } = run.seen.get(lap.lapNumber)!;
    expect(ers).toBeDefined();
    expect(lap.ersDeployedJ).toMatchObject({ known: true, value: ers!.deployedJ });
    expect(lap.ersHarvestedJ).toMatchObject({ known: true, value: ers!.harvestedJ });
  });

  it('the ERS store, tyre wear and damage at the lap end are those of the frame that completes the lap', () => {
    const lap = playerLap();
    const completing = run.seen.get(lap.lapNumber + 1)!.first;
    expect(valueOf(lap.ersStoreAtEndJ)).toBe(valueOf(completing.energy.ers).storeJ);
    for (const k of CORNERS) expect(valueOf(lap.wearAtEndPct[k]), k).toBe(valueOf(completing.tyres.corners[k].wearPct));
    const powerUnit = valueOf(completing.condition.powerUnit);
    expect(valueOf(lap.damageAtEnd)).toEqual({ ...valueOf(completing.condition.bodywork), gearboxPct: powerUnit.gearboxDamagePct, enginePct: powerUnit.engineDamagePct });
  });

  it('tyre wear and damage at the lap end are at least those at its start, the end of the lap before', () => {
    const lap = playerLap();
    const before = confirmedLap(lap.carId, lap.lapNumber - 1)!;
    for (const k of CORNERS) expect(valueOf(lap.wearAtEndPct[k]), k).toBeGreaterThanOrEqual(valueOf(before.wearAtEndPct[k]));
    const startDamage: Record<string, number> = valueOf(before.damageAtEnd);
    for (const [part, pct] of Object.entries(valueOf(lap.damageAtEnd))) expect(pct, part).toBeGreaterThanOrEqual(startDamage[part]!);
  });
});

describe('race-zandvoort-full-lap: gaps from the crossings', () => {
  const gaps = () => run.last.outputs.get(GAPS) as GapsOutput;

  it('after a lap of crossings every running car has a known gap to the leader and to the car ahead', () => {
    const { intervals } = gaps();
    expect(intervals.filter((i) => !i.toLeaderMs.known).map((i) => i.carId)).toEqual([]);
    expect(intervals.slice(1).filter((i) => !i.toAheadMs.known).map((i) => i.carId)).toEqual([]);
  });

  it('the gap of A to B is minus the gap of B to A, laps down included', () => {
    const out = gaps();
    const ids = out.intervals.map((i) => i.carId);
    const asymmetric: string[] = [];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const ab = gapsToCar(out, b)!.find((g) => g.carId === a)!;
        const ba = gapsToCar(out, a)!.find((g) => g.carId === b)!;
        const sum = ab.gapMs.known && ba.gapMs.known ? ab.gapMs.value + ba.gapMs.value : NaN;
        if (sum !== 0 || ab.lapsDown + ba.lapsDown !== 0) asymmetric.push(`${a}-${b}`);
      }
    }
    expect(asymmetric).toEqual([]);
  });
});

describe('race-zandvoort-full-lap: a whole lap out of band', () => {
  const player = () => run.state.playerCar;
  /** The player's channels whose live value was out of band, on the same side, on every frame of its full lap. */
  const outAllLap = () => {
    const seen = run.seen.get(playerLap().lapNumber)!;
    return CHANNELS.filter((_, i) => seen.below[i] || seen.above[i]).map((c) => c.name);
  };

  it('the player lap has a channel out of band on every frame (the case the next tests need: the test band of the engine)', () => {
    expect(outAllLap()).toContain('engineC');
  });

  it('car-bands marks outForFullLap exactly for the channels that were out of band on every frame of the lap', () => {
    expect(playerLap().visualCompound).toBe(run.state.cars[player()]!.tyres.visualCompound);
    const bands = (run.last.outputs.get(CAR_BANDS) as CarBandsOutput)[player()]!;
    expect(CHANNELS.filter((c) => c.band(bands).outForFullLap).map((c) => c.name)).toEqual(outAllLap());
  });

  it('alarms raises a critical bandOutLap for each of those channels', () => {
    const raised = (run.last.outputs.get(ALARMS) as AlarmsOutput).filter((a) => a.carId === player() && a.kind === 'bandOutLap');
    expect(raised.map((a) => [a.key, a.severity])).toEqual(outAllLap().map((c) => [`bandOutLap:${player()}:${c}`, 'critical']));
  });

  it('a lap the engine joined after its start line is no evidence of a whole lap out of band: no outForFullLap, no bandOutLap', () => {
    expect([...run.partialLapEvidence]).toEqual([]);
  });
});

describe("race-zandvoort-full-lap: car-bands on the game's packets", () => {
  it("on every run of car-bands, each of the player's channels and corners carries the packet value, the config band of the fitted slick and the live state it gives; the surface has no live state", () => {
    expect(run.bands.runs).toBeGreaterThan(0);
    expect(run.bands.off).toEqual([]);
  });
});
