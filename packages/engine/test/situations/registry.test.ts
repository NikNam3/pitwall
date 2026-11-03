// The machine registry (contract C15, C40, C63): sub-machines are collected by a generated index (`MACHINES`), each
// declares one scope, and step 2 runs them in the order their declared upstream inputs give; a cycle or an upstream
// that is not registered is an error, not an order.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGE_TAGS } from '../../src/index.ts';
import { MACHINES } from '../../src/situations/index.generated.ts';
import type { SubMachine } from '../../src/situations/machine.ts';
import { MachineCycleError, machineOrder, UnknownMachineError } from '../../src/situations/registry.ts';
import { TEST_MACHINES } from '../support/test-machines.ts';

/** A sub-machine that only declares its id and upstream inputs. */
const stub = (id: string, upstream: string[] = []): SubMachine<unknown> => ({
  id,
  appliesTo: 'all',
  scope: 'session',
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
    for (const m of all) expect(['session', 'car', 'zone'], m.id).toContain(m.scope);
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
  it('every registered sub-machine has its change tag spans:<id>', () => {
    for (const m of MACHINES) expect(CHANGE_TAGS as readonly string[]).toContain(`spans:${m.id}`);
  });
});
