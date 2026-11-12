// Shared setup of the `forecast-field` tests (SP4.3a spec 6.1, plan Task 16): a small generator race with its append
// frames, its as-of and live views, the upstream units' outputs, and plain `driver-noise` and `race-interaction`
// outputs of their declared types (those units are written apart, Tasks 10 and 12).
import {
  known,
  MINI_SECTORS,
  NOISE_COMPOUNDS,
  type CarId,
  type CarNoise,
  type DriverNoise,
  type FrameNumber,
  type LapRecord,
  type MiniSectorCrossing,
  type NoiseCompound,
  type RaceInteraction,
  type SessionTime,
  type StartingPoint,
} from '@pitwall/domain';
import { asOfNow, runAsOf, type AsOfUnit, type AsOfView, type CalculatorId, type EngineView, type Projection } from '@pitwall/engine/readers';
import { degradationAsOf, degradationCalculator } from '../../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../../src/degradation/index.ts';
import { DRIVER_NOISE } from '../../../src/driver-noise/index.ts';
import { pitLossCalculator } from '../../../src/pit-loss/calculator.ts';
import { PIT_LOSS, pitLossAsOf } from '../../../src/pit-loss/index.ts';
import { RACE_INTERACTION } from '../../../src/race-interaction/index.ts';
import { rivalStopsCalculator } from '../../../src/rival-stops/calculator.ts';
import { RIVAL_STOPS, rivalStopsAsOf } from '../../../src/rival-stops/index.ts';
import { trackWetnessCalculator } from '../../../src/track-wetness/calculator.ts';
import { TRACK_WETNESS, trackWetnessAsOf } from '../../../src/track-wetness/index.ts';
import { tyreLifeCalculator } from '../../../src/tyre-life/calculator.ts';
import { TYRE_LIFE, tyreLifeAsOf } from '../../../src/tyre-life/index.ts';
import type { BuilderRace } from '../../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../../test-support/race-generator/index.ts';
import { zandvoortTrack } from '../../../../../test-support/track.ts';

/** The track file of every view here: braking zones, DRS zones and pit-loss defaults. */
export const TRACK: EngineView['track'] = known(zandvoortTrack(), 0);

/** The fact lists of the projection (the log's `FACT_LISTS`). */
export const FACT_LISTS = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'penalties', 'decisions', 'clock'] as const;

/**
 * `p` with the append frame of every entry, by the generator's rule (`test-support/race-generator/record.ts`, as
 * `test/pit-loss/as-of.test.ts`): a fact on the frame it describes, a confirmed lap on the frame after its
 * provisional's crossing, a closed span on the frame it closed on.
 */
export function withAppendFrames(p: Projection): Projection {
  const appendedAt: Record<string, FrameNumber[]> = {};
  for (const list of FACT_LISTS) {
    appendedAt[list] = (p[list] as readonly { frame: FrameNumber; status?: LapRecord['status'] }[]).map((fact) =>
      list === 'laps' && fact.status !== 'provisional' ? fact.frame + 1 : fact.frame,
    );
  }
  for (const [machine, spans] of Object.entries(p.spans)) appendedAt[`spans:${machine}`] = spans.map((s) => s.endFrame);
  return { ...p, appendedAt } as Projection;
}

/** A small generator race: 8 cars (6 AI, 2 humans), 20 laps, one stop each on laps 8 to 10, medium to hard. */
export const PARAMS: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  cars: 8,
  laps: 20,
  field: GENERATOR_DEFAULTS.field.slice(12).map((car, i) => ({ ...car, stops: [{ lap: 8 + (i % 3), compound: 'hard' as const }] })),
};

/** Every car's wear rate per compound in the plain `driver-noise` output (% per lap): each compound its own. */
export const WEAR_RATES: Record<NoiseCompound, number> = { soft: 3.1, medium: 1.7, hard: 1.2, inter: 2.5, wet: 2.0 };

const DEFAULT_SOURCE = { kind: 'default', note: 'test', sessionShare: 0, parts: 'default' } as const;

/** A plain `driver-noise` output for car slots `0..cars - 1`; slots in `humans` are human. */
export function plainNoise(cars: number, humans: readonly number[] = [], at: SessionTime = 0): DriverNoise {
  const out: Record<CarId, CarNoise> = {};
  for (let i = 0; i < cars; i++) {
    const human = humans.includes(i);
    out[i as CarId] = {
      driver: human ? 'human' : 'ai',
      sigmaMs: known(human ? 450 : 200, at),
      rho: known(human ? 0.4 : 0.3, at),
      mistakeRatePerLap: known(human ? 0.05 : 0.02, at),
      mistakeSize: known({ medianMs: 1_500, sigmaLog: 0.6 }, at),
      bigEventRatePerLap: known(0.001, at),
      retireRatePerLap: known(0.002, at),
      wearRatePctPerLap: Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, known(WEAR_RATES[c], at)])) as CarNoise['wearRatePctPerLap'],
      wearRateSource: Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, DEFAULT_SOURCE])) as CarNoise['wearRateSource'],
      source: DEFAULT_SOURCE,
      laps: 10,
    };
  }
  return {
    cars: out,
    aiField: { mistakeRatePerLap: known(0.02, at), bigEventRatePerLap: known(0.001, at), retireRatePerLap: known(0.001, at) },
  };
}

/** A plain `race-interaction` output: one band, the config's DRS values, a 1 s following gap. */
export function plainInteraction(at: SessionTime = 0): RaceInteraction {
  return {
    bands: [{ fromDifficulty: 0, toDifficulty: 110, curve: { level: -3, slopePerMs: 0.004, cap: 0.6, wetFactor: 0.7 }, source: DEFAULT_SOURCE, episodes: 0, passes: 0 }],
    band: known(0, at),
    drsPassFactor: 1.2,
    drsStraightGainMs: 250,
    minGapMs: 1_000,
    heldLossMsPerLap: known(300, at),
    rejoinPushBackMs: known(500, at),
    dirtyAirMsPerLap: 0,
  };
}

/** The upstream units whose as-of forms are merged, as `runAsOf` runs them (their calculators' reads). */
const MERGED_UNITS: readonly AsOfUnit[] = [
  { id: DEGRADATION, reads: degradationCalculator.reads, asOf: degradationAsOf },
  { id: PIT_LOSS, reads: pitLossCalculator.reads, asOf: pitLossAsOf },
  { id: TYRE_LIFE, reads: tyreLifeCalculator.reads, asOf: tyreLifeAsOf },
  { id: TRACK_WETNESS, reads: trackWetnessCalculator.reads, asOf: trackWetnessAsOf },
  { id: RIVAL_STOPS, reads: rivalStopsCalculator.reads, asOf: rivalStopsAsOf },
];

/**
 * The outputs `buildStartingPoint` reads on `view`: the merged units' as-of forms run on it, and the plain `noise` and
 * `interaction` outputs in place of `driver-noise` and `race-interaction`.
 */
export function upstreamOf(
  view: AsOfView,
  noise: DriverNoise,
  interaction: RaceInteraction = plainInteraction(view.at),
): ReadonlyMap<CalculatorId, unknown> {
  const given = new Map<CalculatorId, unknown>([
    [DRIVER_NOISE, noise],
    [RACE_INTERACTION, interaction],
  ]);
  return runAsOf(MERGED_UNITS, { ...view, outputs: given });
}

/** `view` as a plain object (its getters read once), with `over` on top. */
export function materialised(view: AsOfView, over: Partial<AsOfView> = {}): AsOfView {
  return { ...view, fixed: { ...view.fixed }, ...over };
}

/** A generated race with its final projection's append frames and its views. */
export type Generated = {
  race: BuilderRace;
  /** The view after frame N, with the track file. */
  viewAt(frame: FrameNumber): EngineView;
  /** The final projection, with its append frames, and the final situation: what `startingPointAt` cuts. */
  full: { history: Projection; situation: EngineView['situation'] };
  /** Every crossing of the race, by car, oldest first. */
  crossingsOf(car: CarId): MiniSectorCrossing[];
};

/** `params`' race, seeded with `seed`. */
export function generated(params: GeneratorParams = PARAMS, seed = 7): Generated {
  const { race } = generateRace(params, seed);
  const viewAt = (frame: FrameNumber): EngineView => ({ ...race.viewAt(frame), track: TRACK });
  const final = viewAt(race.lastFrame);
  const full = { history: withAppendFrames(final.history as Projection), situation: final.situation };
  const byCar = new Map<CarId, MiniSectorCrossing[]>();
  for (const c of final.history.crossings as readonly MiniSectorCrossing[]) (byCar.get(c.carId) ?? byCar.set(c.carId, []).get(c.carId)!).push(c);
  for (const list of byCar.values()) list.sort((a, b) => a.at - b.at);
  return { race, viewAt, full, crossingsOf: (car) => byCar.get(car) ?? [] };
}

/** The as-of view of `g`'s race at frame `frame`: the final projection and situation (uncut), time `at`, the fixed inputs after `frame`. */
export function asOfViewAt(g: Generated, frame: FrameNumber, at: SessionTime): AsOfView {
  const now = g.viewAt(frame);
  return {
    history: g.full.history,
    situation: g.full.situation,
    frame,
    at,
    fixed: { ...asOfNow(now).fixed },
    config: now.config,
    priors: now.priors,
    drivers: now.drivers,
    track: now.track,
    weekend: now.weekend,
    outputs: new Map(),
  };
}

/** A crossing's distance into the race, in mini-sectors. */
const segmentsOf = (c: MiniSectorCrossing): number => (c.lap - 1) * MINI_SECTORS + c.segment;

/** Car `car`'s distance into the race at time `t`, in mini-sectors, between its crossings (linear). */
export function segmentsAt(crossings: readonly MiniSectorCrossing[], t: SessionTime): number {
  let i = 0;
  while (i + 1 < crossings.length && crossings[i + 1]!.at <= t) i++;
  const a = crossings[i]!;
  const b = crossings[i + 1];
  if (b === undefined || a.at > t) return segmentsOf(a);
  return segmentsOf(a) + ((t - a.at) / (b.at - a.at)) * (segmentsOf(b) - segmentsOf(a));
}

/** When the car of `crossings` was `segments` mini-sectors into the race (linear between its crossings). */
export function timeAtSegments(crossings: readonly MiniSectorCrossing[], segments: number): SessionTime {
  let i = 0;
  while (i + 1 < crossings.length && segmentsOf(crossings[i + 1]!) <= segments) i++;
  const a = crossings[i]!;
  const b = crossings[i + 1];
  if (b === undefined || segmentsOf(a) > segments) return a.at;
  return a.at + ((segments - segmentsOf(a)) / (segmentsOf(b) - segmentsOf(a))) * (b.at - a.at);
}

/** Every numeric array of a starting point, by name. */
export function arraysOf(sp: StartingPoint): [string, ArrayLike<number>][] {
  return (Object.entries(sp) as [string, unknown][]).filter((e): e is [string, ArrayLike<number>] => ArrayBuffer.isView(e[1]));
}
