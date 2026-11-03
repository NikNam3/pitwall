// The machine registry (contract C15, C63): the sub-machines the generated index collects, in the order their declared
// upstream inputs give. A cycle or an upstream that is not registered is an error, not an order; `pnpm gen` loads this
// module, so either fails generation.
import type { MachineId } from '@pitwall/domain';
import { MACHINES } from './index.generated.ts';
import type { SubMachine } from './machine.ts';

/** The sub-machines' declared upstream inputs form a cycle: no order runs each after its upstreams. */
export class MachineCycleError extends Error {
  readonly cycle: readonly MachineId[];

  constructor(cycle: readonly MachineId[]) {
    super(`sub-machine cycle: ${cycle.join(' -> ')}`);
    this.cycle = cycle;
  }
}

/** A sub-machine names an upstream that is not registered. */
export class UnknownMachineError extends Error {
  readonly machine: MachineId;
  readonly upstream: MachineId;

  constructor(machine: MachineId, upstream: MachineId) {
    super(`sub-machine ${machine} reads the unknown upstream ${upstream}`);
    this.machine = machine;
    this.upstream = upstream;
  }
}

/**
 * The sub-machines in step 2's order (C15): each after its declared upstreams, otherwise in the given order (a
 * depth-first topological sort). Throws `UnknownMachineError` on an upstream that is not among `machines` and
 * `MachineCycleError` on a cycle, a machine that names itself included.
 */
export function machineOrder(machines: ReadonlyArray<SubMachine<unknown>>): Array<SubMachine<unknown>> {
  const byId = new Map(machines.map((m) => [m.id, m]));
  for (const m of machines) {
    for (const up of m.inputs.upstream) if (!byId.has(up)) throw new UnknownMachineError(m.id, up);
  }
  const ordered: Array<SubMachine<unknown>> = [];
  const done = new Set<MachineId>();
  const path: MachineId[] = [];
  const visit = (m: SubMachine<unknown>): void => {
    if (done.has(m.id)) return;
    const at = path.indexOf(m.id);
    if (at >= 0) throw new MachineCycleError([...path.slice(at), m.id]);
    path.push(m.id);
    for (const up of m.inputs.upstream) visit(byId.get(up) as SubMachine<unknown>);
    path.pop();
    done.add(m.id);
    ordered.push(m);
  };
  for (const m of machines) visit(m);
  return ordered;
}

/** The registered sub-machines in step 2's order. */
export const MACHINE_ORDER: ReadonlyArray<SubMachine<unknown>> = machineOrder(MACHINES);
