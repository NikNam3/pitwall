// A standard race built from the test-support builders, for the generic tests over every unit (contract C41, C87): four
// cars over six laps, car 1 stops under a safety car. Two views of it: `during` (the SC out, car 1 in the pit lane) and
// `after` (racing again, six laps done), the projection of `during` a prefix of that of `after`, so an incremental unit
// inits on one and folds the delta into the other.
import { carId, type FrameNumber, type MiniSectorCrossing, type OpenSpan, type PitStopRecord, type RaceEvent, type SessionTime, type Span, type StintRecord } from '@pitwall/domain';
import { ALL_CHANGE_TAGS, projectionLengths, type EngineView } from '@pitwall/engine/readers';
import { carState, engineView, event, field, history, lap, neutralisation } from '../../../test-support/builders/index.ts';
import { engineShaped } from './engine-shaped.ts';

const CARS = 4;
const LAPS = 6;
const PACE = [90_000, 90_500, 91_000, 91_500];
/** The SC: deployed in lap 3, in by lap 4. */
const SC = { start: 200_000, end: 280_000 };
/** Car 1's stop in its lap 3, under the SC: in lap 3, out lap 4, soft to medium. */
const STOP = { car: carId(1), lap: 3, entry: 262_000, exit: 285_000 };
/** Where the two views are cut: during the SC with car 1 in the pit lane, and after the race's six laps. */
export const DURING: SessionTime = 270_000;
export const AFTER: SessionTime = 560_000;

/** One frame every 10 ms of the race clock, the first at 0: frames and times keep one order (C26). */
const frameAt = (at: SessionTime): FrameNumber => Math.floor(at / 10) + 1;

const { laps: fieldLaps, crossings: fieldCrossings } = field({ cars: CARS, laps: LAPS, paceMs: PACE });

const laps = engineShaped(
  fieldLaps.map((l) => {
    const stopped = l.carId === STOP.car;
    const after = stopped && l.lapNumber > STOP.lap;
    return lap({
      ...l,
      frame: frameAt(l.completedAt),
      inLap: stopped && l.lapNumber === STOP.lap,
      outLap: stopped && l.lapNumber === STOP.lap + 1,
      scShare: l.completedAt > SC.start && l.completedAt - l.lapTimeMs < SC.end ? 0.5 : 0,
      ...(after && { actualCompound: 'C2' as const, visualCompound: 'medium' as const, tyreAgeAtStart: l.lapNumber - STOP.lap - 1 }),
    });
  }),
).sort((a, b) => a.completedAt - b.completedAt);

const crossings: MiniSectorCrossing[] = fieldCrossings.map((c) => ({ ...c, frame: frameAt(c.at) }));

const stints = (
  [
  ...Array.from({ length: CARS }, (_, i): StintRecord => ({
    carId: carId(i),
    firstLap: 1,
    lastLap: i === STOP.car ? STOP.lap : LAPS,
    actualCompound: 'C3',
    visualCompound: 'soft',
    tyreAgeAtFitting: 0,
    frame: frameAt(i === STOP.car ? STOP.exit : 0),
  })),
  { carId: STOP.car, firstLap: STOP.lap + 1, lastLap: LAPS, actualCompound: 'C2', visualCompound: 'medium', tyreAgeAtFitting: 0, frame: frameAt(STOP.exit) },
  ] satisfies StintRecord[]
).sort((a, b) => a.frame - b.frame);

const pitStops: PitStopRecord[] = [
  {
    carId: STOP.car,
    lap: STOP.lap,
    pitLaneEntry: STOP.entry,
    pitLaneExit: STOP.exit,
    pitLaneTimeMs: STOP.exit - STOP.entry,
    stationaryTimeMs: 2_400,
    flag: 'sc',
    penaltyServed: false,
    frame: frameAt(STOP.exit),
  },
];

const events: RaceEvent[] = [
  event({ kind: 'startLights', at: 0, frame: frameAt(0), params: { lights: 5 } }),
  event({ kind: 'lightsOut', at: 1_000, frame: frameAt(1_000) }),
  event({ kind: 'overtake', at: 95_000, frame: frameAt(95_000), carId: carId(2), otherCarId: carId(1) }),
  event({ kind: 'speedTrap', at: 120_000, frame: frameAt(120_000), carId: carId(0), params: { speedKmh: 322 } }),
  event({ kind: 'collision', at: 190_000, frame: frameAt(190_000), carId: carId(3), otherCarId: carId(2) }),
  event({ kind: 'damageChange', at: 190_000, frame: frameAt(190_000), carId: carId(3), params: { part: 'frontLeftWingPct', fromPct: 0, toPct: 20 } }),
  event({ kind: 'fastestLap', at: 450_000, frame: frameAt(450_000), carId: carId(0), params: { lapTimeMs: 90_000 } }),
].sort((a, b) => a.at - b.at);

/** A span of `machine` of `kind` from `start` to `end` (open without `end`), for car `car` or zone `zone`. */
const span = (machine: string, id: number, kind: string, start: SessionTime, end?: SessionTime, o: { car?: number; zone?: number; detail?: unknown } = {}): Span | OpenSpan => ({
  machine,
  id,
  kind,
  start,
  confirmed: true,
  detail: o.detail,
  startFrame: frameAt(start),
  ...(o.car !== undefined && { carId: carId(o.car) }),
  ...(o.zone !== undefined && { zone: o.zone }),
  ...(end !== undefined && { end, endFrame: frameAt(end) }),
});

/**
 * Every span of the race, closed and open alike (no `end` = open at `AFTER`): the session phase (grid to racing, the SC,
 * racing again), race control's DRS, the clock and the weekend phase, and per car its status, location, activity, flags,
 * warnings, lap validity, penalties and compound rule; car 1's stop is its pit-lane location, in lap, box stop and out lap.
 */
const SPANS: Array<Span | OpenSpan> = [
  span('clock', 0, 'running', 0),
  span('weekend-phase', 0, 'race', 0, undefined, { detail: { format: 'grandPrix' } }),
  span('session-phase-race', 0, 'grid', 0, 0),
  span('session-phase-race', 1, 'formation', 0, 0),
  span('session-phase-race', 2, 'startLights', 0, 1_000),
  span('session-phase-race', 3, 'racing', 1_000, SC.start),
  { ...neutralisation({ start: SC.start, end: SC.end, id: 4, startFrame: frameAt(SC.start), endFrame: frameAt(SC.end) }) },
  span('session-phase-race', 5, 'racing', SC.end),
  span('race-control-race', 0, 'drsOff', 0, 180_000, { detail: { reason: 'notEnabledYet' } }),
  span('race-control-race', 1, 'drsOn', 180_000, SC.start),
  span('race-control-race', 2, 'drsOff', SC.start, SC.end + 90_000, { detail: { reason: 'safetyCar' } }),
  span('race-control-race', 3, 'drsOn', SC.end + 90_000),
  ...Array.from({ length: 3 }, (_, zone) => span('zone-flags', 0, 'noFlag', 0, undefined, { zone })),
  ...Array.from({ length: CARS }, (_, car) => [
    span('car-status', 0, 'competing', 0, undefined, { car }),
    span('car-flags', 0, 'noFlag', 0, undefined, { car }),
    span('warnings', 0, 'noWarning', 0, undefined, { car }),
    span('lap-validity', 0, 'valid', 0, undefined, { car }),
    span('penalties', 0, 'clear', 0, undefined, { car }),
    ...(car === STOP.car
      ? [
          span('compound-rule', 0, 'required', 0, STOP.exit, { car }),
          span('compound-rule', 1, 'waived', STOP.exit, undefined, { car }),
          span('car-location', 0, 'track', 0, STOP.entry, { car }),
          span('car-location', 1, 'pitLane', STOP.entry, STOP.exit, { car }),
          span('car-location', 2, 'track', STOP.exit, undefined, { car }),
          span('car-activity-race', 0, 'racingLap', 0, 2 * PACE[car]!, { car }),
          span('car-activity-race', 1, 'inLap', 2 * PACE[car]!, 266_000, { car }),
          span('car-activity-race', 2, 'boxStop', 266_000, 268_400, { car }),
          span('car-activity-race', 3, 'outLap', 268_400, 4 * PACE[car]!, { car }),
          span('car-activity-race', 4, 'racingLap', 4 * PACE[car]!, undefined, { car }),
        ]
      : [
          span('compound-rule', 0, 'required', 0, undefined, { car }),
          span('car-location', 0, 'track', 0, undefined, { car }),
          span('car-activity-race', 0, 'racingLap', 0, undefined, { car }),
        ]),
  ]).flat(),
];

const isClosed = (s: Span | OpenSpan): s is Span => 'end' in s;

/** The spans as the view holds them at `at`: closed by then in the projection (in closing order), open at `at` in the situation. */
function spansAt(at: SessionTime): { closed: Record<string, Span[]>; open: Record<string, OpenSpan[]> } {
  const closed: Record<string, Span[]> = {};
  const open: Record<string, OpenSpan[]> = {};
  for (const s of SPANS) {
    if (s.start > at) continue;
    if (isClosed(s) && s.end <= at) (closed[s.machine] ??= []).push(s);
    else {
      const { end: _end, endFrame: _endFrame, ...rest } = s as Span;
      (open[s.machine] ??= []).push(rest);
    }
  }
  for (const list of Object.values(closed)) list.sort((a, b) => a.endFrame - b.endFrame);
  return { closed, open };
}

/** Each car's live state at `at`: on the lap it is on, car 1 on mediums after its stop. */
function carsAt(at: SessionTime) {
  const lapOf = (i: number) => Math.min(LAPS + 1, Math.floor(at / PACE[i]!) + 1);
  return Array.from({ length: CARS }, (_, i) =>
    carState({
      id: carId(i),
      timing: {
        lap: lapOf(i),
        position: i + 1,
        lapDistanceM: ((at % PACE[i]!) / PACE[i]!) * 5_000,
        totalDistanceM: (at / PACE[i]!) * 5_000,
      },
      ...(i === STOP.car && at >= STOP.exit && { tyres: { actualCompound: 'C2' as const, visualCompound: 'medium' as const, age: 0 } }),
      updatedAt: { lapData: at, status: at, telemetry: at, damage: at, motion: at, participants: at },
    }),
  );
}

/** The race's view at `at`: every fact recorded by then, the spans closed by then and those open at `at`. */
export function raceAt(at: SessionTime, outputs: ReadonlyMap<string, unknown> = new Map()): EngineView {
  const { closed, open } = spansAt(at);
  const view = engineView({
    cars: carsAt(at),
    sessionTime: at,
    session: { totalLaps: LAPS + 4, timeLeftMs: 3_600_000 - at },
    history: history({
      laps: laps.filter((l) => l.completedAt <= at),
      crossings: crossings.filter((c) => c.at <= at),
      stints: stints.filter((s) => s.frame <= frameAt(at)),
      pitStops: pitStops.filter((p) => p.pitLaneExit <= at),
      events: events.filter((e) => e.at <= at),
      spans: closed,
    }),
    situation: { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: open },
    outputs,
  });
  return { ...view, changed: new Set(ALL_CHANGE_TAGS) };
}

/** `after`'s view with the delta from `before`'s projection (the frames between them applied at once). */
export function grown(before: EngineView, after: EngineView): EngineView {
  return { ...after, delta: { before: projectionLengths(before.history), after: projectionLengths(after.history) } };
}
