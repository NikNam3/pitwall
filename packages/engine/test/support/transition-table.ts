// The transition-table harness (contract C85). A sub-machine's table file, `test/situations/<id>/<id>.transitions.ts`,
// default-exports `defineTransitionTable(machine, rows)`: one row per declared transition and one join row per way of
// joining a session in progress. The generic tests in `test/situations/` load every table file and the registry, then run
// every row (`transitions-completeness.test.ts`), check rows and declared transitions both ways (`tableProblems`) and
// feed every machine random signal sequences (`invariants.property.test.ts`). A sub-machine's own test files add its
// segment tests; they need no other wiring.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenSpan, Scope } from '@pitwall/domain';
import { initialState } from '../../src/index.ts';
import type { MachineInput, SubMachine } from '../../src/situations/machine.ts';
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
      base = { at: 0, frameId: 0, signals, live, clock: { paused: false, offsetMs: 0 }, upstream: {}, weekendPhase: { kind: 'pending' } };
    }
    return structuredClone(base);
  };
})();

/**
 * The inputs a sub-machine steps through, one per frame, `FRAME_MS` apart from race-clock time 0 with frame ids from 0.
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

/**
 * One transition of a sub-machine: stepping `machine.init()` through the inputs `input` builds, the last frame turns
 * an open span of kind `from` into one of kind `to` in one of the machine's scopes (a car, a zone or the session).
 * `from: 'none'`: no span was open there before. `join`: the session's first frame opens `to` as the current situation
 * of a session in progress, so the span has `joinedAt`; every other row's new span has none.
 */
export type TransitionRow = { name: string; from: string | 'none'; to: string; input: MachineInputBuilder; join?: true };

/** A sub-machine and its rows. */
export type TransitionTable = { machine: SubMachine<unknown>; rows: readonly TransitionRow[] };

/** A sub-machine's transition table; what its table file default-exports. */
export const defineTransitionTable = <Open>(machine: SubMachine<Open>, rows: readonly TransitionRow[]): TransitionTable => ({
  machine: machine as SubMachine<unknown>,
  rows,
});

const declared = (machine: SubMachine<unknown>, from: string, to: string): boolean => machine.transitions.some(([f, t]) => f === from && t === to);

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
 * Where an open span lives: the session, its car (`carId`) or its zone (`detail.zone`, which a zone sub-machine's spans
 * carry). A scope holds at most one open span; a span's successor in its scope starts where it ends.
 */
export const scopeKey = (scope: Scope, span: { carId?: number | undefined; detail: unknown }): string =>
  scope === 'session' ? 'session' : scope === 'car' ? `car ${span.carId}` : `zone ${(span.detail as { zone?: number } | undefined)?.zone}`;

/** A change of a scope's open span between two frames: `from` the kind before (`none`: no span), `to` the new span. */
export type ObservedTransition = { scope: string; from: string; to: OpenSpan };

/** The transitions between the open spans before and after a step: per scope, a new span id is a transition. */
export const transitionsOf = (scope: Scope, before: readonly OpenSpan[], after: readonly OpenSpan[]): ObservedTransition[] => {
  const previous = new Map(before.map((s) => [scopeKey(scope, s), s]));
  return after.flatMap((span) => {
    const key = scopeKey(scope, span);
    const was = previous.get(key);
    return was?.id === span.id ? [] : [{ scope: key, from: was?.kind ?? 'none', to: span }];
  });
};

/** What a row's last frame did: the machine's transitions on it, after stepping `init()` through the frames before. */
export const runRow = (machine: SubMachine<unknown>, row: TransitionRow): ObservedTransition[] => {
  const frames = row.input.build();
  const last = frames.pop();
  if (last === undefined) throw new Error(`row "${row.name}" builds no frame`);
  const open = frames.reduce((o, input) => machine.step(o, input).open, machine.init());
  return transitionsOf(machine.scope, machine.openSpans(open), machine.openSpans(machine.step(open, last).open));
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
