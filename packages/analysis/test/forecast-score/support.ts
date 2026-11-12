// Shared setup of the `forecast-score` tests (SP4.3a spec 7.1, plan Task 19): a planned builder race (laps, stints,
// stops, the car-driver and session-phase spans, every entry with its append frame), small generator races with their
// append frames and track file, and the job's input from a view.
import {
  carId,
  known,
  unknown,
  type CarId,
  type FrameNumber,
  type LapRecord,
  type MachineId,
  type NoiseCompound,
  type PitStopRecord,
  type SessionTime,
  type Span,
  type StintRecord,
  type VisualCompound,
} from '@pitwall/domain';
import type { EngineView, Projection } from '@pitwall/engine/readers';
import { history, lap, neutralisation, RACE_PHASES } from '../../../../test-support/builders/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { FORECAST_SCORE_CONFIG } from '../../src/forecast-score/config.ts';
import { prepareScore, type ScoreInput } from '../../src/forecast-score/job.ts';

/** The defaults of `forecast-score` (3 s, 1–5 laps, ±3 places, 6 s repair, 2 settle laps). */
export const CONFIG = FORECAST_SCORE_CONFIG.defaults;

/** The track file of every generator view here: braking zones, DRS zones and pit-loss defaults. */
export const TRACK: EngineView['track'] = known(zandvoortTrack(), 0);

/** The fact lists of the projection (the log's `FACT_LISTS`). */
const FACT_LISTS = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'penalties', 'decisions', 'clock'] as const;

/**
 * `p` with the append frame of every entry, by the generator's rule (as `test/shared/forecast-field/support.ts`): a fact
 * on the frame it describes, a confirmed lap on the frame after its provisional's crossing, a closed span on the frame
 * it closed on.
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

// ---------------------------------------------------------------------------------------------------------------------
// The planned builder race

/** One planned stop: at the end of lap `lap` (its in lap), onto `compound` (default medium). */
export type PlannedStop = {
  lap: number;
  compound?: NoiseCompound;
  /** Default 2.5 s. */
  stationaryMs?: number;
  penaltyServed?: boolean;
  /** Default: `sc` when the stop's pit lane overlaps the race's neutralisation, else `green`. */
  flag?: PitStopRecord['flag'];
};

/** One planned car: lap 1 starts `gridOffsetMs` after lights out; every lap takes `paceMs` but the in and out laps. */
export type PlannedCar = {
  paceMs?: number;
  gridOffsetMs?: number;
  stops?: PlannedStop[];
  startCompound?: NoiseCompound;
  human?: boolean;
  /** Its wear is hidden (realism): `wearAtEndPct` unknown on every lap. */
  wearHidden?: boolean;
};

/** A neutralisation from `fromMs` to `toMs` after lights out (an SC by default). */
export type PlannedNeutralisation = { fromMs: SessionTime; toMs: SessionTime; kind?: 'SC' | 'VSC' };

export type PlannedRace = { laps: number; cars: PlannedCar[]; neutralisation?: PlannedNeutralisation };

/** Lights out; every frame lasts 1 s from 0, so frames and times keep one order (C26). */
export const LIGHTS_OUT: SessionTime = 1_000;
export const frameAt = (at: SessionTime): FrameNumber => Math.floor(at / 1_000) + 1;
/** What an in lap and an out lap lose against a racing lap (the stationary 2.5 s included in the out lap). */
export const IN_LAP_LOSS_MS = 8_000;
export const OUT_LAP_LOSS_MS = 14_000;
const DEFAULT_STATIONARY_MS = 2_500;

const VISUAL: Record<NoiseCompound, VisualCompound> = { soft: 'soft', medium: 'medium', hard: 'hard', inter: 'inter', wet: 'wet' };
const ACTUAL = { soft: 'C3', medium: 'C2', hard: 'C1', inter: 'inter', wet: 'wet' } as const;

/** A planned race as a projection, every entry with its append frame, and what the tests read of it. */
export type Planned = {
  history: Projection;
  /** Car `car`'s confirmed record of lap `n`. */
  lapOf(car: number, n: number): LapRecord;
  /** When car `car` completed lap `n` (n = 0: when it started lap 1). */
  completedAt(car: number, n: number): SessionTime;
  /** The gap of `other` behind `car` at the end of lap `n`: `completedAt(other, n) − completedAt(car, n)`. */
  gapAt(car: number, other: number, n: number): number;
  neutralisation?: Span;
};

/**
 * The race `plan` as the engine records it: per car and lap a confirmed lap record at its crossing (`positionAtEnd` by
 * completion, ties by id; in and out laps flagged; the tyre age and compound of its stint; wear 1 % a lap, hidden for
 * `wearHidden`); per stop a pit stop record (entry 6 s before the line ending the in lap, exit 14 s after it) and a stint
 * record of the stint it ends; the last stints at the flag; a `car-driver` span per car (`human` or `ai`) from lights
 * out to the flag; the session phase racing, with the neutralisation as a `neutralised` span between.
 */
export function plannedRace(plan: PlannedRace): Planned {
  const stationaryOf = (s: PlannedStop | undefined) => s?.stationaryMs ?? DEFAULT_STATIONARY_MS;
  const stopOn = (c: PlannedCar, lapNumber: number) => c.stops?.find((s) => s.lap === lapNumber);
  const lapTime = (c: PlannedCar, k: number): number => {
    const pace = c.paceMs ?? 90_000;
    const inLap = stopOn(c, k) !== undefined ? IN_LAP_LOSS_MS : 0;
    const before = stopOn(c, k - 1);
    const outLap = before !== undefined ? OUT_LAP_LOSS_MS + stationaryOf(before) - DEFAULT_STATIONARY_MS : 0;
    return pace + inLap + outLap;
  };
  const ends: number[][] = plan.cars.map((c) => {
    const e = [LIGHTS_OUT + (c.gridOffsetMs ?? 0)];
    for (let k = 1; k <= plan.laps; k++) e.push(e[k - 1]! + lapTime(c, k));
    return e;
  });
  const completedAt = (car: number, k: number): SessionTime => ends[car]![k]!;
  const positionAt = (car: number, k: number): number =>
    1 + ends.filter((e, j) => e[k]! < completedAt(car, k) || (e[k] === completedAt(car, k) && j < car)).length;
  const neutral = plan.neutralisation;
  const overlaps = (from: number, to: number) => neutral !== undefined && Math.min(to, neutral.toMs) > Math.max(from, neutral.fromMs);
  const end = Math.max(...ends.map((e) => e[plan.laps]!)) + 1_000;

  const laps: LapRecord[] = [];
  const pitStops: PitStopRecord[] = [];
  const stints: StintRecord[] = [];
  plan.cars.forEach((c, car) => {
    let compound: NoiseCompound = c.startCompound ?? 'soft';
    let firstLap = 1;
    for (let k = 1; k <= plan.laps; k++) {
      const at = completedAt(car, k);
      const frame = frameAt(at);
      const age = k - firstLap;
      const wear = (w: number) => ({ fl: wearOf(w, at), fr: wearOf(w, at), rl: wearOf(w, at), rr: wearOf(w, at) });
      const wearOf = (w: number, t: number) => (c.wearHidden ? unknown('realism') : known(w, t));
      laps.push(
        lap({
          carId: carId(car),
          lapNumber: k,
          lapTimeMs: lapTime(c, k),
          completedAt: at,
          frame,
          positionAtEnd: positionAt(car, k),
          inLap: stopOn(c, k) !== undefined,
          outLap: stopOn(c, k - 1) !== undefined,
          tyreAgeAtStart: age,
          actualCompound: ACTUAL[compound],
          visualCompound: VISUAL[compound],
          scShare: overlaps(completedAt(car, k - 1), at) ? 1 : 0,
          wearAtStartPct: wear(age),
          wearAtEndPct: wear(age + 1),
        }),
      );
      const stop = stopOn(c, k);
      if (stop !== undefined) {
        const entry = at - 6_000;
        const exit = at + 14_000;
        const flag = stop.flag ?? (overlaps(entry, exit) ? (neutral?.kind === 'VSC' ? 'vsc' : 'sc') : 'green');
        const exitFrame = frameAt(exit);
        pitStops.push({ carId: carId(car), lap: k, pitLaneEntry: entry, pitLaneExit: exit, pitLaneTimeMs: exit - entry, stationaryTimeMs: stationaryOf(stop), flag, penaltyServed: stop.penaltyServed ?? false, frame: exitFrame });
        stints.push({ carId: carId(car), firstLap, lastLap: k, actualCompound: ACTUAL[compound], visualCompound: VISUAL[compound], tyreAgeAtFitting: 0, frame: exitFrame });
        compound = stop.compound ?? 'medium';
        firstLap = k + 1;
      }
    }
    stints.push({ carId: carId(car), firstLap, lastLap: plan.laps, actualCompound: ACTUAL[compound], visualCompound: VISUAL[compound], tyreAgeAtFitting: 0, frame: frameAt(end) });
  });
  const byFrame = <T extends { frame: FrameNumber; carId: CarId }>(a: T, b: T) => a.frame - b.frame || a.carId - b.carId;
  laps.sort(byFrame);
  pitStops.sort(byFrame);
  stints.sort(byFrame);

  const span = (machine: MachineId, id: number, kind: string, start: SessionTime, stop: SessionTime, car?: number): Span => ({
    machine, id, kind, start, end: stop, confirmed: true, detail: undefined, startFrame: frameAt(start), endFrame: frameAt(stop),
    ...(car !== undefined && { carId: carId(car) }),
  });
  const drivers = plan.cars.map((c, car) => span('car-driver', 0, c.human ? 'human' : 'ai', 0, end, car));
  const phases: Span[] = neutral === undefined
    ? [span(RACE_PHASES, 0, 'racing', LIGHTS_OUT, end)]
    : [
        span(RACE_PHASES, 0, 'racing', LIGHTS_OUT, neutral.fromMs),
        neutralisation({ kind: neutral.kind ?? 'SC', start: neutral.fromMs, end: neutral.toMs, id: 1, startFrame: frameAt(neutral.fromMs), endFrame: frameAt(neutral.toMs) }),
        span(RACE_PHASES, 2, 'racing', neutral.toMs, end),
      ];
  const weekend = span('weekend-phase', 0, 'race', 0, end);
  const projection = withAppendFrames(
    history({
      laps,
      pitStops,
      stints,
      spans: { 'car-driver': drivers.sort((a, b) => (a.carId ?? 0) - (b.carId ?? 0)), [RACE_PHASES]: phases, 'weekend-phase': [{ ...weekend, detail: { format: 'grandPrix' } }] },
    }),
  );
  const lapOf = (car: number, k: number): LapRecord => {
    const r = laps.find((l) => l.carId === car && l.lapNumber === k);
    if (r === undefined) throw new Error(`plannedRace: car ${car} has no lap ${k}`);
    return r;
  };
  return {
    history: projection,
    lapOf,
    completedAt,
    gapAt: (car, other, k) => completedAt(other, k) - completedAt(car, k),
    ...(neutral !== undefined && { neutralisation: phases[1]! }),
  };
}

/** `n` cars on one pace, car `i` starting `spacingMs · i` behind car 0, with `over` merged per car. */
export function spacedField(n: number, spacingMs: number, over: Record<number, PlannedCar> = {}): PlannedCar[] {
  return Array.from({ length: n }, (_, i) => ({ gridOffsetMs: spacingMs * i, ...over[i] }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Generator races and the job's input

/** A small generator race: 8 cars (6 AI, cars 6 and 7 human), 20 laps, one stop each on laps 8 to 10, medium to hard. */
export const SMALL: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  cars: 8,
  laps: 20,
  field: GENERATOR_DEFAULTS.field.slice(12).map((car, i) => ({ ...car, stops: [{ lap: 8 + (i % 3), compound: 'hard' as const }] })),
};

/** The generator race of `params` (seed 1). */
export const generated = (params: GeneratorParams = SMALL, seed = 1): BuilderRace => generateRace(params, seed).race;

/** The view after `frame` with its append frames and the track file, as the scheduler hands it to the job. */
export function viewOf(race: BuilderRace, frame: FrameNumber = race.lastFrame): EngineView {
  const view = race.viewAt(frame);
  return { ...view, history: withAppendFrames(view.history), track: TRACK };
}

/** The job's input after `frame`, structured-cloned as the worker receives it (C51). */
export const inputAt = (race: BuilderRace, frame: FrameNumber = race.lastFrame): ScoreInput => structuredClone(prepareScore(viewOf(race, frame)));

/** The frames on which a confirmed record of the leader (`positionAtEnd` 1) was appended: the job's triggers. */
export function leaderLapFrames(race: BuilderRace): FrameNumber[] {
  const p = withAppendFrames(race.viewAt(race.lastFrame).history);
  const frames = p.laps.flatMap((l, i) => (l.positionAtEnd === 1 && l.status === 'confirmed' ? [p.appendedAt['laps']![i]!] : []));
  return [...new Set(frames)].sort((a, b) => a - b);
}
