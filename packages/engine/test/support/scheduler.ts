// Shared by the Scheduler tests: history deltas, the feed metrics and the input a scheduler runs on, a scheduler over
// quick calculators that all count as needed, the scheduler's incremental = from scratch check over frames, and the
// guarded view (C41): every unit this harness runs sees its view through `guardedView`, which also counts the projection
// entries a unit reads (`countReads`, C31.1).
import { expect } from 'vitest';
import {
  CalculatorRegistry,
  MACHINES,
  Scheduler,
  SessionRunner,
  situationOf,
  STEP0_CLOCK,
  type Calculator,
  type CalculatorId,
  type ChangeTag,
  type Dependency,
  type EngineView,
  type FeedMetricsView,
  type Frame,
  type HistoryDelta,
  type IncrementalCalculator,
  type QuickCalculator,
  type SchedulerInput,
  type StepResult,
} from '../../src/index.ts';
import type { Situation } from '../../src/situations/situation.ts';
import type { LiveArea } from '../../src/state/live-state.ts';
import { deepFreeze } from '../../src/util/deep-freeze.ts';
import { LIVE_AREA_FIELDS, UndeclaredReadError } from './guarded-input.ts';
import { initFor } from './run.ts';

type Lengths = HistoryDelta['before'];

/** History lengths: zero except those given. */
export const len = (o: Partial<Lengths> = {}): Lengths => ({ laps: 0, stints: 0, pitStops: 0, events: 0, crossings: 0, ...o });

/** The history grew (or shrank) from `before` to `after` entries in each of `fields`; `rewound` marks a void fact (C30). */
export const delta = (before = 0, after = before, rewound = false, fields: ReadonlyArray<keyof Lengths> = ['laps']): HistoryDelta => ({
  before: len(Object.fromEntries(fields.map((f) => [f, before]))),
  after: len(Object.fromEntries(fields.map((f) => [f, after]))),
  ...(rewound ? { rewound: { frameId: -1, at: 0 } } : {}),
});

export const feed = { framesClosed: 0, incompleteFrames: 0, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0, packetsPerSecond: 0, connected: true, msSinceLastPacket: 0, lossPercent: 0 } as FeedMetricsView;

/** The situation of the scheduler inputs: a race, no span open (the session phase is in the projection's spans, C20). */
export const RACING: Situation = { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: {} };

/** A scheduler input at session time `t`; the history holds `laps` laps; `config` is the features' effective config. */
export const input = (t: number, changed: ChangeTag[] = ['timing'], d = delta(), laps = d.after.laps ?? 0, config: SchedulerInput['config'] = {}): SchedulerInput => ({
  live: { feedId: 'f1', sessionTime: t } as never,
  situation: RACING,
  history: { laps: new Array(laps).fill({}) } as never,
  changed: new Set(changed),
  delta: d,
  weekend: undefined,
  feed,
  config,
  priors: {},
});

/**
 * The scheduler input of a step's result (C39): its live state, its situation (`situationOf`), its projection and its
 * weekend context, with the change tags and the delta of the step; no priors (`{}` until the priors store exists).
 * `feed` defaults to a healthy feed.
 */
export const inputOf = (
  { state, changed, delta: d }: Pick<StepResult, 'state' | 'changed' | 'delta'>,
  o: { feed?: FeedMetricsView; config?: SchedulerInput['config'] } = {},
): SchedulerInput => ({
  live: state,
  situation: situationOf(state),
  history: state.history,
  changed,
  delta: d,
  weekend: state.weekend,
  feed: o.feed ?? feed,
  config: o.config ?? {},
  priors: {},
});

/** The view of a step's result, as a unit gets it with no outputs before it (`inputOf`). */
export const viewOf = (result: Pick<StepResult, 'state' | 'changed' | 'delta'>, o: Parameters<typeof inputOf>[1] = {}): EngineView => ({ ...inputOf(result, o), outputs: new Map() });

// ---------------------------------------------------------------------------------------------------------------------
// The guarded view (C41): a unit reads only what it declares in `reads`.

/** The change tag of each projection list (C40); `spans` is by sub-machine (`spans:<id>`). */
const LIST_TAGS: Readonly<Record<string, ChangeTag>> = {
  laps: 'laps',
  stints: 'stints',
  pitStops: 'pitStops',
  events: 'events',
  crossings: 'miniSectors',
  clock: 'clock',
};

/** The live state's fields every unit may read: which feed and session, the race clock's time, the last frame id, realism. */
const FREE_LIVE: ReadonlySet<string> = new Set(['feedId', 'sessionUid', 'sessionTime', 'lastFrameId', 'realism']);

/** What the engine state holds besides the live state (C8, C13, C28): never readable in `live`, present or not. */
const NEVER_LIVE: ReadonlySet<string> = new Set(['open', 'log', 'signals', 'history', 'weekend', 'frameNumber', 'masking', 'frameEvents']);

/** Every sub-machine's id, step 0's clock included: a read of one is guarded whether or not the record holds its spans. */
const MACHINE_IDS: ReadonlySet<string> = new Set([STEP0_CLOCK.id, ...MACHINES.map((m) => m.id)]);

/**
 * What membership matches on every span (C26, ruling F1): its frames, its car or zone and its machine and id. Of a span of
 * an undeclared sub-machine these alone are readable.
 */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set(['startFrame', 'endFrame', 'carId', 'zone', 'machine', 'id']);

/** A car's fields every unit that reads any car area may read: its slot, whether it is active (transitional, Task 24), its freshness. */
const FREE_CAR: ReadonlySet<string> = new Set(['id', 'active', 'updatedAt']);

export type GuardOptions = {
  /** The unit's id, for the error. */
  unit?: CalculatorId;
  /**
   * Every read of a guarded part, declared or not, by its path: `live.cars[1].timing`, `history.laps`,
   * `history.spans.clock`, `situation.byMachine.clock`, `outputs.a`, `feed.connected`; an enumeration of every
   * sub-machine's spans (membership) as `history` and `situation`.
   */
  onRead?: (path: string) => void;
  /**
   * Every read of an entry of a projection list, by the list's path and the entry's index: `history.laps` and 3 for
   * `history.laps[3]`, `history.spans.car-status` and 0 for a closed span. Open spans (`situation`) are no projection
   * entries. `countReads` counts the entries a unit reads with it (C31.1).
   */
  onEntry?: (list: string, index: number) => void;
};

const readOnly = (path: string): never => {
  throw new TypeError(`${path} is read-only: no unit changes its view (C20, C28)`);
};

/** Proxy traps that refuse every write, freezing included: the target is the engine's own, or a copy only the guard holds. */
const refuseWrites = <T extends object>(path: string): ProxyHandler<T> => ({
  set: () => readOnly(path),
  defineProperty: () => readOnly(path),
  deleteProperty: () => readOnly(path),
  preventExtensions: () => readOnly(path),
  setPrototypeOf: () => readOnly(path),
});

/**
 * `view` as a unit that declares `reads` may see it (C39, C41). A read outside the declaration throws an
 * `UndeclaredReadError`:
 * - `live`: the declared live areas only, by the fields step 1's module of each area writes (`LIVE_AREA_FIELDS`); a
 *   car's `id`, `active` and `updatedAt` with any car area, `live.cars` only when a car area is declared; the feed id,
 *   the session uid, the race clock's time, the last frame id and realism always. Nothing else the engine state holds
 *   (its open trackers, log, signals, history, weekend context, frame number, masking, frame events) is readable there;
 * - `history`: a list only with its change tag (`crossings` with `miniSectors`), a sub-machine's closed spans
 *   (`history.spans[id]`) only with `spans:<id>`;
 * - `situation`: a sub-machine's open spans (`situation.byMachine[id]`, so `openSpansOf(view, id)`) only with
 *   `spans:<id>`; the weekend phase always (C14);
 * - membership (`situationAt(view, frame)`, `membershipOf(view, fact)`, C26) needs no declaration in what it matches
 *   (ruling 4, F1): listing `history.spans` or `situation.byMachine`, which both do, is noted as a read of `history` or
 *   `situation`, and of a listed undeclared sub-machine's spans only the frames and identity (`IDENTITY_FIELDS`) can be
 *   read; any other field of them (`kind`, `detail`, ...) throws. Listing frees nothing else;
 * - `outputs`: the declared calculators' outputs only (`get`, `has`), never the whole map;
 * - `feed` only with `feed`;
 * - `delta`, `changed`, `weekend`, `config` and `priors` always.
 * The situation is deep-frozen where it is (its spans are step 2's own, ruling 6); the projection's lists are handed out
 * read-only (they are the log's own arrays, which cannot be frozen; the log freezes their entries): a unit that changes
 * either throws a `TypeError`. The view itself is not changed: the guard reads through to it.
 */
export function guardedView(view: EngineView, reads: readonly Dependency[], { unit = 'unit', onRead = () => {}, onEntry }: GuardOptions = {}): EngineView {
  const tags = new Set<string>(reads.filter((r): r is ChangeTag => typeof r === 'string'));
  const calculators = new Set(reads.flatMap((r) => (typeof r === 'object' ? [r.calculator] : [])));
  const read = (path: string, declared: boolean): void => {
    onRead(path);
    if (!declared) throw new UndeclaredReadError(unit, path, 'C41');
  };

  /**
   * `target` behind a read-only proxy whose own string keys, and the `guarded` ones, pass only when `allowed`; other keys
   * (an inspection's `asymmetricMatch`, `then`) read through. `wrap` maps what passes.
   */
  const guard = <T extends object>(
    target: T,
    path: string,
    allowed: (key: string) => boolean,
    wrap: (value: unknown, key: string) => unknown = (v) => v,
    guarded: ReadonlySet<string> = new Set(),
  ): T =>
    new Proxy<T>(target, {
      ...refuseWrites<T>(path),
      get(t, key, receiver) {
        if (typeof key === 'symbol' || (!guarded.has(key) && !Object.prototype.hasOwnProperty.call(t, key))) return Reflect.get(t, key, receiver);
        read(`${path}.${key}`, allowed(key));
        return wrap(Reflect.get(t, key, receiver), key);
      },
    });

  /** The projection's lists, read-only, one proxy per list and view; a read of an entry of the projection goes to `onEntry`. */
  const lists = new WeakMap<object, unknown>();
  const entries = (path: string): ProxyHandler<object> =>
    onEntry === undefined || !path.startsWith('history.')
      ? {}
      : {
          get(t, key, receiver) {
            // an array index: what Array methods and indexing read (`length`, method names and symbols are none)
            if (typeof key === 'string' && key.charCodeAt(0) >= 48 && key.charCodeAt(0) <= 57) onEntry(path, Number(key));
            return Reflect.get(t, key, receiver);
          },
        };
  const readOnlyList = (list: unknown, path: string): unknown => {
    if (typeof list !== 'object' || list === null) return list;
    if (!lists.has(list)) lists.set(list, new Proxy(list, { ...refuseWrites(path), ...entries(path) }));
    return lists.get(list);
  };

  /**
   * A span of a sub-machine the unit does not declare, as membership may match it (ruling F1): its frames and identity
   * (`IDENTITY_FIELDS`) read through, any other field (`kind`, `detail`, `start`, `confirmed` ...) throws.
   */
  const identityOnly = (span: object, path: string): object =>
    new Proxy(span, {
      ...refuseWrites(path),
      get(t, key, receiver) {
        if (typeof key === 'symbol' || IDENTITY_FIELDS.has(key) || !Object.prototype.hasOwnProperty.call(t, key)) return Reflect.get(t, key, receiver);
        return read(`${path}.${key}`, false);
      },
    });

  /**
   * A record of spans by sub-machine (`history.spans`, `situation.byMachine`): a machine's spans with `spans:<id>`.
   * Listing the record frees nothing: it is noted as a read of `whole` (membership, ruling 4), and each listed
   * undeclared machine's spans may then be taken once (as `situationAt` and `membershipOf` do), but only their frames
   * and identity can be read (`identityOnly`). Any other read of an undeclared machine throws.
   */
  const byMachine = (record: object, path: string, whole: string, wrap: (value: unknown, key: string) => unknown): object => {
    const listed = new Set<string>();
    const declared = (machine: string): boolean => tags.has(`spans:${machine}`);
    const target: Record<string, unknown> = { ...record };
    const guarded = (key: string): boolean => MACHINE_IDS.has(key) || Object.prototype.hasOwnProperty.call(target, key);
    return new Proxy(target, {
      ...refuseWrites(path),
      get(t, key, receiver) {
        if (typeof key === 'symbol' || !guarded(key)) return Reflect.get(t, key, receiver);
        const value = Reflect.get(t, key, receiver);
        if (declared(key)) return (onRead(`${path}.${key}`), wrap(value, key));
        if (!listed.delete(key)) return read(`${path}.${key}`, false);
        onRead(`${path}.${key}`);
        const spans = Array.isArray(value) ? value.map((span: object, i: number) => identityOnly(span, `${path}.${key}[${i}]`)) : value;
        return readOnlyList(spans, `${path}.${key}`);
      },
      ownKeys(t) {
        onRead(whole);
        const keys = Reflect.ownKeys(t);
        for (const key of keys) if (typeof key === 'string' && !declared(key)) listed.add(key);
        return keys;
      },
      has(t, key) {
        if (typeof key === 'string' && guarded(key) && !declared(key) && !listed.has(key)) read(`${path}.${key}`, false);
        return Reflect.has(t, key);
      },
    });
  };

  // live
  const areas = (Object.keys(LIVE_AREA_FIELDS) as LiveArea[]).filter((area) => tags.has(area));
  const stateFields = new Set(areas.flatMap((area) => LIVE_AREA_FIELDS[area].state));
  const carFields = new Set(areas.flatMap((area) => LIVE_AREA_FIELDS[area].car));
  const liveTarget: Record<string, unknown> = { ...view.live };
  if (carFields.size > 0 && Array.isArray(view.live.cars)) {
    const cars = view.live.cars.map((car, i) => guard({ ...car }, `live.cars[${i}]`, (k) => FREE_CAR.has(k) || carFields.has(k)));
    liveTarget['cars'] = new Proxy(cars, refuseWrites('live.cars'));
  }
  const live = guard(liveTarget, 'live', (k) => FREE_LIVE.has(k) || stateFields.has(k) || (k === 'cars' && carFields.size > 0), undefined, NEVER_LIVE);

  // history
  const projection = view.history as unknown as Record<string, unknown>;
  const spans = byMachine({ ...(projection['spans'] as object | undefined) }, 'history.spans', 'history', (list, machine) => readOnlyList(list, `history.spans.${machine}`));
  const history = guard(
    { ...projection, spans },
    'history',
    (k) => k === 'spans' || (LIST_TAGS[k] !== undefined && tags.has(LIST_TAGS[k])),
    (list, k) => (k === 'spans' ? list : readOnlyList(list, `history.${k}`)),
  );

  // situation
  deepFreeze(view.situation);
  const situation = guard({ ...view.situation, byMachine: byMachine(view.situation.byMachine, 'situation.byMachine', 'situation', (v) => v) }, 'situation', () => true);

  // outputs
  const whole = (): never => {
    read('outputs', false);
    throw new Error('unreachable');
  };
  const outputs = {
    get: (id: CalculatorId) => (read(`outputs.${id}`, calculators.has(id)), view.outputs.get(id)),
    has: (id: CalculatorId) => (read(`outputs.${id}`, calculators.has(id)), view.outputs.has(id)),
    get size(): number {
      return whole();
    },
    forEach: whole,
    entries: whole,
    keys: whole,
    values: whole,
    [Symbol.iterator]: whole,
  } as unknown as ReadonlyMap<CalculatorId, unknown>;

  return guard(
    { ...view, live, history, situation, outputs, feed: guard({ ...view.feed }, 'feed', () => tags.has('feed')) } as EngineView,
    'view',
    () => true,
  );
}

/** `calc` with every call given its guarded view (`guardedView` with its own `reads`), so an undeclared read throws (C41). */
export function guarded(calc: Calculator, onRead?: (path: string) => void): Calculator {
  const g = (view: EngineView) => guardedView(view, calc.reads, { unit: calc.id, ...(onRead && { onRead }) });
  const insights = calc.insights;
  const withInsights = insights && { insights: (out: unknown, prev: unknown, view: EngineView) => insights(out, prev, g(view)) };
  if (calc.kind === 'quick') return { ...calc, compute: (view) => calc.compute(g(view)), ...withInsights };
  return { ...calc, init: (view) => calc.init(g(view)), update: (acc, d, view) => calc.update(acc, d, g(view)), ...withInsights };
}

/** A unit's from-scratch computation (C31.1): `compute` of a quick unit, `init` of an incremental one. */
export const fromScratch =
  (unit: Calculator) =>
  (view: EngineView): unknown =>
    unit.kind === 'quick' ? unit.compute(view) : unit.init(view);

/**
 * The projection entries `run` reads through `unit`'s guarded view of `view` (C31.1, C41): every entry of a projection
 * list (`history.crossings[i]`, `history.spans.<id>[i]` ...) it reads counts once, however often it reads it; open spans,
 * the live state and the outputs are no entries. `run` defaults to the unit's from-scratch computation (`fromScratch`);
 * an incremental unit's fold is `(v) => unit.update(acc, v.delta, v)`. Work is counted in entries, never timed.
 */
export function countReads(unit: Calculator, view: EngineView, run: (view: EngineView) => unknown = fromScratch(unit)): number {
  /** Per list, a mark per entry read. */
  const read = new Map<string, Uint8Array>();
  let count = 0;
  const onEntry = (list: string, index: number): void => {
    let marks = read.get(list);
    if (marks === undefined || index >= marks.length) {
      const grown = new Uint8Array(Math.max(1024, 2 * (index + 1)));
      if (marks !== undefined) grown.set(marks);
      read.set(list, (marks = grown));
    }
    if (marks[index] === 0) {
      marks[index] = 1;
      count++;
    }
  };
  run(guardedView(view, unit.reads, { unit: unit.id, onEntry }));
  return count;
}

/** A quick calculator that reads timing, runs every frame and returns the session time, unless `o` says otherwise. */
export const quick = (id: string, o: Partial<QuickCalculator<unknown>> = {}): Calculator =>
  ({ kind: 'quick', id, reads: ['timing'], cadence: 'frame', compute: (v) => v.live.sessionTime, ...o }) as Calculator;

/**
 * A scheduler over `calcs`, each run through its guarded view (C41), that needs `needed`; outputs frozen, as in every
 * test (a unit never changes an output it returned).
 */
export const sched = (calcs: Calculator[], needed = calcs.map((c) => c.id)) => {
  const s = new Scheduler(CalculatorRegistry.build(calcs.map((calc) => guarded(calc))), { freezeOutputs: true });
  s.setNeeded(needed);
  return s;
};

type Folded = { crossings: number; under: number; events: number };

/** The race's session-phase sub-machine, whose spans `underPhase` reads. */
const RACE_PHASES = 'session-phase-race';

/** A span covers the frame a fact describes (C26): from the frame it opened on up to, not including, the one it closed on. */
const covers = (span: { startFrame: number; endFrame: number }, frame: number): boolean => span.startFrame <= frame && frame < span.endFrame;

/**
 * A reader that folds what happened while a session phase of `kind` stood, as `incidents` does for a neutralisation: it
 * counts the mini-sector crossings, those a closed span of `kind` of `session-phase-race` covers (by the frame each
 * crossing describes, C26), and the events. A pure fold over projection entries (C31): new crossings against every
 * closed span, newly closed spans against the crossings folded before.
 */
export const underPhase = (kind: string): IncrementalCalculator<Folded, Folded> => {
  const spansOf = (v: EngineView) => v.history.spans[RACE_PHASES] ?? [];
  const count = (crossings: ReadonlyArray<{ frame: number }>, spans: ReadonlyArray<{ kind: string; startFrame: number; endFrame: number }>): number =>
    crossings.reduce((n, c) => n + spans.filter((s) => s.kind === kind && covers(s, c.frame)).length, 0);
  const fold = (acc: Folded, v: EngineView, d: { crossings: [number, number]; spans: [number, number] }): Folded => {
    const { crossings } = v.history;
    const spans = spansOf(v);
    const under = acc.under + count(crossings.slice(d.crossings[0], d.crossings[1]), spans) + count(crossings.slice(0, d.crossings[0]), spans.slice(d.spans[0], d.spans[1]));
    return { crossings: acc.crossings + d.crossings[1] - d.crossings[0], under, events: v.history.events.length };
  };
  return {
    kind: 'incremental',
    id: `probe.under.${kind}`,
    reads: ['miniSectors', 'events', `spans:${RACE_PHASES}` as ChangeTag],
    cadence: 'frame',
    init: (v) => fold({ crossings: 0, under: 0, events: 0 }, v, { crossings: [0, v.history.crossings.length], spans: [0, 0] }),
    update: (acc, d, v) =>
      fold(acc, v, {
        crossings: [d.before.crossings ?? 0, d.after.crossings ?? 0],
        spans: [d.before[`spans:${RACE_PHASES}`] ?? 0, d.after[`spans:${RACE_PHASES}`] ?? 0],
      }),
    output: (acc) => acc,
  };
};

/** `underPhase` of a neutralisation. */
export const underNeutralisation = underPhase('neutralised');

/**
 * Runs `frames` through a `SessionRunner` and a `Scheduler` that needs `calc` and, on every step it ran, expects its
 * output to equal a fresh `init` over that step's view (incremental = from scratch, docs/testing.md section 5). The
 * scheduler is never reset by hand: only a flashback rewinds (`delta.rewound`, C30). Both see the guarded view (C41).
 */
export function expectScheduledIncremental<Acc, Out>(calc: IncrementalCalculator<Acc, Out>, frames: readonly Frame[]): void {
  const runner = new SessionRunner(initFor([...frames]));
  const scheduler = sched([calc as Calculator]);
  let i = 0;
  const check = (r: StepResult) => {
    const input = inputOf(r);
    const { ran, outputs } = scheduler.run(input);
    const fresh = guardedView({ ...input, outputs: new Map() }, calc.reads, { unit: calc.id });
    if (ran.includes(calc.id)) expect(outputs.get(calc.id), `frame ${i}`).toEqual(calc.output(calc.init(fresh)));
    i++;
  };
  for (const frame of frames) runner.apply(frame, check);
  runner.end(check);
}
