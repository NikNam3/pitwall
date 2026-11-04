// The counted-work proofs of contract C31 on the long race (`test-support/builders/long-race.ts`), for a unit split into a
// fold and a quick reader (ruling Task 22 round 2): the fold `<unit>-history` proves its accumulator (C31.1 both ways,
// C31.2, and C31.3 across random rewinds with void facts); the quick `<unit>` proves it needs none (its from-scratch work
// does not grow fivefold, C31.1). Work is the projection entries a unit reads per frame (`countReads`), averaged over the frames of a
// lap; no timer anywhere.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CalculatorRegistry, type Calculator, type CalculatorId, type EngineView, type IncrementalCalculator } from '@pitwall/engine/readers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbRace, raceFrames } from '../../engine/test/support/arb-race.ts';
import { countReads, expectScheduledIncremental, guardedView } from '../../engine/test/support/scheduler.ts';
import { longRace } from '../../../test-support/builders/long-race.ts';
import { CALCULATORS } from './units.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The laps C31.1 compares. */
export const EARLY_LAP = 7;
export const LATE_LAP = 70;

/** The `.ts` files of a folder and its subfolders, tests excluded; none of a folder that is not there. */
const modulesOf = (dir: string): string[] =>
  !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modulesOf(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });

/** The calculators and analyses the package registers (`CALCULATORS`) that a module of `src/<folder>/` exports. */
export async function calculatorsOf(folder: string): Promise<Calculator[]> {
  const exported = new Set<unknown>();
  for (const path of modulesOf(join(SRC, folder))) {
    for (const value of Object.values((await import(pathToFileURL(path).href)) as Record<string, unknown>)) exported.add(value);
  }
  return CALCULATORS.filter((calc) => exported.has(calc));
}

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
      outputs.set(unit.id, unit.output(acc));
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

/** The projection entries `calc`'s from-scratch computation reads per frame, averaged over the frames of `lap` (C31.1). */
export function fromScratchReads(calc: Calculator, lap: number): number {
  return mean([...viewsFor(calc, longRace().framesOfLap(lap))].map((view) => countReads(calc, view)));
}

/**
 * The projection entries `calc`'s fold reads per frame, averaged over the frames of `lap` (C31.1): initialised on the
 * frame before the lap, it folds each frame's delta.
 */
export function incrementalReads<A, O>(calc: IncrementalCalculator<A, O>, lap: number): number {
  const [before, ...views] = [...viewsFor(calc as Calculator, withFrameBefore(lap))];
  let acc = calc.init(guardedView(before!, calc.reads, { unit: calc.id }));
  return mean(
    views.map((view) =>
      countReads(calc as Calculator, view, (v) => {
        acc = calc.update(acc, v.delta, v);
      }),
    ),
  );
}

/** What C31.2 allows an accumulator to come from besides the projection: the config. */
const NOT_IN_A_FOLD = ['live', 'situation', 'outputs', 'feed'] as const;

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
 * live state, the situation, the outputs and the feed throw on any read (C31.2).
 */
export const projectionOnly = (calc: Calculator, view: EngineView): EngineView => {
  const guarded = guardedView(view, calc.reads, { unit: calc.id });
  const parts = Object.fromEntries(NOT_IN_A_FOLD.map((part) => [part, forbidden(calc.id, part)]));
  return { ...guarded, ...parts } as EngineView;
};

/** The laps the C31.2 run folds: through the safety car and the stops around it. */
const FOLD_LAPS = [29, 30, 31, 32, 33, 34];

/**
 * `calc`'s accumulator after it folded the long race's frames of `FOLD_LAPS` (initialised on the frame before, every
 * view whole), and `init` over the last frame's projection and config alone (`projectionOnly`).
 */
export function foldedAndFromProjection<A, O>(calc: IncrementalCalculator<A, O>): { folded: A; fromProjection: A } {
  const frames = FOLD_LAPS.flatMap((lap) => longRace().framesOfLap(lap));
  const [before, ...views] = [...viewsFor(calc as Calculator, [frames[0]! - 1, ...frames])];
  const guard = (view: EngineView) => guardedView(view, calc.reads, { unit: calc.id });
  let acc = calc.init(guard(before!));
  for (const view of views) acc = calc.update(acc, view.delta, guard(view));
  return { folded: acc, fromProjection: calc.init(projectionOnly(calc as Calculator, views.at(-1)!)) };
}

/** Runs of the C31.3 property per fold: every run is a race of 300 frames through the runner and the scheduler. */
const REWIND_RUNS = 8;

/** The generated races with a rewind (perhaps two back to back): each appends a void fact (C27). */
const WITH_REWINDS = arbRace.filter((p) => p.flashback !== undefined);

/** The registered calculator `id` (`CALCULATORS`), or a failure that names what is missing. */
const unitOf = (id: CalculatorId): Calculator => {
  const calc = CALCULATORS.find((c) => c.id === id);
  if (calc === undefined) throw new Error(`no registered calculator ${id}: the package's index exports none (C63)`);
  return calc;
};

/** The registered calculator `id`, which must be incremental. */
const foldOf = (id: CalculatorId): IncrementalCalculator<unknown, unknown> => {
  const calc = unitOf(id);
  if (calc.kind !== 'incremental') throw new Error(`${id} is ${calc.kind}, not incremental`);
  return calc;
};

/**
 * The C31 proofs of the fold `id` (`<unit>-history`, ruling Task 22 round 2), the incremental calculator of its own folder
 * `src/<id>/` (C80): its from-scratch reads per frame grow at least fivefold from lap 7 to lap 70 while its fold's at
 * most double (C31.1); it reads no other unit's output and its accumulator after a run equals `init` over the projection
 * and the config alone (C31.2); it equals `init` at every step of random races with rewinds, which append void facts
 * (C31.3).
 */
export function describeFold(id: CalculatorId): void {
  describe(`${id}: an incremental fold over the projection justifies its accumulator by counted work on the long race (C31)`, () => {
    it(`is a registered incremental calculator of its own folder src/${id}/ that reads no other unit's output (C31.2, C80)`, async () => {
      const fold = foldOf(id);
      expect((await calculatorsOf(id)).map((c) => c.id)).toContain(id);
      expect(fold.reads.filter((r) => typeof r === 'object')).toEqual([]);
    });

    it(`its from-scratch reads per frame at lap ${LATE_LAP} are at least five times those at lap ${EARLY_LAP} (C31.1)`, () => {
      const fold = foldOf(id) as Calculator;
      const early = fromScratchReads(fold, EARLY_LAP);
      const late = fromScratchReads(fold, LATE_LAP);
      expect(late, `from scratch: ${early} entries a frame at lap ${EARLY_LAP}`).toBeGreaterThan(early);
      expect(late, `from scratch: ${early} entries a frame at lap ${EARLY_LAP}`).toBeGreaterThanOrEqual(5 * early);
    });

    it(`its incremental reads per frame at lap ${LATE_LAP} are at most twice those at lap ${EARLY_LAP} (C31.1)`, () => {
      const fold = foldOf(id);
      const early = incrementalReads(fold, EARLY_LAP);
      const late = incrementalReads(fold, LATE_LAP);
      expect(late, `incremental: ${early} entries a frame at lap ${EARLY_LAP}`).toBeLessThanOrEqual(2 * early);
    });

    it('its accumulator after a run equals init over the projection and the config alone, no live state, situation, output or feed (C31.2)', () => {
      const { folded, fromProjection } = foldedAndFromProjection(foldOf(id));
      expect(folded).toEqual(fromProjection);
    });

    it('incremental equals from scratch at every step of random races with rewinds, each a void fact (C31.3)', () => {
      const fold = foldOf(id);
      fc.assert(
        fc.property(WITH_REWINDS, (p) => {
          expectScheduledIncremental(fold, raceFrames({ ...p, frames: 300 }).frames);
        }),
        { numRuns: REWIND_RUNS },
      );
    });
  });
}

/**
 * The C31.1 proof of the quick unit `id` (ruling Task 22 round 2): it reads its fold `<id>-history` through
 * `view.outputs`, and the projection entries it reads itself per frame do not grow fivefold from lap 7 to lap 70: it needs
 * no accumulator.
 */
export function describeQuick(id: CalculatorId): void {
  describe(`${id}: a quick reader of its fold ${id}-history justifies its kind by counted work on the long race (C31)`, () => {
    it(`is a quick calculator that reads ${id}-history (C31.2)`, () => {
      const calc = unitOf(id);
      expect(calc.kind).toBe('quick');
      expect(calc.reads).toContainEqual({ calculator: `${id}-history` });
    });

    it(`quick: its from-scratch reads per frame do not grow fivefold from lap ${EARLY_LAP} to lap ${LATE_LAP} (C31.1)`, () => {
      const calc = unitOf(id);
      if (calc.kind !== 'quick') throw new Error(`${id} is ${calc.kind}, not quick`);
      const early = fromScratchReads(calc, EARLY_LAP);
      const late = fromScratchReads(calc, LATE_LAP);
      expect(late > early && late >= 5 * early, `from scratch: ${early} entries a frame at lap ${EARLY_LAP}, ${late} at lap ${LATE_LAP}`).toBe(false);
    });
  });
}
