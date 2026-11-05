// Test races for `gaps`: mini-sector histories with car states that agree with them (position, lap, total distance).
import { carId, MINI_SECTORS, unknown, type CarId, type CarState, type GapperLines, type MiniSectorCrossing, type OpenSpan, type Span, type WeekendPhase } from '@pitwall/domain';
import { projectionLengths, type EngineView } from '@pitwall/engine';
import { carState, crossings, engineView, phaseSpans } from '../../../../test-support/builders/index.ts';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import type { GapsOutput } from '../../src/gaps/index.ts';
import { scheduled } from '../scheduled.ts';

/** The default race session's track length (`engineView`). */
export const TRACK_M = 5000;
const SEGMENT_M = TRACK_M / MINI_SECTORS;

/**
 * Where a crossing is, in mini-sectors from the start line (the engine's convention): segment 0 is the line at the
 * start of its lap, so the line that completes lap L is `(L + 1, 0)`, at progress `L × 50`.
 */
export const progressOf = (m: Pick<MiniSectorCrossing, 'lap' | 'segment'>): number => (m.lap - 1) * MINI_SECTORS + m.segment;

/** Sorted by time, ties by car id: the order the history appends them in. */
export const byTime = (list: MiniSectorCrossing[]): MiniSectorCrossing[] =>
  [...list].sort((a, b) => a.at - b.at || a.carId - b.carId);

/**
 * Every car runs `laps` laps at `paceMs`, car `i` starting `offsetsMs[i]` after 0, and closes its last lap at
 * `(laps + 1, 0)`: car i is `offsetsMs[i] - offsetsMs[j]` behind car j everywhere.
 */
export function offsetRace(offsetsMs: number[], laps: number, paceMs = 90_000): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  offsetsMs.forEach((offset, i) => {
    for (let n = 1; n <= laps; n++) list.push(...crossings(carId(i), n, paceMs, offset + (n - 1) * paceMs));
    list.push({ carId: carId(i), lap: laps + 1, segment: 0, at: offset + laps * paceMs, frame: 0 });
  });
  return byTime(list);
}

export type CarOverride = { position?: number };

/** The weekend phases a view can be in (`view.situation.weekendPhase`, C14). */
export type Phase = 'race' | 'practice' | 'qualifying' | 'none';

/** A car's status span kind; the game's result status is no longer read (C17, C43). */
export type StatusKind = 'competing' | 'retired' | 'disqualified' | 'absent';

/** The race session phases in the order a race goes through them (`session-phase-race`). */
export const RACE_ORDER = ['grid', 'formation', 'startLights', 'racing', 'finished', 'postSession'] as const;
export type RacePhaseKind = (typeof RACE_ORDER)[number];

const openSpan = (machine: string, kind: string, start: number, over: Partial<OpenSpan> = {}): OpenSpan => ({
  machine,
  id: 0,
  kind,
  start,
  confirmed: true,
  detail: undefined,
  startFrame: start,
  ...over,
});
const closedSpan = (machine: string, id: number, kind: string, start: number, end: number): Span => ({
  ...openSpan(machine, kind, start, { id }),
  end,
  endFrame: end,
});

/** An open car-status span of `car` (`retired` carries its cause, not yet known). */
export const statusSpan = (car: number, kind: StatusKind): OpenSpan =>
  openSpan('car-status', kind, 0, { carId: carId(car), detail: kind === 'retired' ? { cause: unknown('notReceived') } : undefined });

/**
 * One car state per car that has a crossing (plus the overridden ones), agreeing with the history: the lap it is on,
 * the total distance at its latest crossing, and the position by distance (ties: the earlier crossing first, then id).
 * `over` sets a car's position instead.
 */
export function carsFor(miniSectors: MiniSectorCrossing[], over: Record<number, CarOverride> = {}): CarState[] {
  const latest = new Map<CarId, MiniSectorCrossing>();
  for (const m of miniSectors) latest.set(m.carId, m);
  const ids = [...new Set([...latest.keys(), ...Object.keys(over).map((k) => carId(Number(k)))])];
  const progress = (id: CarId) => (latest.has(id) ? progressOf(latest.get(id)!) : -1);
  const at = (id: CarId) => latest.get(id)?.at ?? Number.POSITIVE_INFINITY;
  const order = [...ids].sort((a, b) => progress(b) - progress(a) || at(a) - at(b) || a - b);
  return ids.map((id) => {
    const last = latest.get(id);
    return carState({
      id,
      timing: {
        position: over[id]?.position ?? order.indexOf(id) + 1,
        lap: last?.lap ?? 1,
        lapDistanceM: last === undefined ? 0 : last.segment * SEGMENT_M,
        totalDistanceM: Math.max(0, progress(id)) * SEGMENT_M,
      },
    });
  });
}

/**
 * The view over these crossings, every crossing new; `cars` default to `carsFor(miniSectors)`. Every car has an open
 * `competing` car-status span unless `status` says otherwise (`'none'`: no span open); `kind` is the weekend phase,
 * its span open (C14). A race's session phases are spans (C20): the lights go out at `lightsOutAt` (default 0, as
 * `field` starts; `null`: not yet, the session is in `startLights`), so `racing` starts then; `now` is the race phase
 * open now (default `racing`, or `startLights` before lights out). `phases` are the neutralisations closed in the
 * projection (`neutralisation` builds them), `open` the one open in the situation (default none, C20); `racing`
 * closes at the first of them and, with no `open`, reopens after the last. In practice, qualifying and `none` the
 * session-phase span open is `running`. `teammateCar` makes a second car ours (`ourCars`).
 */
export const viewOf = (
  miniSectors: MiniSectorCrossing[],
  {
    cars,
    playerCar = 0,
    teammateCar,
    config = {},
    lightsOutAt = 0,
    kind = 'race',
    now,
    phases = [],
    open,
    status = {},
  }: {
    cars?: CarState[];
    playerCar?: number;
    teammateCar?: number;
    config?: EngineView['config'];
    lightsOutAt?: number | null;
    kind?: Phase;
    now?: RacePhaseKind;
    phases?: Span[];
    open?: OpenSpan;
    status?: Record<number, StatusKind | 'none'>;
  } = {},
): EngineView => {
  const carStates = cars ?? carsFor(miniSectors);
  const ids = [...new Set([...carStates.map((c) => c.id as number), ...Object.keys(status).map(Number)])];
  const statusSpans = ids.flatMap((id) => (status[id] === 'none' ? [] : [statusSpan(id, status[id] ?? 'competing')]));
  const closed: Span[] = [...phases];
  const byMachine: Record<string, OpenSpan[]> = { 'car-status': statusSpans };
  const phaseOpen = (machine: string, spanKind: string) => openSpan(machine, spanKind, 0, { detail: spanKind === 'race' ? { format: 'grandPrix' } : undefined });
  const weekendPhase: WeekendPhase =
    kind === 'race'
      ? { kind: 'race', format: 'grandPrix' }
      : kind === 'practice'
        ? { kind: 'practice', format: 'practice', segment: undefined }
        : kind === 'qualifying'
          ? { kind: 'qualifying', format: 'grandPrix', segment: undefined }
          : { kind: 'none' };
  byMachine['weekend-phase'] = [phaseOpen('weekend-phase', kind)];
  if (kind === 'race') {
    const lights = lightsOutAt ?? 0;
    const current = now ?? (lightsOutAt === null ? 'startLights' : 'racing');
    const neutral = [...phases, ...(open === undefined ? [] : [open])];
    const racingEnd = neutral.map((s) => s.start).sort((x, y) => x - y)[0] ?? lights;
    const startOf = (spanKind: RacePhaseKind) => (spanKind === 'racing' ? lights : spanKind === 'finished' || spanKind === 'postSession' ? racingEnd : 0);
    const endOf = (spanKind: RacePhaseKind) => (spanKind === 'startLights' ? lights : spanKind === 'racing' ? racingEnd : startOf(spanKind));
    const upTo = RACE_ORDER.indexOf(current);
    RACE_ORDER.slice(0, upTo).forEach((spanKind, i) => closed.push(closedSpan('session-phase-race', i, spanKind, startOf(spanKind), endOf(spanKind))));
    byMachine['session-phase-race'] = [];
    if (current === 'racing' && neutral.length > 0) {
      closed.push(closedSpan('session-phase-race', 3, 'racing', lights, racingEnd));
      // the race runs again after the last closed neutralisation unless one is still open
      if (open === undefined) byMachine['session-phase-race'] = [openSpan('session-phase-race', 'racing', Math.max(...phases.map((p) => p.end)), { id: 5 })];
    } else {
      byMachine['session-phase-race'] = [openSpan('session-phase-race', current, startOf(current), { id: upTo })];
    }
  } else if (kind !== 'none') {
    byMachine[`session-phase-${kind}`] = [openSpan(`session-phase-${kind}`, 'running', 0)];
  }
  const { spans, situation } = phaseSpans(closed, open, { weekendPhase, byMachine });
  const view = engineView({
    cars: carStates,
    history: { crossings: miniSectors, spans },
    situation,
    playerCar,
    config,
  });
  return teammateCar === undefined ? view : { ...view, live: { ...view.live, teammateCar: carId(teammateCar) } };
};

/** The view as the scheduler hands it to `gaps`: through its guarded view, so a read it does not declare throws (C41). */
export const guarded = (view: EngineView): EngineView => guardedView(view, gapsCalculator.reads, { unit: 'gaps' });

/** `gaps` stepped by its tests: its output reads the view its accumulator was last folded on (C31.2). */
export const gaps = scheduled(gapsCalculator);

/** `init` over the guarded view, as on a fresh run. */
export const run = (view: EngineView): GapsOutput => gaps.output(gaps.init(guarded(view)));

/** The delta from one view's history to the next one's. */
export const deltaOf = (from: EngineView, to: EngineView, rewound = false) => ({
  before: projectionLengths(from.history),
  after: projectionLengths(to.history),
  ...(rewound ? { rewound: { frameId: -1, at: 0 } } : {}),
});

/** Turns -0 into 0 so `toEqual` compares the number, not its sign bit. */
export const plain = (n: number): number => n + 0;

/** A gapper point's x in mini-sectors from the start line: completed laps × 50 + segment (`lap` = that / 50). */
export const progressAtX = (lap: number): number => Math.round(lap * MINI_SECTORS);

/** Whether a gapper point lies on a line crossing: a whole lap. */
export const isWholeLap = (lap: number): boolean => Math.abs(lap * MINI_SECTORS - progressAtX(lap)) < 1e-6 && progressAtX(lap) % MINI_SECTORS === 0;

/**
 * A car's gapper points at whole laps (its line crossings after lights out) as `[lap, gapMs]`, from `points`; laps from
 * 1 (the start line, x = 0, is not pinned). `undefined` when the car is not in `cars` (the window).
 */
export const lapPoints = (lines: GapperLines, id: number): [number, number][] | undefined =>
  lines.cars
    .find((c) => c.carId === id)
    ?.points?.filter((p) => isWholeLap(p.lap) && p.lap >= 1)
    .map((p): [number, number] => [progressAtX(p.lap) / MINI_SECTORS, plain(p.gapMs)]);

/** A car's gapper points as `[progress, gapMs]` (x × 50, so whole numbers compare exactly). */
export const pointsByProgress = (lines: GapperLines, id: number): [number, number][] | undefined =>
  lines.cars.find((c) => c.carId === id)?.points?.map((p): [number, number] => [progressAtX(p.lap), plain(p.gapMs)]);

/** The car ids of the gapper's lines (the window), sorted. */
export const windowOf = (lines: GapperLines): number[] => lines.cars.map((c) => c.carId as number).sort((a, b) => a - b);

/**
 * A garage restart's pass (as `lap-times`' scene builds it): car `car` runs lap `lapNumber` again from segment 0 at
 * `startAt`, up to `segment`; each crossing supersedes the newest earlier crossing of its slot in `history` (C25).
 */
export function restartPass(history: readonly MiniSectorCrossing[], car: number, lapNumber: number, paceMs: number, startAt: number, segment = MINI_SECTORS - 1): MiniSectorCrossing[] {
  const id = carId(car);
  return crossings(id, lapNumber, paceMs, startAt)
    .slice(0, segment + 1)
    .map((c): MiniSectorCrossing => {
      const index = history.findLastIndex((h) => h.carId === id && h.lap === lapNumber && h.segment === c.segment);
      return index < 0 ? c : { ...c, supersedes: { list: 'crossings', index } };
    });
}
