// The generator's recording: the simulation's crossings, laps, stints, stops and passes as the facts the engine appends
// (in its order: by frame, then time, then car), the spans of the race's sub-machines, and the views of its frames, the way
// the long race builds them (`builders/long-race.ts`).
import {
  carId,
  known,
  MINI_SECTORS,
  type ActualCompound,
  type FactRef,
  type FrameNumber,
  type LapRecord,
  type MachineId,
  type MiniSectorCrossing,
  type NoiseCompound,
  type OpenSpan,
  type PitStopRecord,
  type RaceEvent,
  type SessionTime,
  type Span,
  type StintRecord,
} from '../../packages/domain/src/index.ts';
import { ALL_CHANGE_TAGS, projectionLengths, type EngineView, type LogLengths, type Projection } from '../../packages/engine/src/index.ts';
import { carState, engineView, lap as lapRecord, neutralisation, RACE_PHASES } from '../builders/index.ts';
import type { BuilderRace } from '../builders/long-race.ts';
import type { GeneratorParams } from './types.ts';
import { FRAME_MS, fuelAtStart, setOf, START_MS, type SimResult } from './simulate.ts';

const ACTUAL: Record<NoiseCompound, ActualCompound> = { soft: 'C3', medium: 'C2', hard: 'C1', inter: 'inter', wet: 'wet' };
/** The sector boundaries by mini-sector: segments 17 and 34 (about a third and two thirds of the lap). */
const SECTOR_SEGMENTS = [17, 34] as const;

const frameAt = (at: SessionTime): FrameNumber => Math.floor(at / FRAME_MS) + 1;
const timeAfter = (frame: FrameNumber): SessionTime => frame * FRAME_MS;
const overlap = (from: number, to: number, a: number, b: number): number => Math.max(0, Math.min(to, b) - Math.max(from, a));

/** A fact and the frame the engine appends it on. */
type Appended<T> = { fact: T; on: FrameNumber };

const byAppend = <T extends { at?: number; carId?: number }>(a: Appended<T>, b: Appended<T>): number =>
  a.on - b.on || (a.fact.at ?? 0) - (b.fact.at ?? 0) || (a.fact.carId ?? 0) - (b.fact.carId ?? 0);

/** A span from `start` to `end` (open without `end`) of car `car` or zone `zone`; its id is set by `numbered`. */
type Draft = { machine: MachineId; kind: string; start: SessionTime; end?: SessionTime; car?: number; zone?: number; detail?: unknown };

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
    if (end === undefined) return base;
    if (kind === 'neutralised') return neutralisation({ start, end, id, startFrame: base.startFrame, endFrame: frameAt(end) });
    return { ...base, end, endFrame: frameAt(end) };
  });
}

/** A car's spans of one sub-machine as consecutive drafts: each kind from its time until the next one's. */
function chain(machine: MachineId, steps: Array<{ kind: string; at: SessionTime | undefined; detail?: unknown }>, car?: number): Draft[] {
  const reached = steps.filter((s): s is { kind: string; at: SessionTime; detail?: unknown } => s.at !== undefined);
  const merged = reached.filter((s, i) => i === 0 || s.kind !== reached[i - 1]!.kind || JSON.stringify(s.detail) !== JSON.stringify(reached[i - 1]!.detail));
  return merged.map((s, i) => {
    const end = merged[i + 1]?.at;
    return { machine, kind: s.kind, start: s.at, ...(end !== undefined && { end }), ...(car !== undefined && { car }), ...(s.detail !== undefined && { detail: s.detail }) };
  });
}

const isClosed = (span: Span | OpenSpan): span is Span => 'endFrame' in span;

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

export function record(p: GeneratorParams, sim: SimResult): BuilderRace {
  const L = p.trackM;
  const lastFrame = sim.lastFrame;
  /** Per car, its crossings rounded to the ms. */
  const cross = sim.cars.map((c) => c.crossings.map(Math.round));
  const lineAt = (car: number, lap: number): SessionTime | undefined => cross[car]![(lap - 1) * MINI_SECTORS];
  const round = (x: number | undefined): SessionTime | undefined => (x === undefined ? undefined : Math.round(x));
  const sc = sim.sc && { start: Math.round(sim.sc.start), end: round(sim.sc.end) };
  const stops = sim.cars.map((c) => c.stops.map((s) => ({ lap: s.lap, compound: s.compound, entry: round(s.entry), boxIn: round(s.boxIn), boxOut: round(s.boxOut), exit: round(s.exit) })));

  // A crossing is appended on the frame it describes, so the engine's order (frame, time, car) is the order by time and
  // car: sorted as numbers keyed `(at × 64 + car) × 2^13 + boundary` (exact: below 2^53 for any race under a day).
  const keys = new Float64Array(cross.reduce((sum, list) => sum + list.length, 0));
  let k = 0;
  for (let car = 0; car < p.cars; car++) cross[car]!.forEach((at, b) => (keys[k++] = (at * 64 + car) * 8_192 + b));
  keys.sort();
  const crossings: Appended<MiniSectorCrossing>[] = Array.from(keys, (key) => {
    const b = key % 8_192;
    const rest = (key - b) / 8_192;
    const car = rest % 64;
    const at = (rest - car) / 64;
    const frame = frameAt(at);
    return { fact: { carId: carId(car), lap: Math.floor(b / MINI_SECTORS) + 1, segment: b % MINI_SECTORS, at, frame }, on: frame };
  });

  /** Per lap number, the cars that completed it, by when (ties by id). */
  const finishers = new Map<number, number[]>();
  for (let n = 1; n <= p.laps; n++) {
    const done = Array.from({ length: p.cars }, (_, c) => c).filter((c) => lineAt(c, n + 1) !== undefined);
    finishers.set(n, done.sort((a, b) => lineAt(a, n + 1)! - lineAt(b, n + 1)! || a - b));
  }

  const records: Appended<LapRecord & { at: number }>[] = [];
  for (let car = 0; car < p.cars; car++) {
    const def = p.field[car]!;
    for (let n = 1; n <= p.laps; n++) {
      const startAt = lineAt(car, n);
      const completedAt = lineAt(car, n + 1);
      if (startAt === undefined || completedAt === undefined) break;
      const base = (n - 1) * MINI_SECTORS;
      const [s1, s2] = SECTOR_SEGMENTS.map((s) => cross[car]![base + s]!);
      const lapTimeMs = completedAt - startAt;
      const sectorTimesMs: LapRecord['sectorTimesMs'] = [s1! - startAt, s2! - s1!, completedAt - s2!];
      const set = setOf(def, n);
      const age = n - set.firstLap;
      const rate = p.compounds[set.compound].wearPctPerLap * def.wearFactor;
      const wear = (laps: number) => {
        const w = known(laps * rate, completedAt);
        return { fl: w, fr: w, rl: w, rr: w };
      };
      const frame = frameAt(completedAt);
      const fact = lapRecord({
        carId: carId(car),
        lapNumber: n,
        lapTimeMs,
        sectorTimesMs,
        completedAt,
        positionAtEnd: finishers.get(n)!.indexOf(car) + 1,
        actualCompound: ACTUAL[set.compound],
        visualCompound: set.compound,
        tyreAgeAtStart: age,
        fuelAtStartKg: known(fuelAtStart(p, n), completedAt),
        fuelAtEndKg: known(fuelAtStart(p, n + 1), completedAt),
        wearAtStartPct: wear(age),
        wearAtEndPct: wear(age + 1),
        inLap: def.stops.some((s) => s.lap === n),
        outLap: def.stops.some((s) => s.lap + 1 === n),
        scShare: sc === undefined ? 0 : overlap(startAt, completedAt, sc.start, sc.end ?? Infinity) / lapTimeMs,
        frame,
      });
      records.push({ fact: { ...fact, status: 'provisional', at: completedAt }, on: frame });
      records.push({ fact: { ...fact, at: completedAt }, on: frame + 1 });
    }
  }
  records.sort((a, b) => byAppend(a, b) || (a.fact.status === b.fact.status ? 0 : a.fact.status === 'provisional' ? -1 : 1));
  const provisionals = new Map<string, FactRef>();
  const laps: Appended<LapRecord>[] = records.map(({ fact: { at: _at, ...fact }, on }, index) => {
    const key = `${fact.carId}:${fact.lapNumber}`;
    if (fact.status === 'provisional') {
      provisionals.set(key, { list: 'laps', index });
      return { fact, on };
    }
    const supersedes = provisionals.get(key);
    return { fact: { ...fact, ...(supersedes && { supersedes }) }, on };
  });

  const stints: Appended<StintRecord>[] = [];
  const pitStops: Appended<PitStopRecord>[] = [];
  for (let car = 0; car < p.cars; car++) {
    stops[car]!.forEach((s, i) => {
      if (s.entry === undefined || s.exit === undefined || s.boxIn === undefined || s.boxOut === undefined) return;
      const frame = frameAt(s.exit);
      const before = setOf(p.field[car]!, s.lap);
      stints.push({
        fact: { carId: carId(car), firstLap: i === 0 ? 1 : stops[car]![i - 1]!.lap + 1, lastLap: s.lap, actualCompound: ACTUAL[before.compound], visualCompound: before.compound, tyreAgeAtFitting: 0, frame },
        on: frame,
      });
      const flag = sc !== undefined && overlap(s.entry, s.exit, sc.start, sc.end ?? Infinity) > 0 ? ('sc' as const) : ('green' as const);
      pitStops.push({
        fact: { carId: carId(car), lap: s.lap, pitLaneEntry: s.entry, pitLaneExit: s.exit, pitLaneTimeMs: s.exit - s.entry, stationaryTimeMs: s.boxOut - s.boxIn, flag, penaltyServed: false, frame },
        on: frame,
      });
    });
  }
  stints.sort(byAppend);
  pitStops.sort(byAppend);

  const events: Appended<RaceEvent>[] = sim.overtakes
    .map(({ at, car, other }) => ({ fact: { kind: 'overtake' as const, at, frame: frameAt(at), carId: carId(car), otherCarId: carId(other), params: {} }, on: frameAt(at) }))
    .sort(byAppend);

  const spans = numbered(buildSpans(p, sim, sc, stops, lineAt));
  const lists = { laps, crossings, stints, pitStops, events };
  const facts = {
    laps: laps.map((e) => e.fact),
    crossings: crossings.map((e) => e.fact),
    stints: stints.map((e) => e.fact),
    pitStops: pitStops.map((e) => e.fact),
    events: events.map((e) => e.fact),
  };
  const closed = new Map<MachineId, Appended<Span>[]>();
  for (const span of spans) if (isClosed(span)) (closed.get(span.machine) ?? closed.set(span.machine, []).get(span.machine)!).push({ fact: span, on: span.endFrame });
  for (const list of closed.values()) list.sort((a, b) => a.on - b.on || (a.fact.carId ?? 0) - (b.fact.carId ?? 0) || a.fact.id - b.fact.id);
  const openSpans = spans.map((span) => {
    const { end: _end, endFrame: _endFrame, ...open } = span as Span;
    return { open: open as OpenSpan, endFrame: isClosed(span) ? span.endFrame : Infinity };
  });

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
      decisions: [],
      clock: [],
      spans: spansAt,
      appendedAt: {},
    };
  };
  const lengthsAt = (frame: FrameNumber): LogLengths => projectionLengths(projectionAt(frame));
  const situationAt = (frame: FrameNumber): EngineView['situation'] => {
    const byMachine: Record<MachineId, OpenSpan[]> = {};
    for (const { open, endFrame } of openSpans) if (open.startFrame <= frame && frame < endFrame) (byMachine[open.machine] ??= []).push(open);
    return { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine };
  };

  const distanceOf = (frame: FrameNumber, car: number): number => sim.distances[(frame - 1) * p.cars + car]!;
  const lapAt = (d: number): number => Math.max(1, Math.floor(d / L) + 1);
  const leaderLap = Array.from({ length: lastFrame + 1 }, (_, frame) => {
    if (frame === 0) return 0;
    let lead = -Infinity;
    for (let car = 0; car < p.cars; car++) lead = Math.max(lead, distanceOf(frame, car));
    return lapAt(lead);
  });

  /** The cars after `frame`: on their lap, in the order of their distance (ties by id), on the set they run, with its wear, and their fuel. */
  const carsAt = (frame: FrameNumber) => {
    const t = timeAfter(frame);
    const distance = Array.from({ length: p.cars }, (_, car) => distanceOf(frame, car));
    const order = distance.map((_, car) => car).sort((a, b) => distance[b]! - distance[a]! || a - b);
    return distance.map((d, car) => {
      const def = p.field[car]!;
      const n = lapAt(d);
      const fraction = d < 0 ? 0 : (d - (n - 1) * L) / L;
      const fitted = stops[car]!.filter((s) => s.boxOut !== undefined && s.boxOut <= t).length;
      const set = setOf(def, fitted === 0 ? 1 : def.stops[fitted - 1]!.lap + 1);
      const age = Math.max(0, n - set.firstLap);
      const wear = known((age + fraction) * p.compounds[set.compound].wearPctPerLap * def.wearFactor, t);
      const corner = { wearPct: wear };
      const fuelKg = fuelAtStart(p, n) - fraction * p.fuelPerLapKg;
      return carState({
        id: carId(car),
        timing: { lap: Math.min(n, p.laps), position: order.indexOf(car) + 1, lapDistanceM: fraction * L, totalDistanceM: Math.max(0, d), sector: fraction < 1 / 3 ? 1 : fraction < 2 / 3 ? 2 : 3 },
        tyres: { actualCompound: ACTUAL[set.compound], visualCompound: set.compound, age, corners: { fl: corner, fr: corner, rl: corner, rr: corner } },
        energy: { fuel: known({ kg: fuelKg, capacityKg: 110, remainingLaps: p.fuelPerLapKg > 0 ? fuelKg / p.fuelPerLapKg : 0, mix: 'standard' as const }, t) },
        updatedAt: { lapData: t, status: t, telemetry: t, damage: t, motion: t, participants: t },
      });
    });
  };

  const views = new Map<string, EngineView>();
  return {
    cars: p.cars,
    laps: p.laps,
    lastFrame,
    framesOfLap: (n) => {
      const frames: FrameNumber[] = [];
      for (let frame = 1; frame <= lastFrame; frame++) if (leaderLap[frame] === n) frames.push(frame);
      return frames;
    },
    viewAt(frame, { from = frame - 1, outputs } = {}) {
      const key = `${frame}:${from}`;
      let view = views.get(key);
      if (view === undefined) {
        const history = projectionAt(frame);
        const built = engineView({
          cars: carsAt(frame),
          sessionTime: timeAfter(frame),
          session: { totalLaps: p.laps, trackLengthM: L, timeLeftMs: 7_200_000 - timeAfter(frame) },
          history,
          situation: situationAt(frame),
          delta: { before: lengthsAt(from), after: projectionLengths(history), ...(from > frame && { rewound: { frameId: frame, at: timeAfter(frame) } }) },
        });
        views.set(key, (view = { ...built, changed: new Set(ALL_CHANGE_TAGS) }));
      }
      return { ...view, outputs: outputs ?? new Map() };
    },
  };
}

/** A stop with its times rounded to the ms; a time is undefined until it happened. */
type RoundedStop = { lap: number; compound: NoiseCompound; entry: number | undefined; boxIn: number | undefined; boxOut: number | undefined; exit: number | undefined };

/**
 * Every span of the race: the clock and the weekend phase; the session phase (grid to racing, the SC, racing again) and
 * race control's DRS (on from the leader's lap 3, off under the SC until the leader's second lap after it); the zones'
 * flags; per car its status, its driver (`human` until a takeover, else `ai`), flags, warnings, lap validity, penalties,
 * compound rule (waived at the exit of the first stop onto another compound), location and activity.
 */
function buildSpans(
  p: GeneratorParams,
  sim: SimResult,
  sc: { start: number; end: number | undefined } | undefined,
  stops: RoundedStop[][],
  lineAt: (car: number, lap: number) => SessionTime | undefined,
): Draft[] {
  const drsOn = sim.drsEnabledAt === undefined ? undefined : Math.round(sim.drsEnabledAt);
  const drsBack = sim.drsBackAt === undefined ? undefined : Math.round(sim.drsBackAt);
  const drsAt = (t: number): { kind: string; detail?: unknown } => {
    if (sc !== undefined && t >= sc.start && (drsBack === undefined || t < drsBack)) return { kind: 'drsOff', detail: { reason: 'safetyCar' } };
    if (drsOn === undefined || t < drsOn) return { kind: 'drsOff', detail: { reason: 'notEnabledYet' } };
    return { kind: 'drsOn' };
  };
  const drsTimes = [0, drsOn, sc?.start, drsBack].filter((t): t is number => t !== undefined).sort((a, b) => a - b);
  const drafts: Draft[] = [
    { machine: 'clock', kind: 'running', start: 0 },
    { machine: 'weekend-phase', kind: 'race', start: 0, detail: { format: 'grandPrix' } },
    ...chain(RACE_PHASES, [
      { kind: 'grid', at: 0 },
      { kind: 'formation', at: 0 },
      { kind: 'startLights', at: 0 },
      { kind: 'racing', at: START_MS },
      { kind: 'neutralised', at: sc?.start, detail: sc && { car: 'SC', stages: [{ stage: 'deployed', at: sc.start }] } },
      { kind: 'racing', at: sc?.end },
    ]),
    ...chain('race-control-race', drsTimes.map((at) => ({ at, ...drsAt(at) }))),
    ...Array.from({ length: 3 }, (_, zone): Draft => ({ machine: 'zone-flags', kind: 'noFlag', start: 0, zone })),
  ];
  for (let car = 0; car < p.cars; car++) {
    const def = p.field[car]!;
    const takeover = def.human && def.takeoverLap !== undefined ? lineAt(car, def.takeoverLap) : undefined;
    const start = def.startCompound ?? 'soft';
    const met = stops[car]!.find((s) => s.compound !== start)?.exit;
    drafts.push(
      { machine: 'car-status', kind: 'competing', start: 0, car },
      ...chain('car-driver', [{ kind: def.human ? 'human' : 'ai', at: 0 }, { kind: 'ai', at: takeover }], car),
      { machine: 'car-flags', kind: 'noFlag', start: 0, car },
      { machine: 'warnings', kind: 'noWarning', start: 0, car },
      { machine: 'lap-validity', kind: 'valid', start: 0, car },
      { machine: 'penalties', kind: 'clear', start: 0, car },
      ...chain('compound-rule', [{ kind: 'required', at: 0 }, { kind: 'waived', at: met }], car),
      ...chain('car-location', [{ kind: 'track', at: 0 }, ...stops[car]!.flatMap((s) => [{ kind: 'pitLane', at: s.entry }, { kind: 'track', at: s.exit }])], car),
      ...chain(
        'car-activity-race',
        [
          { kind: 'racingLap', at: 0 },
          ...stops[car]!.flatMap((s) => [
            { kind: 'inLap', at: lineAt(car, s.lap) },
            { kind: 'boxStop', at: s.boxIn },
            { kind: 'outLap', at: s.boxOut },
            { kind: 'racingLap', at: lineAt(car, s.lap + 2) },
          ]),
        ],
        car,
      ),
    );
  }
  return drafts;
}
