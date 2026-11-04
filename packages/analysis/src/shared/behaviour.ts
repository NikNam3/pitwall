// Behaviour tables (contract C43, C44): a unit's map from every kind of each sub-machine it reads to what it computes.
// The machine decides the situation; a unit only looks up its row for the spans open now, so it decides nothing again.
import { scopeOf, type CarId, type MachineId, type OpenSpan } from '@pitwall/domain';
import { openSpansOf, type DeepReadonly, type EngineView } from '@pitwall/engine/readers';

/**
 * One row per kind of every sub-machine the unit reads (C44), by machine id and span kind. Resting kinds (`noFlag`,
 * `noWarning`, `clear`, `valid`, `running`, `notCompeting`, `unknown` ...) are kinds like any other and have their row.
 * A unit that needs a weekend phase has the row `weekend-phase` `none` (its `notApplicable`, C14). The generic test
 * `behaviour-completeness.test.ts` checks that a table covers exactly the kinds of the machines the unit declares.
 */
export type BehaviourTable<B> = { [machine: MachineId]: Record<string /* span kind */, B> };

/**
 * The rows of the spans open now (C20): for each machine of `table`, in the table's order, the row of each of its open
 * spans, read through `openSpansOf` (a read of `spans:<machine>`, C41). A session-scoped or zone-scoped machine gives the
 * rows of all its open spans; a car-scoped one only those of `carId`'s spans, and none without `carId`. A span whose kind
 * has no row, or a machine without a span declaration, is a bug in the table (C3): it throws.
 */
export function behaviourFor<B>(table: BehaviourTable<B>, view: EngineView, carId?: CarId): B[] {
  const rows: B[] = [];
  for (const [machine, byKind] of Object.entries(table)) {
    const scope = scopeOf(machine);
    if (scope === undefined) throw new Error(`behaviour table: ${machine} has no span declaration`);
    if (scope === 'car' && carId === undefined) continue;
    for (const span of openSpansOf(view, machine, scope === 'car' ? carId : undefined)) {
      if (!Object.hasOwn(byKind, span.kind)) throw new Error(`behaviour table: no row for ${machine} ${span.kind}`);
      rows.push(byKind[span.kind] as B);
    }
  }
  return rows;
}

/**
 * A machine's open spans (C20) grouped by car, read once (`openSpansOf`, a read of `spans:<machine>`, C41): for a unit
 * that looks up every car on one view, so it does not filter the open spans once per car.
 */
export function openSpansByCar(view: EngineView, machine: MachineId): ReadonlyMap<CarId, readonly DeepReadonly<OpenSpan>[]> {
  const byCar = new Map<CarId, DeepReadonly<OpenSpan>[]>();
  for (const span of openSpansOf(view, machine)) {
    if (span.carId === undefined) continue;
    const list = byCar.get(span.carId);
    if (list === undefined) byCar.set(span.carId, [span]);
    else list.push(span);
  }
  return byCar;
}

/**
 * `behaviourFor` for every car of one view: each machine's open spans are read once and grouped by car; the returned
 * function gives a car's rows as `behaviourFor(table, view, carId)` does, in the table's order. It throws as
 * `behaviourFor` does.
 */
export function behaviourByCar<B>(table: BehaviourTable<B>, view: EngineView): (carId: CarId) => B[] {
  const rowOf = (machine: MachineId, byKind: Record<string, B>, kind: string): B => {
    if (!Object.hasOwn(byKind, kind)) throw new Error(`behaviour table: no row for ${machine} ${kind}`);
    return byKind[kind] as B;
  };
  const parts: Array<B[] | ReadonlyMap<CarId, B[]>> = [];
  for (const [machine, byKind] of Object.entries(table)) {
    const scope = scopeOf(machine);
    if (scope === undefined) throw new Error(`behaviour table: ${machine} has no span declaration`);
    if (scope !== 'car') {
      parts.push(openSpansOf(view, machine).map((span) => rowOf(machine, byKind, span.kind)));
      continue;
    }
    const byCar = new Map<CarId, B[]>();
    for (const [carId, spans] of openSpansByCar(view, machine)) byCar.set(carId, spans.map((span) => rowOf(machine, byKind, span.kind)));
    parts.push(byCar);
  }
  return (carId) => {
    const rows: B[] = [];
    for (const part of parts) for (const row of part instanceof Map ? (part.get(carId) ?? []) : (part as B[])) rows.push(row);
    return rows;
  };
}
