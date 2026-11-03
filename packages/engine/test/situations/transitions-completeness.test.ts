// Every transition is tested (contract C85, C87): one generic test over the registry (`MACHINES`) and every table file
// (`test/situations/<id>/<id>.transitions.ts`), plus the test machines and their tables while no sub-machine is
// registered. Every registered sub-machine has a table; every declared transition has a row and every row uses a
// declared transition; every row's last frame gives its transition, a join row's span with `joinedAt`.
import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../src/situations/index.generated.ts';
import type { SubMachine } from '../../src/situations/machine.ts';
import { TEST_MACHINES } from '../support/test-machines.ts';
import { TEST_TABLES } from '../support/test-machines.transitions.ts';
import { defineTransitionTable, inputs, loadTransitionTables, runRow, tableProblems } from '../support/transition-table.ts';

const tables = [...(await loadTransitionTables()), ...TEST_TABLES];

describe('transition tables', () => {
  it('every registered sub-machine has exactly one table', () => {
    for (const m of [...MACHINES, ...TEST_MACHINES]) expect(tables.filter((t) => t.machine.id === m.id).map((t) => t.machine.id), m.id).toEqual([m.id]);
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

for (const { machine, rows } of tables) {
  describe(`${machine.id} transitions`, () => {
    for (const row of rows) {
      it(row.name, () => {
        const observed = runRow(machine, row).filter((t) => t.from === row.from && t.to.kind === row.to);
        expect(observed.length, `${row.from} -> ${row.to} on the row's last frame`).toBeGreaterThan(0);
        for (const t of observed) expect(t.to.joinedAt, `joinedAt of the new ${row.to} span in ${t.scope}`).toBe(row.join);
      });
    }
  });
}
