// Builders of the `driver-noise` tests (SP4.3a spec 5.2, plan Task 10): generated races with their upstream outputs and
// append frames, stored sessions built from them (C84: passed explicitly, never read from a store), and builder views
// whose upstream outputs are given (`degradation`'s stints and `track-wetness`'s common mode), so a lap's residual is
// exactly what the test sets.
import {
  carId,
  known,
  unknown,
  type CarState,
  type FrameNumber,
  type Known,
  type LapRecord,
  type MiniSectorCrossing,
  type OpenSpan,
  type SessionUid,
  type Span,
  type TrackWetness,
  type NoiseCompound,
} from '@pitwall/domain';
import { asOfNow, projectionLengths, type EngineView, type MembershipSource, type StoredDriverSession } from '@pitwall/engine/readers';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION, type DegradationOutput, type StintDegradation } from '../../src/degradation/index.ts';
import { TRACK_WETNESS, trackWetnessAsOf } from '../../src/track-wetness/index.ts';
import { carState, crossings, engineView, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { RACE, openSpan } from '../situated.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Generated races.

/** The upstream outputs on `view` as the scheduled run has them: `degradation`, then `track-wetness` (its "as of" form now). */
export function upstreamOf(view: EngineView): Map<string, unknown> {
  const outputs = new Map<string, unknown>();
  outputs.set(DEGRADATION, degradationCalculator.compute({ ...view, outputs }));
  outputs.set(TRACK_WETNESS, trackWetnessAsOf(asOfNow({ ...view, outputs })));
  return outputs;
}

/** The race's view after `frame` (its delta from `from`), with `config` and the upstream outputs on it. */
export function viewAt(race: BuilderRace, frame: FrameNumber, o: { from?: FrameNumber; config?: EngineView['config'] } = {}): EngineView {
  const base = race.viewAt(frame, o.from === undefined ? {} : { from: o.from });
  const view = { ...base, config: o.config ?? base.config };
  return { ...view, outputs: upstreamOf(view) };
}

/** The frames the leader crosses the line on (the first frame of each of its laps after the first), and the last frame. */
export function leaderCrossings(race: BuilderRace): FrameNumber[] {
  const frames = new Set<FrameNumber>();
  for (let n = 2; n <= race.laps; n++) {
    const first = race.framesOfLap(n)[0];
    if (first !== undefined) frames.add(first);
  }
  frames.add(race.lastFrame);
  return [...frames].sort((a, b) => a - b);
}

/**
 * The race's final projection and situation with append frames exact at `frames` (the last frame added): the generator's
 * views keep none, so an entry counts as appended on the first given frame whose view holds it. A cut at a given frame
 * is then exactly that frame's view.
 */
export function withAppendFrames(race: BuilderRace, frames: readonly FrameNumber[]): MembershipSource {
  const at = [...new Set([...frames, race.lastFrame])].sort((a, b) => a - b);
  const lengths: Array<Partial<Record<string, number>>> = at.map((frame) => projectionLengths(race.viewAt(frame).history));
  const last = race.viewAt(race.lastFrame);
  const appendedAt: Record<string, FrameNumber[]> = {};
  for (const [list, n] of Object.entries(projectionLengths(last.history))) {
    if (n === undefined || n === 0) continue;
    const of: FrameNumber[] = [];
    let k = 0;
    for (let i = 0; i < n; i++) {
      while ((lengths[k]![list] ?? 0) <= i) k++;
      of.push(at[k]!);
    }
    appendedAt[list] = of;
  }
  return { history: { ...last.history, appendedAt }, situation: last.situation };
}

/** The frame on which car `car`'s confirmed record of lap `n` is in the race's projection (the frame after its crossing). */
export function lapConfirmedFrame(race: BuilderRace, car: number, n: number): FrameNumber {
  const record = race.viewAt(race.lastFrame).history.laps.find((l) => l.carId === car && l.lapNumber === n && l.status !== 'provisional');
  if (record === undefined) throw new Error(`car ${car} has no lap ${n}`);
  return record.frame + 1;
}

/**
 * A generated race as a stored session of car `car` (C34, C62c), every car `car` drove a human: its final projection
 * with every span closed (a stored log's spans are all closed, C18), the spans still open at the last frame closing on
 * the frame after it.
 */
export function storedSession(race: BuilderRace, car: number, uid: string): StoredDriverSession {
  const last = race.viewAt(race.lastFrame);
  const endFrame = race.lastFrame + 1;
  const end = last.live.sessionTime;
  const spans: Record<string, Span[]> = Object.fromEntries(Object.entries(last.history.spans).map(([m, list]) => [m, [...list]]));
  for (const [machine, open] of Object.entries(last.situation.byMachine)) {
    for (const span of open) (spans[machine] ??= []).push({ ...(span as OpenSpan), end, endFrame } as Span);
  }
  const humanSpans = (spans['car-driver'] ?? [])
    .filter((s) => s.carId === car && s.kind === 'human')
    .map((s) => ({ startFrame: s.startFrame, endFrame: s.endFrame }));
  return {
    session: { sessionUid: uid as SessionUid, weekendId: 'w1', feedCar: carId(0) },
    carId: carId(car),
    startedAt: '2026-11-05T19:00:00Z',
    phase: RACE,
    aiDifficulty: known(90, 0),
    totalLaps: known(race.laps, 0),
    projection: { ...last.history, spans, appendedAt: {} },
    humanSpans,
    track: unknown('notApplicable'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Builder views with given upstream outputs.

/** Every builder lap's base pace: lap `n`'s time is `BASE_MS + residual(n)`, its fuel 0 kg, so its corrected time is its time. */
export const BASE_MS = 90_000;

const ACTUAL = { soft: 'C3', medium: 'C2', hard: 'C1', inter: 'inter', wet: 'wet' } as const;

/** One car's laps `1..to` on one set fitted at lap 1 (tyre age `n - 1`), each `BASE_MS + residual(n)`. */
export type CarLaps = {
  car: number;
  to: number;
  residual?: (n: number) => number;
  compound?: NoiseCompound;
  /** Wear 1 % per lap, visible (default), or hidden by realism (`unknown('realism')`). */
  wear?: 'visible' | 'hidden';
  /** Laps left out (they never happened): their records, crossings and stint laps. */
  without?: readonly number[];
};

/** The car's lap `n` starts at `(n - 1) · BASE_MS` plus `car · 20 s`, so no two cars run within the free-air gap. */
const startOf = (car: number, n: number): number => (n - 1) * BASE_MS + car * 20_000;

/** The car's frame of lap `n`: the lap records interleave by frame, later laps later. */
export const frameOf = (car: number, n: number): FrameNumber => n * 20 + car;

const lapNumbers = (c: CarLaps): number[] => Array.from({ length: c.to }, (_, i) => i + 1).filter((n) => !(c.without ?? []).includes(n));

/** The car's lap records. */
export function carLaps(c: CarLaps): LapRecord[] {
  const residual = c.residual ?? (() => 0);
  const compound = c.compound ?? 'medium';
  return lapNumbers(c).map((n) => {
    const lapTimeMs = BASE_MS + residual(n);
    const completedAt = startOf(c.car, n) + lapTimeMs;
    const age = n - 1;
    const w = (pct: number): Known<number> => (c.wear === 'hidden' ? unknown('realism') : known(pct, completedAt));
    const corners = (pct: number) => ({ fl: w(pct), fr: w(pct), rl: w(pct), rr: w(pct) });
    return lap({
      carId: carId(c.car),
      lapNumber: n,
      lapTimeMs,
      completedAt,
      visualCompound: compound,
      actualCompound: ACTUAL[compound],
      tyreAgeAtStart: age,
      fuelAtStartKg: known(0, completedAt),
      fuelAtEndKg: known(0, completedAt),
      wearAtStartPct: corners(age) as LapRecord['wearAtStartPct'],
      wearAtEndPct: corners(age + 1) as LapRecord['wearAtEndPct'],
      positionAtEnd: c.car + 1,
      frame: frameOf(c.car, n),
    });
  });
}

/** The car's mini-sector crossings, evenly spaced over each of its laps. */
export function carCrossings(c: CarLaps): MiniSectorCrossing[] {
  return carLaps(c).flatMap((l) => crossings(l.carId, l.lapNumber, l.lapTimeMs, l.completedAt - l.lapTimeMs).map((x) => ({ ...x, frame: l.frame })));
}

/** `degradation`'s stint of the car: `α = BASE_MS`, `ν = 0`, each lap's corrected time its time (so its residual is `residual(n)`). */
export function stintOf(c: CarLaps): StintDegradation {
  const laps = carLaps(c);
  const at = laps.at(-1)?.completedAt ?? 0;
  const compound = c.compound ?? 'medium';
  const rate = c.wear === 'hidden' ? unknown('realism') : known(1, at);
  return {
    stint: 1,
    firstLap: laps[0]?.lapNumber ?? 1,
    lastLap: laps.at(-1)?.lapNumber ?? 1,
    actual: ACTUAL[compound],
    visual: compound,
    basePaceMs: known(BASE_MS, at),
    nuMsPerLap: known(0, at),
    nuSdMs: known(5, at),
    basis: c.wear === 'hidden' ? 'age' : 'wear',
    fuelCorrected: true,
    wearRatePctPerLap: { fl: rate, fr: rate, rl: rate, rr: rate },
    source: { kind: 'session', sessionShare: 1, parts: `${laps.length} laps` },
    cov: known([[100, 0], [0, 1]], at),
    startPrior: { nuMsPerLap: 0, nuSdMs: 30, alphaOffsetMs: known(0, 0), source: { kind: 'default', note: 'test', sessionShare: 0, parts: 'default' } },
    laps: laps.map((l) => ({
      lapNumber: l.lapNumber,
      tyreAge: l.tyreAgeAtStart,
      lapTimeMs: l.lapTimeMs,
      correctedMs: known(l.lapTimeMs, l.completedAt),
      use: l.lapNumber === 1 ? { excluded: 'notForPace' as const } : ('used' as const),
    })),
  };
}

/** `track-wetness`'s output for laps `1..laps`: a dry track, every slick common mode 0. */
export function dryWetness(laps: number): TrackWetness {
  return {
    byLap: Array.from({ length: laps }, (_, i) => ({
      lap: i + 1,
      commonModeMs: { slick: known(0, 0), inter: unknown('insufficientData'), wet: unknown('insufficientData') },
    })),
    state: known({ wetnessMs: 0, sdMs: 100 }, 0),
  };
}

/** How a builder car's spans stand at the view: its driver (default AI), and its status (default competing) since a frame. */
export type CarSituation = { driver?: 'ai' | 'human'; retiredFrom?: FrameNumber };

/**
 * A race view of `cars` (car 0 is ours): their laps and crossings in the projection, their live states (a car with
 * hidden wear realism-hidden), per car its car-driver span and its car-status span (a retired car's closed `competing`
 * span and its open `retired` one), `degradation`'s and `track-wetness`'s outputs given, `drivers` and `config` as given.
 */
export function rowView(
  cars: readonly (CarLaps & CarSituation)[],
  o: { drivers?: EngineView['drivers']; config?: EngineView['config']; phase?: typeof RACE } = {},
): EngineView {
  const laps = cars.flatMap(carLaps).sort((a, b) => a.frame - b.frame || a.carId - b.carId);
  const xs = cars.flatMap(carCrossings).sort((a, b) => a.at - b.at || a.carId - b.carId);
  const lastLap = Math.max(...cars.map((c) => c.to));
  const states: CarState[] = cars.map((c) => {
    const state = carState({ id: carId(c.car), timing: { lap: c.to + 1, position: c.car + 1 } });
    return c.wear === 'hidden' ? realismHidden(state) : state;
  });
  const phase = o.phase ?? RACE;
  const { kind, ...detail } = phase as { kind: string };
  const open: OpenSpan[] = [openSpan('weekend-phase', kind, { detail })];
  const closed: Span[] = [];
  for (const c of cars) {
    open.push(openSpan('car-driver', c.driver ?? 'ai', { car: c.car }));
    if (c.retiredFrom === undefined) open.push(openSpan('car-status', 'competing', { car: c.car }));
    else {
      const competing = openSpan('car-status', 'competing', { car: c.car });
      closed.push({ ...competing, end: startOf(c.car, c.to + 1), endFrame: c.retiredFrom });
      open.push({ ...openSpan('car-status', 'retired', { car: c.car, start: startOf(c.car, c.to + 1) }), id: 1, startFrame: c.retiredFrom });
    }
  }
  const byMachine: Record<string, OpenSpan[]> = {};
  for (const span of open) (byMachine[span.machine] ??= []).push(span);
  const degradation: DegradationOutput = Object.fromEntries(cars.map((c) => [carId(c.car), [stintOf(c)]]));
  return engineView({
    cars: states,
    sessionTime: startOf(0, lastLap + 1) + 1_000,
    history: { laps, crossings: xs, spans: closed.length === 0 ? {} : { 'car-status': closed } },
    situation: { weekendPhase: phase, byMachine },
    outputs: new Map<string, unknown>([
      [DEGRADATION, degradation],
      [TRACK_WETNESS, dryWetness(lastLap)],
    ]),
    ...(o.config !== undefined && { config: o.config }),
    ...(o.drivers !== undefined && { drivers: o.drivers }),
  });
}
