// The long race (contract C31.1): 70 laps, 20 cars, one stop per car and a safety car, as the views a unit sees frame by
// frame. The counted-work proofs of the incremental units run on it: their reads per frame at lap 7 against lap 70.
// Imports are relative because the repo root does not link workspace packages.
import {
  carId,
  known,
  MINI_SECTORS,
  type FactRef,
  type FrameNumber,
  type LapRecord,
  type MachineId,
  type MiniSectorCrossing,
  type OpenSpan,
  type PitStopRecord,
  type RaceEvent,
  type SessionTime,
  type Span,
  type StintRecord,
} from '../../packages/domain/src/index.ts';
import { ALL_CHANGE_TAGS, projectionLengths, type EngineView, type LogLengths, type Projection } from '../../packages/engine/src/index.ts';
import { carState, engineView, event, lap, neutralisation, RACE_PHASES } from './index.ts';

/** A race built from the builders, as the views of its frames. */
export type BuilderRace = {
  cars: number;
  laps: number;
  /** The race's frames are `1..lastFrame`; the last is the one the leader completes the last lap on. */
  lastFrame: FrameNumber;
  /** The frames the leader is on lap `lap` (1-based), in order. */
  framesOfLap(lap: number): FrameNumber[];
  /**
   * The view after frame `frame`: every fact recorded by then in the projection (in the order the engine appends them),
   * the spans closed by then in the projection's `spans`, those open in the situation, the cars as they are then. Its
   * delta is from the view after frame `from` (default the frame before); `outputs` are the upstream units' outputs.
   * Every change tag is set.
   */
  viewAt(frame: FrameNumber, o?: { from?: FrameNumber; outputs?: ReadonlyMap<string, unknown> }): EngineView;
};

const CARS = 20;
const LAPS = 70;
const TRACK_M = 5_000;
/** One frame every 4.5 s of the race clock, the first at 0: about 20 frames a lap. Frames and times keep one order (C26). */
const FRAME_MS = 4_500;
/** Lights out: every car crosses the line of its lap 1 then. */
const START: SessionTime = 1_000;
/** Car `i` laps in 90 s plus 150 ms per id: the slowest is lapped about lap 45. */
const paceOf = (car: number): number => 90_000 + 150 * car;
/** Car `i` stops at the end of lap 15 + i (laps 15 to 34): its in lap loses 8 s, its out lap 14 s; soft C3 to medium C2. */
const stopLapOf = (car: number): number => 15 + car;
const IN_LAP_LOSS = 8_000;
const OUT_LAP_LOSS = 14_000;
/** The safety car, deployed in the leader's lap 30, in during its lap 33. */
const SC = { start: 2_640_000, end: 2_900_000 };
/** DRS is enabled two laps after lights out and two laps after a restart. */
const DRS_AFTER = 180_000;
/** Car 5 hits car 6 in lap 40; car 6's front left wing goes from 0 to 25 %. */
const COLLISION = { at: 3_560_000, car: carId(5), other: carId(6), toPct: 25 };

const frameAt = (at: SessionTime): FrameNumber => Math.floor(at / FRAME_MS) + 1;
/** The race clock's time after frame `frame`: every fact of the frame lies before it. */
const timeAfter = (frame: FrameNumber): SessionTime => frame * FRAME_MS;

/** A fact and the frame the engine appends it on (a confirmed lap: the frame after its provisional's crossing). */
type Appended<T> = { fact: T; on: FrameNumber };

const lapTimeOf = (car: number, n: number): number =>
  paceOf(car) + (n === stopLapOf(car) ? IN_LAP_LOSS : 0) + (n === stopLapOf(car) + 1 ? OUT_LAP_LOSS : 0);

/** Per car, the time it starts lap n (index n, 1..LAPS + 1; LAPS + 1 is when it completes the last lap). */
const STARTS: number[][] = Array.from({ length: CARS }, (_, car) => {
  const starts = [Number.NaN, START];
  for (let n = 1; n <= LAPS; n++) starts.push(starts[n]! + lapTimeOf(car, n));
  return starts;
});
const startOf = (car: number, n: number): SessionTime => STARTS[car]![n]!;

/** The car's stop: pit entry before the line that ends its in lap, the box after it, the exit 14 s after the line. */
const stopOf = (car: number) => {
  const line = startOf(car, stopLapOf(car) + 1);
  return { lap: stopLapOf(car), entry: line - 6_000, boxIn: line + 4_000, boxOut: line + 6_500, exit: line + 14_000 };
};

const overlap = (from: number, to: number, a: number, b: number): number => Math.max(0, Math.min(to, b) - Math.max(from, a));

/** In which order the engine appends: by frame, then by time, then by car. */
const byAppend = <T extends { at?: number; carId?: number }>(a: Appended<T>, b: Appended<T>): number =>
  a.on - b.on || (a.fact.at ?? 0) - (b.fact.at ?? 0) || (a.fact.carId ?? 0) - (b.fact.carId ?? 0);

function buildCrossings(): Appended<MiniSectorCrossing>[] {
  const list: Appended<MiniSectorCrossing>[] = [];
  for (let car = 0; car < CARS; car++) {
    for (let n = 1; n <= LAPS; n++) {
      for (let segment = 0; segment < MINI_SECTORS; segment++) {
        const at = startOf(car, n) + Math.round((segment * lapTimeOf(car, n)) / MINI_SECTORS);
        list.push({ fact: { carId: carId(car), lap: n, segment, at, frame: frameAt(at) }, on: frameAt(at) });
      }
    }
    const at = startOf(car, LAPS + 1);
    list.push({ fact: { carId: carId(car), lap: LAPS + 1, segment: 0, at, frame: frameAt(at) }, on: frameAt(at) });
  }
  return list.sort(byAppend);
}

/** Car `car`'s place at the end of lap n: by when each car completed it, ties by id. */
const positionAtEndOf = (car: number, n: number): number =>
  1 + Array.from({ length: CARS }, (_, j) => j).filter((j) => startOf(j, n + 1) < startOf(car, n + 1) || (startOf(j, n + 1) === startOf(car, n + 1) && j < car)).length;

/** Every lap as the engine writes it: the provisional record at its crossing, the confirmed one a frame later, naming it (C25). */
function buildLaps(): Appended<LapRecord>[] {
  const records: Appended<LapRecord & { at: number }>[] = [];
  for (let car = 0; car < CARS; car++) {
    const stop = stopLapOf(car);
    for (let n = 1; n <= LAPS; n++) {
      const completedAt = startOf(car, n + 1);
      const lapTimeMs = lapTimeOf(car, n);
      const stint = n <= stop ? { age: n - 1, actualCompound: 'C3' as const, visualCompound: 'soft' as const } : { age: n - stop - 1, actualCompound: 'C2' as const, visualCompound: 'medium' as const };
      const wear = (age: number) => ({ fl: known(age * 1.5, completedAt), fr: known(age * 1.5, completedAt), rl: known(age * 1.5, completedAt), rr: known(age * 1.5, completedAt) });
      const frame = frameAt(completedAt);
      const record = lap({
        carId: carId(car),
        lapNumber: n,
        lapTimeMs,
        completedAt,
        positionAtEnd: positionAtEndOf(car, n),
        actualCompound: stint.actualCompound,
        visualCompound: stint.visualCompound,
        tyreAgeAtStart: stint.age,
        fuelAtStartKg: known(110 - 1.5 * (n - 1), completedAt),
        fuelAtEndKg: known(110 - 1.5 * n, completedAt),
        wearAtStartPct: wear(stint.age),
        wearAtEndPct: wear(stint.age + 1),
        inLap: n === stop,
        outLap: n === stop + 1,
        scShare: overlap(completedAt - lapTimeMs, completedAt, SC.start, SC.end) / lapTimeMs,
        frame,
      });
      records.push({ fact: { ...record, status: 'provisional', at: completedAt }, on: frame });
      records.push({ fact: { ...record, at: completedAt }, on: frame + 1 });
    }
  }
  records.sort((a, b) => byAppend(a, b) || (a.fact.status === b.fact.status ? 0 : a.fact.status === 'provisional' ? -1 : 1));
  const provisionals = new Map<string, FactRef>();
  return records.map(({ fact: { at: _at, ...fact }, on }, index) => {
    const key = `${fact.carId}:${fact.lapNumber}`;
    if (fact.status === 'provisional') {
      provisionals.set(key, { list: 'laps', index });
      return { fact, on };
    }
    const supersedes = provisionals.get(key);
    return { fact: { ...fact, ...(supersedes && { supersedes }) }, on };
  });
}

/** Each car's first stint, recorded when it closes at the pit exit; the second is still open at the end of lap 70. */
const buildStints = (): Appended<StintRecord>[] =>
  Array.from({ length: CARS }, (_, car): Appended<StintRecord> => {
    const frame = frameAt(stopOf(car).exit);
    return {
      fact: { carId: carId(car), firstLap: 1, lastLap: stopLapOf(car), actualCompound: 'C3', visualCompound: 'soft', tyreAgeAtFitting: 0, frame },
      on: frame,
    };
  }).sort(byAppend);

const buildPitStops = (): Appended<PitStopRecord>[] =>
  Array.from({ length: CARS }, (_, car): Appended<PitStopRecord> => {
    const { lap: stopLap, entry, boxIn, boxOut, exit } = stopOf(car);
    const frame = frameAt(exit);
    const flag = overlap(entry, exit, SC.start, SC.end) > 0 ? ('sc' as const) : ('green' as const);
    return {
      fact: { carId: carId(car), lap: stopLap, pitLaneEntry: entry, pitLaneExit: exit, pitLaneTimeMs: exit - entry, stationaryTimeMs: boxOut - boxIn, flag, penaltyServed: false, frame },
      on: frame,
    };
  }).sort(byAppend);

/** A speed trap per car and lap, the collision and its damage (the start lights and lights out are the race's session-phase spans, Task 21). */
function buildEvents(): Appended<RaceEvent>[] {
  const at = (e: RaceEvent): Appended<RaceEvent> => ({ fact: e, on: e.frame });
  const list = [
    at(event({ kind: 'collision', at: COLLISION.at, frame: frameAt(COLLISION.at), carId: COLLISION.car, otherCarId: COLLISION.other })),
    at(
      event({
        kind: 'damageChange',
        at: COLLISION.at,
        frame: frameAt(COLLISION.at),
        carId: COLLISION.other,
        params: { part: 'frontLeftWingPct', fromPct: 0, toPct: COLLISION.toPct },
      }),
    ),
  ];
  for (let car = 0; car < CARS; car++) {
    for (let n = 1; n <= LAPS; n++) {
      const t = startOf(car, n) + Math.round(0.6 * lapTimeOf(car, n));
      list.push(at(event({ kind: 'speedTrap', at: t, frame: frameAt(t), carId: carId(car), params: { speedKmh: 310 + car } })));
    }
  }
  return list.sort(byAppend);
}

/** A span from `start` to `end` (open without `end`), of car `car` or zone `zone`; its id is set by `numbered`. */
type Draft = { machine: MachineId; kind: string; start: SessionTime; end?: SessionTime; car?: number; zone?: number; detail?: unknown };

/** The drafts as spans, each numbered by the spans its sub-machine opened before it (per car or zone, C26). */
function numbered(drafts: readonly Draft[]): Array<Span | OpenSpan> {
  const opened = new Map<string, number>();
  return drafts.map(({ machine, kind, start, end, car, zone, detail }) => {
    const key = `${machine}:${car ?? ''}:${zone ?? ''}`;
    const id = opened.get(key) ?? 0;
    opened.set(key, id + 1);
    const base = {
      machine,
      id,
      kind,
      start,
      confirmed: true,
      detail,
      startFrame: frameAt(start),
      ...(car !== undefined && { carId: carId(car) }),
      ...(zone !== undefined && { zone }),
    };
    return end === undefined ? base : { ...base, end, endFrame: frameAt(end) };
  });
}

/**
 * Every span of the race: the clock and the weekend phase; the session phase (grid to racing, the SC, racing again) and
 * race control's DRS; the zones' flags; per car its status, flags, warnings, lap validity, penalties, compound rule,
 * location and activity, its stop the pit lane, in lap, box stop and out lap.
 */
function buildSpans(): Array<Span | OpenSpan> {
  const drafts: Draft[] = [
    { machine: 'clock', kind: 'running', start: 0 },
    { machine: 'weekend-phase', kind: 'race', start: 0, detail: { format: 'grandPrix' } },
    { machine: RACE_PHASES, kind: 'grid', start: 0, end: 0 },
    { machine: RACE_PHASES, kind: 'formation', start: 0, end: 0 },
    { machine: RACE_PHASES, kind: 'startLights', start: 0, end: START },
    { machine: RACE_PHASES, kind: 'racing', start: START, end: SC.start },
    { machine: RACE_PHASES, kind: 'neutralised', start: SC.start, end: SC.end },
    { machine: RACE_PHASES, kind: 'racing', start: SC.end },
    { machine: 'race-control-race', kind: 'drsOff', start: 0, end: START + DRS_AFTER, detail: { reason: 'notEnabledYet' } },
    { machine: 'race-control-race', kind: 'drsOn', start: START + DRS_AFTER, end: SC.start },
    { machine: 'race-control-race', kind: 'drsOff', start: SC.start, end: SC.end + DRS_AFTER, detail: { reason: 'safetyCar' } },
    { machine: 'race-control-race', kind: 'drsOn', start: SC.end + DRS_AFTER },
    ...Array.from({ length: 3 }, (_, zone): Draft => ({ machine: 'zone-flags', kind: 'noFlag', start: 0, zone })),
  ];
  for (let car = 0; car < CARS; car++) {
    const { entry, boxIn, boxOut, exit, lap: stopLap } = stopOf(car);
    drafts.push(
      { machine: 'car-status', kind: 'competing', start: 0, car },
      { machine: 'car-flags', kind: 'noFlag', start: 0, car },
      { machine: 'warnings', kind: 'noWarning', start: 0, car },
      { machine: 'lap-validity', kind: 'valid', start: 0, car },
      { machine: 'penalties', kind: 'clear', start: 0, car },
      { machine: 'compound-rule', kind: 'required', start: 0, end: exit, car },
      { machine: 'compound-rule', kind: 'waived', start: exit, car },
      { machine: 'car-location', kind: 'track', start: 0, end: entry, car },
      { machine: 'car-location', kind: 'pitLane', start: entry, end: exit, car },
      { machine: 'car-location', kind: 'track', start: exit, car },
      { machine: 'car-activity-race', kind: 'racingLap', start: 0, end: startOf(car, stopLap), car },
      { machine: 'car-activity-race', kind: 'inLap', start: startOf(car, stopLap), end: boxIn, car },
      { machine: 'car-activity-race', kind: 'boxStop', start: boxIn, end: boxOut, car },
      { machine: 'car-activity-race', kind: 'outLap', start: boxOut, end: startOf(car, stopLap + 2), car },
      { machine: 'car-activity-race', kind: 'racingLap', start: startOf(car, stopLap + 2), car },
    );
  }
  return numbered(drafts).map((span) =>
    span.kind === 'neutralised'
      ? neutralisation({ start: SC.start, end: SC.end, id: span.id, startFrame: span.startFrame, endFrame: frameAt(SC.end) })
      : span,
  );
}

const isClosed = (span: Span | OpenSpan): span is Span => 'endFrame' in span;

/** The number of `list`'s entries appended on frame `frame` or before. */
const countBy = <T>(list: readonly Appended<T>[], frame: FrameNumber): number => {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.on <= frame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** The lap car `car` is on at `t` (LAPS + 1 once it completed the last), and how far along it it is (0..1). */
function progressOf(car: number, t: SessionTime): { lap: number; fraction: number } {
  let n = 1;
  while (n <= LAPS && startOf(car, n + 1) <= t) n++;
  if (n > LAPS || t < START) return { lap: n, fraction: 0 };
  return { lap: n, fraction: (t - startOf(car, n)) / lapTimeOf(car, n) };
}

function build(): BuilderRace {
  const lists = {
    laps: buildLaps(),
    crossings: buildCrossings(),
    stints: buildStints(),
    pitStops: buildPitStops(),
    events: buildEvents(),
  };
  const facts = Object.fromEntries(Object.entries(lists).map(([name, list]) => [name, list.map((e) => e.fact)])) as { [K in keyof typeof lists]: Array<(typeof lists)[K][number]['fact']> };
  const spans = buildSpans();
  /** The closed spans by machine, in their closing order, with the frame each is appended on. */
  const closed = new Map<MachineId, Appended<Span>[]>();
  for (const span of spans) if (isClosed(span)) (closed.get(span.machine) ?? closed.set(span.machine, []).get(span.machine)!).push({ fact: span, on: span.endFrame });
  for (const list of closed.values()) list.sort((a, b) => a.on - b.on || (a.fact.carId ?? 0) - (b.fact.carId ?? 0) || a.fact.id - b.fact.id);
  const openSpans = spans.map((span) => {
    const { end: _end, endFrame: _endFrame, ...open } = span as Span;
    return { open: open as OpenSpan, endFrame: isClosed(span) ? span.endFrame : Infinity };
  });

  const finish = Math.min(...Array.from({ length: CARS }, (_, car) => startOf(car, LAPS + 1)));
  const lastFrame = frameAt(finish);
  const leaderLap = (frame: FrameNumber): number => Math.max(...Array.from({ length: CARS }, (_, car) => progressOf(car, timeAfter(frame)).lap));

  const projectionAt = (frame: FrameNumber): Projection => {
    const spansAt: Record<MachineId, Span[]> = {};
    for (const [machine, list] of closed) spansAt[machine] = list.slice(0, countBy(list, frame)).map((e) => e.fact);
    return {
      laps: facts.laps.slice(0, countBy(lists.laps, frame)),
      crossings: facts.crossings.slice(0, countBy(lists.crossings, frame)),
      stints: facts.stints.slice(0, countBy(lists.stints, frame)),
      pitStops: facts.pitStops.slice(0, countBy(lists.pitStops, frame)),
      events: facts.events.slice(0, countBy(lists.events, frame)),
      penalties: [],
      clock: [],
      spans: spansAt,
    };
  };
  const lengthsAt = (frame: FrameNumber): LogLengths => projectionLengths(projectionAt(frame));

  const situationAt = (frame: FrameNumber): EngineView['situation'] => {
    const byMachine: Record<MachineId, OpenSpan[]> = {};
    for (const { open, endFrame } of openSpans) if (open.startFrame <= frame && frame < endFrame) (byMachine[open.machine] ??= []).push(open);
    return { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine };
  };

  /** The cars after `frame`: on their lap, in the order of their distance (ties by id), on mediums after their stop, car 6's wing hit after the collision. */
  const carsAt = (frame: FrameNumber) => {
    const t = timeAfter(frame);
    const progress = Array.from({ length: CARS }, (_, car) => progressOf(car, t));
    const distance = progress.map(({ lap: n, fraction }) => (n - 1 + fraction) * TRACK_M);
    const order = distance.map((_, car) => car).sort((a, b) => distance[b]! - distance[a]! || a - b);
    return progress.map(({ lap: n, fraction }, car) => {
      const stop = stopOf(car);
      const hit = car === COLLISION.other && t > COLLISION.at;
      return carState({
        id: carId(car),
        timing: { lap: Math.min(n, LAPS), position: order.indexOf(car) + 1, lapDistanceM: fraction * TRACK_M, totalDistanceM: distance[car]!, sector: fraction < 1 / 3 ? 1 : fraction < 2 / 3 ? 2 : 3 },
        ...(t >= stop.exit && { tyres: { actualCompound: 'C2' as const, visualCompound: 'medium' as const, age: Math.max(0, n - stop.lap - 1) } }),
        ...(hit && {
          condition: {
            bodywork: known({ frontLeftWingPct: COLLISION.toPct, frontRightWingPct: 0, rearWingPct: 0, floorPct: 0, diffuserPct: 0, sidepodPct: 0 }, COLLISION.at),
          },
        }),
        updatedAt: { lapData: t, status: t, telemetry: t, damage: t, motion: t, participants: t },
      });
    });
  };

  return {
    cars: CARS,
    laps: LAPS,
    lastFrame,
    framesOfLap: (n) => Array.from({ length: lastFrame }, (_, i) => i + 1).filter((frame) => leaderLap(frame) === n),
    viewAt(frame, { from = frame - 1, outputs = new Map() } = {}) {
      const history = projectionAt(frame);
      const view = engineView({
        cars: carsAt(frame),
        sessionTime: timeAfter(frame),
        session: { totalLaps: LAPS, trackLengthM: TRACK_M, timeLeftMs: 7_200_000 - timeAfter(frame) },
        history,
        situation: situationAt(frame),
        delta: { before: lengthsAt(from), after: projectionLengths(history), ...(from > frame && { rewound: { frameId: frame, at: timeAfter(frame) } }) },
        outputs,
      });
      return { ...view, changed: new Set(ALL_CHANGE_TAGS) };
    },
  };
}

let race: BuilderRace | undefined;

/**
 * The long race: 20 cars over 70 laps from lights out at 1 s, one frame every 4.5 s. Car `i` laps in 90 s + 150 ms × i and
 * stops once, at the end of lap 15 + i (in lap +8 s, out lap +14 s, soft C3 to medium C2: a stint and a pit stop at its
 * pit exit); the safety car is out from 2640 s to 2900 s (the leader's laps 30 to 33); car 5 hits car 6 in lap 40 (a
 * collision and a damage change). Every lap is recorded provisional then confirmed (C25), every car's 50 crossings a
 * lap, a speed trap per car and lap. Built once.
 */
export function longRace(): BuilderRace {
  race ??= build();
  return race;
}
