// The machine registry (contract C15, C40, C63): sub-machines are collected by a generated index (`MACHINES`), each
// has exactly one scope, declared in domain with its span kinds (`spans`, one file `domain/src/situations/<id>.ts` per
// sub-machine and one for the clock, collected by the generated `SPAN_DECLARATIONS`), and step 2 runs them in the order
// their declared upstream inputs give; a cycle or an upstream that is not registered is an error, not an order.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPAN_DECLARATIONS } from '@pitwall/domain';
import { CHANGE_TAGS } from '../../src/index.ts';
import { STEP0_CLOCK } from '../../src/situations/clock/clock.ts';
import { MACHINES } from '../../src/situations/index.generated.ts';
import type { SubMachine } from '../../src/situations/machine.ts';
import { MachineCycleError, machineOrder, UnknownMachineError } from '../../src/situations/registry.ts';
import { TEST_MACHINES } from '../support/test-machines.ts';

/** A sub-machine that only declares its id and upstream inputs. */
const stub = (id: string, upstream: string[] = []): SubMachine<unknown> => ({
  id,
  appliesTo: 'all',
  spans: { machine: id, scope: 'session', kinds: [] },
  inputs: { signals: [], values: [], upstream },
  transitions: [],
  init: () => undefined,
  openSpans: () => [],
  step: (open) => ({ open, closed: [] }),
});

const ids = (machines: ReadonlyArray<SubMachine<unknown>>): string[] => machines.map((m) => m.id);

describe('machineOrder', () => {
  it('the order follows declared inputs: every machine comes after its upstream machines', () => {
    const order = ids(machineOrder([stub('activity', ['location', 'status']), stub('status'), stub('location', ['status'])]));
    expect(order).toEqual(['status', 'location', 'activity']);
  });
  it('machines without upstream inputs keep the registry order', () => {
    expect(ids(machineOrder([stub('c'), stub('a'), stub('b')]))).toEqual(['c', 'a', 'b']);
  });
  it('a cycle throws MachineCycleError', () => {
    expect(() => machineOrder([stub('a', ['b']), stub('b', ['a'])])).toThrow(MachineCycleError);
    expect(() => machineOrder([stub('a', ['c']), stub('b', ['a']), stub('c', ['b'])])).toThrow(MachineCycleError);
  });
  it('a machine that names itself as upstream is a cycle', () => {
    expect(() => machineOrder([stub('a', ['a'])])).toThrow(MachineCycleError);
  });
  it('an upstream id that is not registered throws UnknownMachineError', () => {
    expect(() => machineOrder([stub('a'), stub('b', ['missing'])])).toThrow(UnknownMachineError);
  });
});

describe('the registered sub-machines', () => {
  const all = [...MACHINES, ...TEST_MACHINES];

  it('have an order: no cycle, every upstream registered, each machine once', () => {
    expect([...ids(machineOrder(MACHINES))].sort()).toEqual([...ids(MACHINES)].sort());
    expect([...ids(machineOrder(all))].sort()).toEqual([...ids(all)].sort());
  });
  it('every sub-machine declares exactly one scope', () => {
    for (const m of all) expect(['session', 'car', 'zone'], m.id).toContain(m.spans.scope);
  });
  it('every sub-machine applies to all or to a list of weekend phases', () => {
    for (const m of all) {
      if (m.appliesTo !== 'all') expect(m.appliesTo.length, m.id).toBeGreaterThan(0);
      if (m.appliesTo !== 'all') for (const phase of m.appliesTo) expect(['practice', 'qualifying', 'race'], m.id).toContain(phase);
    }
  });
  it('every registered sub-machine is the folder situations/<id>/ with its machine.ts, each id once', () => {
    const situations = join(import.meta.dirname, '..', '..', 'src', 'situations');
    for (const m of MACHINES) expect(existsSync(join(situations, m.id, 'machine.ts')), m.id).toBe(true);
    expect(new Set(ids(MACHINES)).size).toBe(MACHINES.length);
  });
  it('every registered sub-machine, and the clock, has its change tag spans:<id>', () => {
    for (const m of [...MACHINES, STEP0_CLOCK]) expect(CHANGE_TAGS as readonly string[]).toContain(`spans:${m.id}`);
  });
});

describe('span declarations in domain (C15)', () => {
  const all = [...MACHINES, ...TEST_MACHINES];
  const domainSituations = join(import.meta.dirname, '..', '..', '..', 'domain', 'src', 'situations');

  it('every registered sub-machine has a span declaration in domain with its id', () => {
    for (const m of MACHINES) {
      const declared = SPAN_DECLARATIONS.filter((d) => d.machine === m.id);
      expect(declared, m.id).toHaveLength(1);
      // the machine carries domain's declaration itself, not a copy of it
      expect(m.spans, m.id).toBe(declared[0]);
    }
    for (const m of all) expect(m.spans.machine, m.id).toBe(m.id);
  });
  it('every span declaration in domain belongs to a registered sub-machine or the clock', () => {
    const owners = [...ids(MACHINES), STEP0_CLOCK.id];
    for (const d of SPAN_DECLARATIONS) expect(owners, d.machine).toContain(d.machine);
    expect(new Set(SPAN_DECLARATIONS.map((d) => d.machine)).size).toBe(SPAN_DECLARATIONS.length);
  });
  it('the clock carries its span declaration in domain', () => {
    expect(STEP0_CLOCK.spans).toBe(SPAN_DECLARATIONS.find((d) => d.machine === STEP0_CLOCK.id));
  });
  it('every span declaration is the file situations/<machine>.ts of domain, with one scope and its kinds', () => {
    for (const d of SPAN_DECLARATIONS) {
      expect(existsSync(join(domainSituations, `${d.machine}.ts`)), d.machine).toBe(true);
      expect(['session', 'car', 'zone'], d.machine).toContain(d.scope);
      expect(d.kinds.length, d.machine).toBeGreaterThan(0);
      expect(new Set(d.kinds).size, d.machine).toBe(d.kinds.length);
    }
  });
  it("every kind in a sub-machine's transitions (except `none`) is a kind of its declaration", () => {
    for (const m of all) {
      for (const [from, to] of m.transitions) {
        if (from !== 'none') expect(m.spans.kinds, `${m.id}: ${from} -> ${to}`).toContain(from);
        expect(m.spans.kinds, `${m.id}: ${from} -> ${to}`).toContain(to);
      }
    }
  });
});
