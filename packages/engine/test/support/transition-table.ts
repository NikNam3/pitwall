// The transition-table harness (contract C15, C85). A sub-machine's table file, `test/situations/<id>/<id>.transitions.ts`,
// default-exports `defineTransitionTable(machine, rows)`: one row per declared transition and one join row per way of
// joining a session in progress. What a table drives is `Steppable`: a registered sub-machine stepped with
// `MachineInput`s (`inputs()`), or step 0's clock (C7), which is a sub-machine outside the registry, stepped with its own
// inputs (`test/support/clock-inputs.ts`); each row carries the builder of its machine's inputs. The generic tests in
// `test/situations/` load every table file and the registry, then run every row (`transitions-completeness.test.ts`),
// check rows and declared transitions both ways (`tableProblems`) and feed every machine random sequences
// (`invariants.property.test.ts`, the clock's `clock/clock.property.test.ts`). A sub-machine's own test files add its
// segment tests; they need no other wiring.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CarId, MachineId, OpenSpan, Scope, Span, SpanDeclaration } from '@pitwall/domain';
import { initialState } from '../../src/index.ts';
import type { MachineInput } from '../../src/situations/machine.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor } from './run.ts';

/** Race-clock time between two built frames. */
export const FRAME_MS = 16;

/** Edits one frame's input in place: its signals, live state, clock, upstream spans or weekend phase. */
export type InputEdit = (input: MachineInput, index: number) => void;

/** A fresh session's input: every signal and value as before the first packet, the clock running, no upstream span. */
const baseInput = (() => {
  let base: MachineInput | undefined;
  return (): MachineInput => {
    if (base === undefined) {
      const { open: _open, history: _history, weekend: _weekend, signals, log: _log, ...live } = initialState(
        initFor(new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).build()),
      );
      base = { at: 0, frameId: 0, frameNumber: 0, signals, live, clock: { paused: false, offsetMs: 0, simulatedEnd: undefined }, upstream: {}, weekendPhase: { kind: 'pending' } };
    }
    return structuredClone(base);
  };
})();

/**
 * The inputs a sub-machine steps through, one per frame, `FRAME_MS` apart from race-clock time 0 with frame ids from 0
 * and frame numbers from 1 (C26).
 * Each frame starts as the previous one left it (signals, live state, clock, upstream spans, weekend phase), without
 * the previous frame's events, and is then edited; the first starts from a fresh session (`weekendPhase` pending).
 */
export class MachineInputBuilder {
  readonly #edits: InputEdit[] = [];

  /** One frame, edited by `edit`. */
  frame(edit: InputEdit = () => {}): this {
    this.#edits.push(edit);
    return this;
  }

  /** `n` frames, each edited by `edit` (`index` counts from the builder's first frame). */
  frames(n: number, edit: InputEdit = () => {}): this {
    for (let k = 0; k < n; k++) this.#edits.push(edit);
    return this;
  }

  build(): MachineInput[] {
    const built: MachineInput[] = [];
    let previous = baseInput();
    this.#edits.forEach((edit, index) => {
      const input = structuredClone(previous);
      input.at = index * FRAME_MS;
      input.frameId = index;
      input.frameNumber = index + 1;
      input.signals.events = [];
      edit(input, index);
      built.push(input);
      previous = input;
    });
    return built;
  }
}

/** A new, empty `MachineInputBuilder`. */
export const inputs = (): MachineInputBuilder => new MachineInputBuilder();

/** A span a step closed, as the harness reads it: which span it was, of what kind, in which scope. */
export type ClosedSpan = Pick<Span, 'id' | 'kind' | 'detail' | 'joinedAt'> & { carId?: CarId | undefined; zone?: number | undefined };

/**
 * What a transition table drives (C15): a sub-machine with its declared transitions, its open state `Open` and the
 * inputs `Input` it steps with. A registered `SubMachine` is one (its inputs are `MachineInput`s); so is step 0's clock
 * (`clockStepper`). `none` in a transition: no span open in the scope, before (`from`) or after (`to`).
 */
export type Steppable<Open = unknown, Input = unknown> = {
  id: MachineId;
  spans: SpanDeclaration;
  transitions: ReadonlyArray<readonly [from: string | 'none', to: string | 'none']>;
  init(): Open;
  openSpans(open: Open): OpenSpan[];
  step(open: Open, input: Input): { open: Open; closed: readonly ClosedSpan[] };
};

/** What builds a row's frames: one input per frame, in order. */
export type InputBuilder<Input> = { build(): Input[] };

/**
 * One transition of a sub-machine: stepping `machine.init()` through the inputs `input` builds, the last frame turns
 * the scope's situation `from` into `to` in one of the machine's scopes (a car, a zone or the session). `none`: no span
 * open there (`from`: before the frame; `to`: after it, the span closed with no successor). A span may open and close
 * on the same frame (C26): that frame gives both `none -> kind` and `kind -> none`. `join`: the session's first frame
 * opens `to` as the current situation of a session in progress, so the span has `joinedAt`; every other row's new span
 * has none.
 */
export type TransitionRow<Input = MachineInput> = { name: string; from: string | 'none'; to: string | 'none'; input: InputBuilder<Input>; join?: true };

/** A machine and its rows. */
export type TransitionTable = { machine: Steppable; rows: readonly TransitionRow<unknown>[] };

/** A sub-machine's transition table; what its table file default-exports. */
export const defineTransitionTable = <Open, Input>(machine: Steppable<Open, Input>, rows: readonly TransitionRow<NoInfer<Input>>[]): TransitionTable => ({
  machine: machine as unknown as Steppable,
  rows: rows as readonly TransitionRow<unknown>[],
});

const declared = (machine: Steppable, from: string, to: string): boolean => machine.transitions.some(([f, t]) => f === from && t === to);

/**
 * What is wrong with a table (C85, both ways), one sentence each: a declared transition without a row, a row of an
 * undeclared transition, a join row that does not start from `none`, two rows with one name. Empty when complete.
 */
export const tableProblems = ({ machine, rows }: TransitionTable): string[] => [
  ...machine.transitions.filter(([from, to]) => !rows.some((r) => r.from === from && r.to === to)).map(([from, to]) => `${machine.id}: no row for ${from} -> ${to}`),
  ...rows.filter((r) => !declared(machine, r.from, r.to)).map((r) => `${machine.id}: row "${r.name}" uses the undeclared ${r.from} -> ${r.to}`),
  ...rows.filter((r) => r.join === true && r.from !== 'none').map((r) => `${machine.id}: join row "${r.name}" starts from ${r.from}, not none`),
  ...rows.filter((r, i) => rows.findIndex((o) => o.name === r.name) !== i).map((r) => `${machine.id}: two rows are named "${r.name}"`),
];

/**
 * Where a span lives: the session, its car (`carId`) or its zone (`zone`, which a zone sub-machine's spans
 * carry). A scope holds at most one open span; a span's successor in its scope starts where it ends.
 */
export const scopeKey = (scope: Scope, span: { carId?: number | undefined; zone?: number | undefined }): string =>
  scope === 'session' ? 'session' : scope === 'car' ? `car ${span.carId}` : `zone ${span.zone}`;

/**
 * A change of a scope's situation in one frame: `from` the kind before, `to` the kind after (`none`: no span), `span`
 * the span `to` names (the new open span, or one that opened and closed on the frame); none for `to: none`.
 */
export type ObservedTransition = { scope: string; from: string; to: string; span?: OpenSpan | ClosedSpan };

type Passed = OpenSpan | ClosedSpan | undefined;

/**
 * The transitions of one frame, per scope: from the open span before it, through every span that opened and closed on
 * it (`closed`, in order), to the open span after it; `none` where no span is open. A new span id is a transition, and
 * so is a span that closed without a successor (`kind -> none`).
 */
export const transitionsOf = (
  scope: Scope,
  before: readonly OpenSpan[],
  after: readonly OpenSpan[],
  closed: readonly ClosedSpan[] = [],
): ObservedTransition[] => {
  // Group by scope once (a scan per scope is quadratic in the cars); the first span of a scope is its open one.
  const group = (spans: readonly (OpenSpan | ClosedSpan)[]) => {
    const byKey = new Map<string, (OpenSpan | ClosedSpan)[]>();
    for (const s of spans) {
      const key = scopeKey(scope, s);
      const list = byKey.get(key);
      if (list) list.push(s);
      else byKey.set(key, [s]);
    }
    return byKey;
  };
  const wasBy = group(before);
  const nowBy = group(after);
  const closedBy = group(closed);
  const keys = [...new Set([...wasBy.keys(), ...nowBy.keys(), ...closedBy.keys()])];
  return keys.flatMap((key) => {
    const was = wasBy.get(key)?.[0] as OpenSpan | undefined;
    const now = nowBy.get(key)?.[0] as OpenSpan | undefined;
    const passed: Passed[] = [was, ...((closedBy.get(key) ?? []) as ClosedSpan[]).filter((s) => s.id !== was?.id && s.id !== now?.id), now];
    return passed.slice(1).flatMap((to, i): ObservedTransition[] => {
      const from = passed[i];
      if (from?.id === to?.id) return [];
      return [{ scope: key, from: from?.kind ?? 'none', to: to?.kind ?? 'none', ...(to && { span: to }) }];
    });
  });
};

/** What a row's last frame did: the machine's transitions on it, after stepping `init()` through the frames before. */
export const runRow = (machine: Steppable, row: TransitionRow<unknown>): ObservedTransition[] => {
  const frames = row.input.build();
  const last = frames.pop();
  if (last === undefined) throw new Error(`row "${row.name}" builds no frame`);
  const open = frames.reduce((o, input) => machine.step(o, input).open, machine.init());
  const next = machine.step(open, last);
  return transitionsOf(machine.spans.scope, machine.openSpans(open), machine.openSpans(next.open), next.closed);
};

const SITUATIONS_TESTS = join(import.meta.dirname, '..', 'situations');

/** Every table file `test/situations/<id>/<id>.transitions.ts`, loaded. */
export const loadTransitionTables = async (): Promise<TransitionTable[]> => {
  const files = readdirSync(SITUATIONS_TESTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) => {
      const file = `${dir.name}.transitions.ts`;
      return readdirSync(join(SITUATIONS_TESTS, dir.name)).includes(file) ? [join(SITUATIONS_TESTS, dir.name, file)] : [];
    })
    .sort();
  const modules = await Promise.all(files.map(async (file) => (await import(pathToFileURL(file).href)) as { default: TransitionTable }));
  return modules.map((m) => m.default);
};
