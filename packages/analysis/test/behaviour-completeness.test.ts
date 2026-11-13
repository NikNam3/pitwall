// Every behaviour table is complete (contract C44, C87): one generic test over every unit folder whose `index.ts` exports
// `<UNIT>_BEHAVIOUR`. Its table has a row for every kind (from the domain's span declarations, `SPAN_DECLARATIONS`) of
// every sub-machine the unit's calculator declares in `reads` (`spans:<machine>`), and no row for a machine it does not
// declare or a kind its machine does not declare; and every unit that reads a sub-machine (a `spans:<machine>` in its
// `reads`) exports one.
import { SPAN_DECLARATIONS, type SpanDeclaration } from '@pitwall/domain';
import type { Calculator } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import type { BehaviourTable } from '../src/shared/behaviour.ts';
import { behaviourExport, CALCULATORS, JOB_UNITS, JOBS, loadUnitFolders, PENDING_JOBS } from './units.ts';

/** The sub-machines a unit declares in `reads` (`spans:<machine>`). */
const machinesRead = (calc: Calculator): string[] =>
  calc.reads.flatMap((read) => (typeof read === 'string' && read.startsWith('spans:') ? [read.slice('spans:'.length)] : []));

/**
 * What is wrong with `unit`'s table against its calculator (`calc`) and the span declarations: a kind of a machine it
 * reads without a row, a row of a machine it does not read, a row of a kind its machine does not declare; a table of a
 * unit without a registered calculator.
 */
function tableProblems(
  unit: string,
  table: BehaviourTable<unknown>,
  calc: Calculator | undefined,
  declarations: readonly SpanDeclaration[] = SPAN_DECLARATIONS,
): string[] {
  if (calc === undefined) return [`${unit}: exports ${behaviourExport(unit)} but no calculator ${unit} is registered`];
  const read = machinesRead(calc);
  const kindsOf = (machine: string): readonly string[] | undefined => declarations.find((d) => d.machine === machine)?.kinds;
  const problems: string[] = [];
  for (const machine of read) {
    const kinds = kindsOf(machine) ?? [];
    const rows = table[machine] ?? {};
    for (const kind of kinds) if (!Object.hasOwn(rows, kind)) problems.push(`${unit}: no row for ${machine} ${kind}`);
  }
  for (const [machine, rows] of Object.entries(table)) {
    if (!read.includes(machine)) {
      problems.push(`${unit}: a row for ${machine}, which it does not read`);
      continue;
    }
    const kinds = kindsOf(machine) ?? [];
    for (const kind of Object.keys(rows)) if (!kinds.includes(kind)) problems.push(`${unit}: a row for ${machine} ${kind}, which ${machine} does not declare`);
  }
  return problems;
}

const folders = await loadUnitFolders();

/** The calculators and analyses, and every job as its unit (its reads and `prepare`, SP4.3b 4.3b2 precondition 7). */
const UNITS: readonly Calculator[] = [...CALCULATORS, ...JOB_UNITS];

describe('behaviour tables (C44)', () => {
  it('every exported table covers every kind of every sub-machine its unit reads, and nothing else', () => {
    const problems = folders.flatMap(({ unit, table }) => (table === undefined ? [] : tableProblems(unit, table, UNITS.find((c) => c.id === unit))));
    expect(problems).toEqual([]);
  });

  it('every unit that reads a sub-machine exports its behaviour table', () => {
    const withTable = new Set(folders.filter((f) => f.table !== undefined).map((f) => f.unit));
    const missing = UNITS.filter((calc) => machinesRead(calc).length > 0 && !withTable.has(calc.id)).map(
      (calc) => `${calc.id}: reads ${machinesRead(calc).join(', ')} but its index.ts does not export ${behaviourExport(calc.id)}`,
    );
    expect(missing).toEqual([]);
  });

  it("a job's reads are checked against its unit's table: the strategy job's table covers the sub-machines it reads", () => {
    expect(JOBS.map((j) => j.id)).toEqual(expect.arrayContaining(['forecast-score', 'strategy']));
    const strategy = folders.find((f) => f.unit === 'strategy');
    expect(strategy?.table, 'strategy/index.ts exports STRATEGY_BEHAVIOUR').toBeDefined();
    const job = UNITS.find((c) => c.id === 'strategy');
    expect(job === undefined ? [] : machinesRead(job)).toEqual(
      expect.arrayContaining(['session-phase-race', 'car-activity-race', 'car-driver', 'compound-rule', 'weekend-phase']),
    );
    expect(tableProblems('strategy', strategy?.table ?? {}, job)).toEqual([]);
  });

  it('PENDING_JOBS lists only ids of exported jobs (SP4.3b2 N2: a stale entry fails)', () => {
    const stale = PENDING_JOBS.filter((id) => !JOBS.some((j) => j.id === id));
    expect(stale).toEqual([]);
  });

  it('the check names a missing row, a row of an unread machine, a row of an undeclared kind and a table without a unit', () => {
    const declarations: SpanDeclaration[] = [
      { machine: 'car-location', scope: 'car', kinds: ['garage', 'pitLane', 'track'] },
      { machine: 'weekend-phase', scope: 'session', kinds: ['practice', 'qualifying', 'race', 'none'] },
    ];
    const calc = { kind: 'quick', id: 'probe', reads: ['timing', 'spans:car-location'], cadence: 'frame', compute: () => 0 } as Calculator;
    const table: BehaviourTable<string> = {
      'car-location': { garage: 'off', track: 'on', boxStop: 'off' },
      'weekend-phase': { none: 'notApplicable' },
    };
    expect(tableProblems('probe', table, calc, declarations)).toEqual([
      'probe: no row for car-location pitLane',
      'probe: a row for car-location boxStop, which car-location does not declare',
      'probe: a row for weekend-phase, which it does not read',
    ]);
    expect(tableProblems('probe', table, undefined, declarations)).toEqual(['probe: exports PROBE_BEHAVIOUR but no calculator probe is registered']);
    expect(tableProblems('probe', { 'car-location': { garage: 'off', pitLane: 'off', track: 'on' } }, calc, declarations)).toEqual([]);
  });

  it('finds the unit folders and their tables by name', () => {
    expect(folders.map((f) => f.unit)).toEqual(expect.arrayContaining(['gaps', 'lap-times', 'pit-stop-count', 'race-moment']));
    // M7-R: pit-stop-count reads car-status, so it holds a table over every car-status kind (C44)
    expect(folders.find((f) => f.unit === 'pit-stop-count')?.table).toHaveProperty('car-status');
    expect(behaviourExport('race-moment')).toBe('RACE_MOMENT_BEHAVIOUR');
  });
});
