import type { Insight, SessionTime } from '@pitwall/domain';
import type { HistoryDelta } from '../log/types.ts';
import type { Snapshotable } from '../runner/session-runner.ts';
import type { ChangeTag } from '../step/step.ts';
import { deepFreeze } from '../util/deep-freeze.ts';
import { InsightBook, type InsightBookState } from './insight-book.ts';
import { RegistryError, type CalculatorRegistry } from './registry.ts';
import type { Cadence, Calculator, CalculatorId, EngineView, InsightChange } from './types.ts';

/** What the scheduler is given per frame: an `EngineView` without the calculator outputs, which it keeps itself. */
export type SchedulerInput = Omit<EngineView, 'outputs'>;

export type SchedulerResult = {
  /** The calculators that ran successfully, in registry order. */
  ran: CalculatorId[];
  /** The outputs of every calculator that last ran successfully, including those from earlier frames. */
  outputs: ReadonlyMap<CalculatorId, unknown>;
  errors: Array<{ id: CalculatorId; error: unknown }>;
  insights: InsightChange[];
};

/** What happened since a calculator last ran successfully. */
type Pending = { changed: Set<ChangeTag>; delta: HistoryDelta };

type Slot = {
  lastRunAt: SessionTime | undefined;
  pending: Pending | undefined;
  /** Calculators this one reads that ran since it last ran successfully: like a change tag, they stay until it runs. */
  ranDependencies: Set<CalculatorId>;
  /** Boxed because an accumulator or output may legitimately be `undefined`. */
  acc: { value: unknown } | undefined;
  prevOutput: { value: unknown } | undefined;
};

type Entry = { calc: Calculator; slot: Slot };

type Evaluation = { acc: Slot['acc']; output: unknown; raised: Insight[] | undefined };

const freshSlot = (): Slot => ({
  lastRunAt: undefined,
  pending: undefined,
  ranDependencies: new Set(),
  acc: undefined,
  prevOutput: undefined,
});

type Rewound = NonNullable<HistoryDelta['rewound']>;

/** The earlier of two rewind targets: everything after it changed since a calculator last ran (Task 2 review F2). */
const earlier = (a: Rewound | undefined, b: Rewound | undefined): Rewound | undefined => {
  if (a === undefined || b === undefined) return a ?? b;
  return b.at < a.at || (b.at === a.at && b.frameId < a.frameId) ? b : a;
};

/** Adds a frame to what is pending: the oldest `before`, the newest `after`, rewound if any frame was (to the earliest target). */
const absorb = (pending: Pending | undefined, input: SchedulerInput): Pending => {
  if (pending === undefined) return { changed: new Set(input.changed), delta: input.delta };
  for (const tag of input.changed) pending.changed.add(tag);
  const rewound = earlier(pending.delta.rewound, input.delta.rewound);
  pending.delta = { before: pending.delta.before, after: input.delta.after, ...(rewound && { rewound }) };
  return pending;
};

/** A copy `absorb` cannot change: it adds to `changed` and replaces `delta`. */
const copyPending = (pending: Pending | undefined): Pending | undefined => pending && { changed: new Set(pending.changed), delta: pending.delta };

/** A calculator's slot as a snapshot keeps it: no accumulator (a rewind rebuilds it with `init`, C30), the previous output shared. */
type SlotBookkeeping = Pick<Slot, 'lastRunAt' | 'pending' | 'ranDependencies' | 'prevOutput'>;

/**
 * What the scheduler knows of the frames it ran on (`Scheduler.snapshot`): per calculator its last run, what is pending
 * and its previous output; the last outputs, the active insights and the failed calculators. Outputs are shared, not
 * copied: no unit changes an output after returning it (frozen under test, see `FREEZE_OUTPUTS`).
 */
export type SchedulerBookkeeping = {
  slots: ReadonlyMap<CalculatorId, SlotBookkeeping>;
  outputs: ReadonlyMap<CalculatorId, unknown>;
  insights: InsightBookState;
  failed: ReadonlySet<CalculatorId>;
};

/**
 * Under vitest every output is frozen deep, so a unit that changes an output after returning it fails its tests: the
 * scheduler's snapshots share the outputs (C27). A production run does not pay for the freeze.
 */
// eslint-disable-next-line no-restricted-globals -- whether tests run, which shapes no result (supervisor ruling, Task 3)
const FREEZE_OUTPUTS = typeof process !== 'undefined' && process.env['VITEST'] !== undefined;

const isDue = (cadence: Cadence, lastRunAt: SessionTime, pending: Pending, now: SessionTime): boolean => {
  if (cadence === 'frame') return true;
  if (typeof cadence === 'object') return now < lastRunAt || now - lastRunAt >= 1000 / cadence.hz;
  const { before, after, rewound } = pending.delta;
  // A rewind discards history, so event calculators run again to catch up with it.
  switch (cadence) {
    case 'lapCompleted':
      return rewound !== undefined || (after.laps ?? 0) > (before.laps ?? 0);
    case 'pitStop':
      return rewound !== undefined || (after.pitStops ?? 0) > (before.pitStops ?? 0);
    case 'flagChange':
      return pending.changed.has('flagPhases');
    case 'sessionChange':
      return pending.changed.has('session');
  }
};

const isAffected = (calc: Calculator, slot: Slot, pending: Pending): boolean =>
  calc.reads.some((read) => {
    if (read === 'feed') return true;
    return typeof read === 'object' ? slot.ranDependencies.has(read.calculator) : pending.changed.has(read);
  });

/**
 * Wraps each call of a calculator (`compute`, `init`, `update`, `output`) and returns the call's result. The engine
 * reads no clock itself: a caller that wants timings measures inside the hook.
 */
export type OnCalculatorRun = <T>(id: CalculatorId, run: () => T) => T;

export type SchedulerOptions = { onCalculatorRun?: OnCalculatorRun };

const direct: OnCalculatorRun = (_id, run) => run();

/** Computes without touching the slot, so a throw leaves the calculator as it was. */
const evaluate = (calc: Calculator, slot: Slot, view: EngineView, hook: OnCalculatorRun): Evaluation => {
  let acc: Slot['acc'];
  let output: unknown;
  if (calc.kind === 'quick') {
    output = hook(calc.id, () => calc.compute(view));
  } else {
    const next = hook(calc.id, () =>
      slot.acc === undefined || view.delta.rewound !== undefined ? calc.init(view) : calc.update(slot.acc.value, view.delta, view),
    );
    acc = { value: next };
    output = hook(calc.id, () => calc.output(next));
  }
  return { acc, output, raised: calc.insights?.(output, slot.prevOutput?.value, view) };
};

const calculatorError = (id: CalculatorId, error: unknown, input: SchedulerInput): Insight => ({
  key: `system.calculatorError:${id}`,
  severity: 'advisory',
  category: 'system',
  feedId: input.state.feedId,
  kind: 'system.calculatorError',
  params: { calculatorId: id, message: error instanceof Error ? error.message : String(error) },
  raisedAt: input.state.sessionTime,
});

/**
 * Runs the needed calculators on each frame, in dependency order, when they are due and affected (spec 7.3).
 * A calculator that throws is reported, not propagated: its dependents are skipped and the rest run on.
 */
export class Scheduler implements Snapshotable<SchedulerBookkeeping> {
  readonly #registry: CalculatorRegistry;
  readonly #entries: readonly Entry[];
  readonly #slots: ReadonlyMap<CalculatorId, Slot>;
  readonly #outputs = new Map<CalculatorId, unknown>();
  readonly #book = new InsightBook();
  /** Calculators whose last attempt threw, or that were skipped because a dependency did; cleared when they succeed. */
  readonly #failed = new Set<CalculatorId>();
  readonly #hook: OnCalculatorRun;
  #needed: ReadonlySet<CalculatorId> = new Set();

  constructor(registry: CalculatorRegistry, opts: SchedulerOptions = {}) {
    this.#registry = registry;
    this.#hook = opts.onCalculatorRun ?? direct;
    this.#entries = registry.order.map((calc) => ({ calc, slot: freshSlot() }));
    this.#slots = new Map(this.#entries.map(({ calc, slot }) => [calc.id, slot]));
  }

  get activeInsights(): Insight[] {
    return this.#book.active;
  }

  /**
   * Only these calculators and the ones they read, transitively, run. Returns the calculators needed now that were
   * not before, in registry order. Throws `RegistryError` for an unknown id.
   */
  setNeeded(ids: Iterable<CalculatorId>): CalculatorId[] {
    const needed = this.withDependencies(ids);
    const before = this.#needed;
    this.#needed = needed;
    return this.#registry.order.map((calc) => calc.id).filter((id) => needed.has(id) && !before.has(id));
  }

  /** These calculators and the ones they read, transitively. Throws `RegistryError` for an unknown id. */
  withDependencies(ids: Iterable<CalculatorId>): Set<CalculatorId> {
    const found = new Set<CalculatorId>();
    const visit = (id: CalculatorId): void => {
      if (found.has(id)) return;
      const calc = this.#registry.get(id);
      if (calc === undefined) throw new RegistryError('unknownDependency', [id], `unknown calculator "${id}"`);
      found.add(id);
      for (const read of calc.reads) if (typeof read === 'object') visit(read.calculator);
    };
    for (const id of ids) visit(id);
    return found;
  }

  /** The bookkeeping now (C27); later runs leave it as it is. */
  snapshot(): SchedulerBookkeeping {
    const slots = new Map<CalculatorId, SlotBookkeeping>();
    for (const { calc, slot } of this.#entries) {
      const { lastRunAt, pending, ranDependencies, prevOutput } = slot;
      slots.set(calc.id, { lastRunAt, pending: copyPending(pending), ranDependencies: new Set(ranDependencies), prevOutput });
    }
    return { slots, outputs: new Map(this.#outputs), insights: this.#book.snapshot(), failed: new Set(this.#failed) };
  }

  /**
   * Puts the bookkeeping of `s` back. The accumulators stay as they are: the rewind that restores a snapshot reaches
   * every calculator as `delta.rewound`, and `init` rebuilds them (C30).
   */
  restore(s: SchedulerBookkeeping): void {
    for (const { calc, slot } of this.#entries) {
      const saved = s.slots.get(calc.id);
      if (saved === undefined) continue;
      slot.lastRunAt = saved.lastRunAt;
      slot.pending = copyPending(saved.pending);
      slot.ranDependencies = new Set(saved.ranDependencies);
      slot.prevOutput = saved.prevOutput;
    }
    this.#outputs.clear();
    for (const [id, output] of s.outputs) this.#outputs.set(id, output);
    this.#book.restore(s.insights);
    this.#failed.clear();
    for (const id of s.failed) this.#failed.add(id);
  }

  /** Forgets accumulators, previous outputs and run times, so every needed calculator starts over. Outputs stay. */
  reset(): void {
    for (const { slot } of this.#entries) Object.assign(slot, freshSlot());
    this.#failed.clear();
  }

  /**
   * One pass over the needed calculators, in dependency order. With `only`, the other calculators are left untouched:
   * they neither run nor note what they missed (for a pass that adds nothing, like a demand change between frames).
   */
  run(input: SchedulerInput, opts: { only?: ReadonlySet<CalculatorId> } = {}): SchedulerResult {
    const now = input.state.sessionTime;
    const ran = new Set<CalculatorId>();
    const errors: SchedulerResult['errors'] = [];
    const insights: InsightChange[] = [];

    for (const { calc, slot } of this.#entries) {
      if (opts.only !== undefined && !opts.only.has(calc.id)) continue;
      // Every calculator keeps track of what it missed, needed or not, so an accumulator never skips history.
      const pending = absorb(slot.pending, input);
      slot.pending = pending;
      if (!this.#needed.has(calc.id)) continue;
      if (calc.reads.some((read) => typeof read === 'object' && this.#failed.has(read.calculator))) {
        this.#failed.add(calc.id);
        continue;
      }
      const due = slot.lastRunAt === undefined || isDue(calc.cadence, slot.lastRunAt, pending, now);
      if (!due || (slot.lastRunAt !== undefined && !isAffected(calc, slot, pending))) continue;

      const view: EngineView = {
        state: input.state,
        activeFlagPhase: input.activeFlagPhase,
        situation: input.situation,
        changed: pending.changed,
        delta: pending.delta,
        feed: input.feed,
        outputs: this.#outputs,
        config: input.config,
      };
      let evaluation: Evaluation;
      try {
        evaluation = evaluate(calc, slot, view, this.#hook);
      } catch (error) {
        this.#outputs.delete(calc.id);
        this.#failed.add(calc.id);
        errors.push({ id: calc.id, error });
        insights.push(...this.#book.apply(`error:${calc.id}`, [calculatorError(calc.id, error, input)], now));
        continue;
      }
      if (FREEZE_OUTPUTS) deepFreeze(evaluation.output);
      slot.acc = evaluation.acc;
      slot.prevOutput = { value: evaluation.output };
      slot.lastRunAt = now;
      slot.pending = undefined;
      slot.ranDependencies.clear();
      this.#outputs.set(calc.id, evaluation.output);
      this.#failed.delete(calc.id);
      ran.add(calc.id);
      for (const dependent of this.#registry.dependentsOf(calc.id)) this.#slots.get(dependent)?.ranDependencies.add(calc.id);
      insights.push(...this.#book.apply(`error:${calc.id}`, [], now));
      if (evaluation.raised !== undefined) insights.push(...this.#book.apply(`calc:${calc.id}`, evaluation.raised, now));
    }
    return { ran: [...ran], outputs: new Map(this.#outputs), errors, insights };
  }
}
