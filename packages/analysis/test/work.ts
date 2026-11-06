// The counted-work proofs of contract C31 for an incremental unit, on the long race (`test-support/builders/long-race.ts`;
// ruling Task 22 round 3): its accumulator is a fold over projection entries and config, and `output(acc, view)`
// combines it with the view's live state and open spans. The unit proves C31.1 both ways and C31.2 here; C31.3 is in
// `incremental-rewind.property.test.ts`. Work is the projection entries a unit reads per frame (`countReads`), averaged over the frames
// of a lap; no timer anywhere.
import { CalculatorRegistry, type Calculator, type CalculatorId, type EngineView, type IncrementalCalculator } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { countReads, guardedView } from '../../engine/test/support/scheduler.ts';
import { engineView, IDLE_FEED } from '../../../test-support/builders/index.ts';
import { longRace } from '../../../test-support/builders/long-race.ts';
import { CALCULATORS } from './units.ts';

/**
 * The counts of C31.1 run on views whose projection lists count, without the guard (ruling Task 22 round 8): C41 is the
 * guarded-view completeness test's and the units' own tests'; the counts are as exact.
 */
const UNGUARDED = { guarded: false } as const;

/** The laps C31.1 compares. */
export const EARLY_LAP = 7;
export const LATE_LAP = 70;

const ORDER = CalculatorRegistry.build(CALCULATORS).order;

/** The units `calc` reads the outputs of, and theirs, in the registry's order. */
const upstreamOf = (calc: Calculator): Calculator[] => {
  const needed = new Set<CalculatorId>();
  const visit = (c: Calculator): void => {
    for (const dep of c.reads) {
      if (typeof dep !== 'object' || needed.has(dep.calculator)) continue;
      needed.add(dep.calculator);
      const upstream = ORDER.find((u) => u.id === dep.calculator);
      if (upstream !== undefined) visit(upstream);
    }
  };
  visit(calc);
  return ORDER.filter((u) => needed.has(u.id));
};

/**
 * The long race's views of `frames` (in order, each with its delta from the frame before) as `calc` sees them: with the
 * outputs of the units it reads, each run on every frame, an incremental one initialised on the first and folding
 * every frame after it.
 */
function* viewsFor(calc: Calculator, frames: readonly number[]): Generator<EngineView> {
  const race = longRace();
  const upstream = upstreamOf(calc);
  const accs = new Map<CalculatorId, unknown>();
  for (const frame of frames) {
    const outputs = new Map<CalculatorId, unknown>();
    for (const unit of upstream) {
      const view = race.viewAt(frame, { outputs });
      if (unit.kind === 'quick') {
        outputs.set(unit.id, unit.compute(view));
        continue;
      }
      const acc = accs.has(unit.id) ? unit.update(accs.get(unit.id), view.delta, view) : unit.init(view);
      accs.set(unit.id, acc);
      outputs.set(unit.id, unit.output(acc, view));
    }
    yield race.viewAt(frame, { outputs });
  }
}

const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/** The frames of `lap`, with the frame before them first: where an incremental unit starts. */
const withFrameBefore = (lap: number): number[] => {
  const frames = longRace().framesOfLap(lap);
  return [frames[0]! - 1, ...frames];
};

/**
 * The projection entries `calc` reads per frame computing from scratch, averaged over the frames of `lap` (C31.1): its
 * `init` on the frame's view and its `output` of that accumulator on the same view.
 */
export function fromScratchReads<A, O>(calc: IncrementalCalculator<A, O>, lap: number): number {
  return mean(
    [...viewsFor(calc as Calculator, longRace().framesOfLap(lap))].map((view) =>
      countReads(calc as Calculator, view, (v) => calc.output(calc.init(v), v), UNGUARDED),
    ),
  );
}

/**
 * The projection entries `calc` reads per frame incrementally, averaged over the frames of `lap` (C31.1): initialised on
 * the frame before the lap, it folds each frame's delta (`update`) and gives its `output` on the frame's view.
 */
export function incrementalReads<A, O>(calc: IncrementalCalculator<A, O>, lap: number): number {
  const [before, ...views] = [...viewsFor(calc as Calculator, withFrameBefore(lap))];
  let acc = calc.init(guardedView(before!, calc.reads, { unit: calc.id }));
  return mean(
    views.map((view) =>
      countReads(
        calc as Calculator,
        view,
        (v) => {
          acc = calc.update(acc, v.delta, v);
          return calc.output(acc, v);
        },
        UNGUARDED,
      ),
    ),
  );
}

/** An empty live state and situation: those of a race session with no car on track, no span open and the weekend phase pending. */
const EMPTY = ((): Pick<EngineView, 'live' | 'situation'> => {
  const { live } = engineView();
  return { live, situation: { weekendPhase: { kind: 'pending' }, byMachine: {} } };
})();

/**
 * `view` with its projection, config, delta and change tags alone (C31.2): its live state and situation replaced by
 * empty values (`EMPTY`), no outputs, an idle feed; through `calc`'s guarded view (C41).
 */
export const projectionOnly = (calc: Calculator, view: EngineView): EngineView =>
  guardedView({ ...view, ...EMPTY, outputs: new Map(), feed: IDLE_FEED }, calc.reads, { unit: calc.id });

/** A read of a part of the view that no accumulator may come from (C31.2). */
export class NotAFoldError extends Error {
  constructor(unit: CalculatorId, path: string) {
    super(`${unit} reads ${path} in init: an accumulator is a fold over projection entries and config, holding nothing else (C31.2)`);
    this.name = 'NotAFoldError';
  }
}

/** A stand-in for a part of the view that throws on any read. */
const forbidden = (unit: CalculatorId, path: string): object => {
  const fail = (key?: string | symbol): never => {
    throw new NotAFoldError(unit, key === undefined ? path : `${path}.${String(key)}`);
  };
  return new Proxy({}, { get: (_, key) => fail(key), has: (_, key) => fail(key), ownKeys: () => fail() });
};

/**
 * `view` through `calc`'s guarded view (C41) with the projection, the config, the delta and the change tags alone: the
 * live state, the situation, the outputs and the feed throw on any read (C31.2). An empty value can hide a read whose
 * result is the same for it (a pending weekend phase reads as the race's grid, C14); a throw cannot. A proxy, not a
 * spread: a spread would read every key of the guarded view, so only the unit's own reads reach the guard.
 */
export const readsOnlyTheProjection = (calc: Calculator, view: EngineView): EngineView => {
  const guarded = guardedView(view, calc.reads, { unit: calc.id });
  const parts = new Map<string | symbol, object>((['live', 'situation', 'outputs', 'feed'] as const).map((part) => [part, forbidden(calc.id, part)]));
  return new Proxy({} as EngineView, {
    get: (_, key) => parts.get(key) ?? Reflect.get(guarded, key),
    has: (_, key) => parts.has(key) || Reflect.has(guarded, key),
  });
};

/** The laps the C31.2 run folds: through the safety car and the stops around it. */
const FOLD_LAPS = [29, 30, 31, 32, 33, 34];

/**
 * `calc`'s accumulator after it folded the long race's frames of `FOLD_LAPS` (initialised on the frame before, every
 * view whole, each output taken as the scheduler does; no guard), and `init` over the last frame's projection alone
 * (`projectionOnly`).
 */
export function foldedAndFromProjection<A, O>(calc: IncrementalCalculator<A, O>): { folded: A; fromProjection: A } {
  const frames = FOLD_LAPS.flatMap((lap) => longRace().framesOfLap(lap));
  const [before, ...views] = [...viewsFor(calc as Calculator, [frames[0]! - 1, ...frames])];
  // unguarded (ruling Task 22 round 8): C41 is the guarded-view completeness test's and the units' own tests'
  let acc = calc.init(before!);
  for (const view of views) {
    acc = calc.update(acc, view.delta, view);
    calc.output(acc, view);
  }
  return { folded: acc, fromProjection: calc.init(projectionOnly(calc as Calculator, views.at(-1)!)) };
}

/** The registered calculator `id`, which must be incremental. */
export const incrementalOf = (id: CalculatorId): IncrementalCalculator<unknown, unknown> => {
  const calc = CALCULATORS.find((c) => c.id === id);
  if (calc === undefined) throw new Error(`no registered calculator ${id}`);
  if (calc.kind !== 'incremental') throw new Error(`${id} is ${calc.kind}, not incremental`);
  return calc;
};

/**
 * The C31 proofs of the incremental unit `id` (C31, C41): its from-scratch reads per frame grow at least fivefold from
 * lap 7 to lap 70 while its incremental reads at most double (C31.1); its accumulator after a run equals `init` over the
 * projection alone, the live state and situation replaced by empty values (C31.2). Its C31.3 property is in
 * `incremental-rewind.property.test.ts`, over races shared by every incremental unit.
 */
export function describeWork(id: CalculatorId): void {
  describe(`${id}: an incremental unit justifies its accumulator by counted work on the long race (C31)`, () => {
    it('is a registered incremental calculator', () => {
      expect(incrementalOf(id).kind).toBe('incremental');
    });

    it(`its from-scratch reads per frame at lap ${LATE_LAP} are at least five times those at lap ${EARLY_LAP} (C31.1)`, () => {
      const calc = incrementalOf(id);
      const early = fromScratchReads(calc, EARLY_LAP);
      const late = fromScratchReads(calc, LATE_LAP);
      expect(late, `from scratch: ${early} entries a frame at lap ${EARLY_LAP}`).toBeGreaterThan(early);
      expect(late, `from scratch: ${early} entries a frame at lap ${EARLY_LAP}`).toBeGreaterThanOrEqual(5 * early);
    });

    it(`its incremental reads per frame at lap ${LATE_LAP} are at most twice those at lap ${EARLY_LAP} (C31.1)`, () => {
      const calc = incrementalOf(id);
      const early = incrementalReads(calc, EARLY_LAP);
      const late = incrementalReads(calc, LATE_LAP);
      expect(late, `incremental: ${early} entries a frame at lap ${EARLY_LAP}`).toBeLessThanOrEqual(2 * early);
    });

    it('its accumulator after a run equals init over the projection alone, the live state and situation empty (C31.2)', () => {
      const { folded, fromProjection } = foldedAndFromProjection(incrementalOf(id));
      expect(folded).toEqual(fromProjection);
    });

    // Added in Task 22 round 3 beside the ruled check above, which an empty value can pass by chance (see the report).
    it('its init reads no live state, situation, output or feed: they throw (C31.2)', () => {
      const calc = incrementalOf(id);
      const last = longRace().framesOfLap(34).at(-1)!;
      expect(() => calc.init(readsOnlyTheProjection(calc as Calculator, longRace().viewAt(last)))).not.toThrow();
    });
  });
}
