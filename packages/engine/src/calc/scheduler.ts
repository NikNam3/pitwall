import type { Insight, SessionTime } from '@pitwall/domain';
import type { HistoryDelta } from '../history/delta.ts';
import type { ChangeTag } from '../step/step.ts';
import { InsightBook } from './insight-book.ts';
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
  /** Boxed because an accumulator or output may legitimately be `undefined`. */
  acc: { value: unknown } | undefined;
  prevOutput: { value: unknown } | undefined;
};

type Entry = { calc: Calculator; slot: Slot };

type Evaluation = { acc: Slot['acc']; output: unknown; raised: Insight[] | undefined };

const freshSlot = (): Slot => ({ lastRunAt: undefined, pending: undefined, acc: undefined, prevOutput: undefined });

/** Adds a frame to what is pending: the oldest `before`, the newest `after`, truncated if any frame was. */
const absorb = (pending: Pending | undefined, input: SchedulerInput): Pending => {
  if (pending === undefined) return { changed: new Set(input.changed), delta: input.delta };
  for (const tag of input.changed) pending.changed.add(tag);
  pending.delta = {
    before: pending.delta.before,
    after: input.delta.after,
    truncated: pending.delta.truncated || input.delta.truncated,
  };
  return pending;
};

const isDue = (cadence: Cadence, lastRunAt: SessionTime, pending: Pending, now: SessionTime): boolean => {
  if (cadence === 'frame') return true;
  if (typeof cadence === 'object') return now < lastRunAt || now - lastRunAt >= 1000 / cadence.hz;
  const { before, after } = pending.delta;
  switch (cadence) {
    case 'lapCompleted':
      return after.laps > before.laps;
    case 'pitStop':
      return after.pitStops > before.pitStops;
    case 'flagChange':
      return pending.changed.has('flagPhases');
    case 'sessionChange':
      return pending.changed.has('session');
  }
};

const isAffected = (calc: Calculator, pending: Pending, ran: ReadonlySet<CalculatorId>): boolean =>
  calc.reads.some((read) => {
    if (read === 'feed') return true;
    return typeof read === 'object' ? ran.has(read.calculator) : pending.changed.has(read);
  });

/** Computes without touching the slot, so a throw leaves the calculator as it was. */
const evaluate = (calc: Calculator, slot: Slot, view: EngineView): Evaluation => {
  let acc: Slot['acc'];
  let output: unknown;
  if (calc.kind === 'quick') {
    output = calc.compute(view);
  } else {
    const next =
      slot.acc === undefined || view.delta.truncated ? calc.init(view) : calc.update(slot.acc.value, view.delta, view);
    acc = { value: next };
    output = calc.output(next);
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
export class Scheduler {
  readonly #registry: CalculatorRegistry;
  readonly #entries: readonly Entry[];
  readonly #outputs = new Map<CalculatorId, unknown>();
  readonly #book = new InsightBook();
  #needed: ReadonlySet<CalculatorId> = new Set();

  constructor(registry: CalculatorRegistry) {
    this.#registry = registry;
    this.#entries = registry.order.map((calc) => ({ calc, slot: freshSlot() }));
  }

  get activeInsights(): Insight[] {
    return this.#book.active;
  }

  /** Only these calculators and the ones they read, transitively, run. Throws `RegistryError` for an unknown id. */
  setNeeded(ids: Iterable<CalculatorId>): void {
    const needed = new Set<CalculatorId>();
    const visit = (id: CalculatorId): void => {
      if (needed.has(id)) return;
      const calc = this.#registry.get(id);
      if (calc === undefined) throw new RegistryError('unknownDependency', [id], `unknown calculator "${id}"`);
      needed.add(id);
      for (const read of calc.reads) if (typeof read === 'object') visit(read.calculator);
    };
    for (const id of ids) visit(id);
    this.#needed = needed;
  }

  /** Forgets accumulators, previous outputs and run times, so every needed calculator starts over. Outputs stay. */
  reset(): void {
    for (const { slot } of this.#entries) Object.assign(slot, freshSlot());
  }

  run(input: SchedulerInput): SchedulerResult {
    const now = input.state.sessionTime;
    const ran = new Set<CalculatorId>();
    const blocked = new Set<CalculatorId>();
    const errors: SchedulerResult['errors'] = [];
    const insights: InsightChange[] = [];

    for (const { calc, slot } of this.#entries) {
      // Every calculator keeps track of what it missed, needed or not, so an accumulator never skips history.
      const pending = absorb(slot.pending, input);
      slot.pending = pending;
      if (!this.#needed.has(calc.id)) continue;
      if (calc.reads.some((read) => typeof read === 'object' && blocked.has(read.calculator))) {
        blocked.add(calc.id);
        continue;
      }
      const due = slot.lastRunAt === undefined || isDue(calc.cadence, slot.lastRunAt, pending, now);
      if (!due || (slot.lastRunAt !== undefined && !isAffected(calc, pending, ran))) continue;

      const view: EngineView = {
        state: input.state,
        changed: pending.changed,
        delta: pending.delta,
        feed: input.feed,
        outputs: this.#outputs,
      };
      try {
        const { acc, output, raised } = evaluate(calc, slot, view);
        slot.acc = acc;
        slot.prevOutput = { value: output };
        slot.lastRunAt = now;
        slot.pending = undefined;
        this.#outputs.set(calc.id, output);
        ran.add(calc.id);
        insights.push(...this.#book.apply(`error:${calc.id}`, [], now));
        if (raised !== undefined) insights.push(...this.#book.apply(`calc:${calc.id}`, raised, now));
      } catch (error) {
        this.#outputs.delete(calc.id);
        blocked.add(calc.id);
        errors.push({ id: calc.id, error });
        insights.push(...this.#book.apply(`error:${calc.id}`, [calculatorError(calc.id, error, input)], now));
      }
    }
    return { ran: [...ran], outputs: new Map(this.#outputs), errors, insights };
  }
}
