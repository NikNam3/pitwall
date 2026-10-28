import type { Calculator, CalculatorId } from './types.ts';

export type RegistryErrorReason = 'duplicateId' | 'unknownDependency' | 'cycle';

type Dependencies = ReadonlyMap<CalculatorId, readonly CalculatorId[]>;

/** A startup error: the set of calculators is inconsistent (spec 7.3). `ids` names the calculators involved. */
export class RegistryError extends Error {
  readonly reason: RegistryErrorReason;
  readonly ids: readonly CalculatorId[];

  constructor(reason: RegistryErrorReason, ids: readonly CalculatorId[], message: string) {
    super(message);
    this.name = 'RegistryError';
    this.reason = reason;
    this.ids = ids;
  }
}

/** The calculators `calc` reads, in `reads` order, without repeats. Only `{ calculator }` reads are edges. */
const dependenciesOf = (calc: Calculator): CalculatorId[] => [
  ...new Set(calc.reads.flatMap((read) => (typeof read === 'object' ? [read.calculator] : []))),
];

/** The validated set of calculators, in an order where every calculator comes after the ones it reads. */
export class CalculatorRegistry {
  readonly order: readonly Calculator[];
  readonly #byId: ReadonlyMap<CalculatorId, Calculator>;
  readonly #dependents: ReadonlyMap<CalculatorId, readonly CalculatorId[]>;

  private constructor(order: readonly Calculator[], dependencies: Dependencies) {
    this.order = order;
    this.#byId = new Map(order.map((calc) => [calc.id, calc]));
    this.#dependents = new Map(
      order.map((calc) => [
        calc.id,
        order.filter((other) => dependencies.get(other.id)?.includes(calc.id)).map((other) => other.id),
      ]),
    );
  }

  /** Checks, in this order: duplicate ids, unknown calculator dependencies, cycles. Throws `RegistryError`. */
  static build(calcs: readonly Calculator[]): CalculatorRegistry {
    const ids = new Set<CalculatorId>();
    for (const { id } of calcs) {
      if (ids.has(id)) throw new RegistryError('duplicateId', [id], `duplicate calculator id "${id}"`);
      ids.add(id);
    }
    const dependencies: Dependencies = new Map(calcs.map((calc) => [calc.id, dependenciesOf(calc)]));
    for (const calc of calcs) {
      for (const dep of dependencies.get(calc.id) ?? []) {
        if (ids.has(dep)) continue;
        throw new RegistryError(
          'unknownDependency',
          [calc.id, dep],
          `calculator "${calc.id}" depends on unknown calculator "${dep}"`,
        );
      }
    }
    return new CalculatorRegistry(sortByDependencies(calcs, dependencies), dependencies);
  }

  get(id: CalculatorId): Calculator | undefined {
    return this.#byId.get(id);
  }

  /** The calculators that read `id` directly, in `order`. */
  dependentsOf(id: CalculatorId): readonly CalculatorId[] {
    return this.#dependents.get(id) ?? [];
  }
}

/** Kahn's algorithm; among the calculators ready at each step, the first in input order goes next. */
const sortByDependencies = (calcs: readonly Calculator[], dependencies: Dependencies): Calculator[] => {
  const placed = new Set<CalculatorId>();
  const order: Calculator[] = [];
  let remaining = [...calcs];
  while (remaining.length > 0) {
    const next = remaining.find((calc) => (dependencies.get(calc.id) ?? []).every((dep) => placed.has(dep)));
    if (next === undefined) throw cycleError(remaining, dependencies);
    placed.add(next.id);
    order.push(next);
    remaining = remaining.filter((calc) => calc !== next);
  }
  return order;
};

/** `remaining` holds the cycles and whatever depends on them; report the first cycle in input order. */
const cycleError = (remaining: readonly Calculator[], dependencies: Dependencies): RegistryError => {
  const candidates = new Set(remaining.map((calc) => calc.id));
  for (const { id } of remaining) {
    const cycle = cycleThrough(id, dependencies, candidates);
    if (cycle !== undefined) return new RegistryError('cycle', cycle, `dependency cycle: ${[...cycle, id].join(' -> ')}`);
  }
  throw new Error('calculators cannot be ordered but no cycle was found');
};

/** The path `start -> … -> start` along dependencies within `candidates`, without the closing `start`. */
const cycleThrough = (
  start: CalculatorId,
  dependencies: Dependencies,
  candidates: ReadonlySet<CalculatorId>,
): CalculatorId[] | undefined => {
  const visited = new Set<CalculatorId>();
  const walk = (id: CalculatorId, path: CalculatorId[]): CalculatorId[] | undefined => {
    for (const dep of dependencies.get(id) ?? []) {
      if (dep === start) return path;
      if (!candidates.has(dep) || visited.has(dep)) continue;
      visited.add(dep);
      const found = walk(dep, [...path, dep]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(start, [start]);
};
