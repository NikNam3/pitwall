// Every transition is tested (contract C15, C85, C87): one generic test over the registry (`MACHINES`), step 0's clock
// (a sub-machine outside the registry, C7) and every table file (`test/situations/<id>/<id>.transitions.ts`), plus the
// test machines and their tables. Every sub-machine has a table; every declared transition has a row and every row uses
// a declared transition; every row's last frame gives its transition, a join row's span with `joinedAt`.
import { describe, expect, it } from 'vitest';
import { STEP0_CLOCK } from '../../src/situations/clock/clock.ts';
import { MACHINES } from '../../src/situations/index.generated.ts';
import type { SubMachine } from '../../src/situations/machine.ts';
import { TEST_MACHINES } from '../support/test-machines.ts';
import { TEST_TABLES } from '../support/test-machines.transitions.ts';
import { defineTransitionTable, inputs, loadTransitionTables, runRow, tableProblems, transitionsOf } from '../support/transition-table.ts';

const tables = [...(await loadTransitionTables()), ...TEST_TABLES];

describe('transition tables', () => {
  it('every registered sub-machine, and the clock, has exactly one table', () => {
    for (const m of [...MACHINES, STEP0_CLOCK, ...TEST_MACHINES]) expect(tables.filter((t) => t.machine.id === m.id).map((t) => t.machine.id), m.id).toEqual([m.id]);
  });
  it('every declared transition has a row, every row uses a declared transition', () => {
    expect(tables.flatMap(tableProblems)).toEqual([]);
  });
  it('the check names a missing row, an undeclared row, a join that does not start from none and a repeated name', () => {
    const machine: SubMachine<undefined> = {
      ...TEST_MACHINES[0]!,
      id: 'broken',
      transitions: [
        ['none', 'a'],
        ['a', 'b'],
      ],
      init: () => undefined,
      openSpans: () => [],
      step: () => ({ open: undefined, closed: [] }),
    };
    const table = defineTransitionTable(machine, [
      { name: 'joins in a', from: 'a', to: 'b', input: inputs().frame(), join: true },
      { name: 'joins in a', from: 'b', to: 'a', input: inputs().frame() },
    ]);
    expect(tableProblems(table)).toEqual([
      'broken: no row for none -> a',
      'broken: row "joins in a" uses the undeclared b -> a',
      'broken: join row "joins in a" starts from a, not none',
      'broken: two rows are named "joins in a"',
    ]);
  });
});

describe('the transitions of one frame', () => {
  const span = (id: number, kind: string) => ({ machine: 'm', id, kind, start: 0, confirmed: true, detail: undefined, startFrame: 1 });
  it('a span closed with no successor is kind -> none; one that opens and closes on the frame is none -> kind and kind -> none', () => {
    const fromTo = (before: number[], after: number[], closed: number[]) =>
      transitionsOf('session', before.map((id) => span(id, `k${id}`)), after.map((id) => span(id, `k${id}`)), closed.map((id) => span(id, `k${id}`))).map((t) => [t.from, t.to]);
    expect(fromTo([0], [], [0])).toEqual([['k0', 'none']]);
    expect(fromTo([], [], [3])).toEqual([['none', 'k3'], ['k3', 'none']]);
    expect(fromTo([0], [1], [0])).toEqual([['k0', 'k1']]);
    expect(fromTo([0], [0], [])).toEqual([]);
  });
});

for (const { machine, rows } of tables) {
  describe(`${machine.id} transitions`, () => {
    for (const row of rows) {
      it(row.name, () => {
        const observed = runRow(machine, row).filter((t) => t.from === row.from && t.to === row.to);
        expect(observed.length, `${row.from} -> ${row.to} on the row's last frame`).toBeGreaterThan(0);
        for (const t of observed) expect(t.span?.joinedAt, `joinedAt of the new ${row.to} span in ${t.scope}`).toBe(row.join);
      });
    }
  });
}
