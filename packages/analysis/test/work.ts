// The counted-work proofs of contract C31 for the calculators of one unit folder, on the long race
// (`test-support/builders/long-race.ts`): an incremental calculator proves its accumulator (C31.1 both ways, C31.2, and
// C31.3 across random rewinds with void facts); a quick one proves it needs none (its from-scratch work does not grow
// fivefold, C31.1). Work is the projection entries a unit reads per frame (`countReads`), averaged over the frames of a
// lap; no timer anywhere.
import { readdirSync } from 'node:fs';
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

/** The `.ts` files of a folder and its subfolders, tests excluded. */
const modulesOf = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
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

/** Runs of the C31.3 property per unit: every run is a race of 60 to 300 frames through the runner and the scheduler. */
const REWIND_RUNS = 5;

/** The generated races with a rewind (perhaps two back to back): each appends a void fact (C27). */
const WITH_REWINDS = arbRace.filter((p) => p.flashback !== undefined);

/**
 * The C31 proofs of every calculator `src/<folder>/` defines (C31, C41, C87). An incremental one: its from-scratch reads
 * per frame grow at least fivefold from lap 7 to lap 70 while its fold's at most double (C31.1); its accumulator after a
 * run equals `init` over the projection and the config alone (C31.2); it equals `init` at every step of random races
 * with rewinds, which append void facts (C31.3). A quick one: its from-scratch reads do not grow fivefold, so it needs
 * no accumulator (C31.1).
 */
export async function describeWork(folder: string): Promise<void> {
  const calcs = await calculatorsOf(folder);
  describe(`${folder}: every calculator justifies its kind by counted work on the long race (C31)`, () => {
    it(`src/${folder}/ defines a registered calculator`, () => {
      expect(calcs.map((c) => c.id)).not.toEqual([]);
    });

    for (const calc of calcs) {
      if (calc.kind === 'quick') {
        it(`${calc.id} is quick: its from-scratch reads per frame do not grow fivefold from lap ${EARLY_LAP} to lap ${LATE_LAP} (C31.1)`, () => {
          const early = fromScratchReads(calc, EARLY_LAP);
          const late = fromScratchReads(calc, LATE_LAP);
          expect(late > early && late >= 5 * early, `from scratch: ${early} entries a frame at lap ${EARLY_LAP}, ${late} at lap ${LATE_LAP}`).toBe(false);
        });
        continue;
      }

      it(`${calc.id}: its from-scratch reads per frame at lap ${LATE_LAP} are at least five times those at lap ${EARLY_LAP} (C31.1)`, () => {
        const early = fromScratchReads(calc, EARLY_LAP);
        const late = fromScratchReads(calc, LATE_LAP);
        expect(late, `from scratch: ${early} entries a frame at lap ${EARLY_LAP}`).toBeGreaterThan(early);
        expect(late, `from scratch: ${early} entries a frame at lap ${EARLY_LAP}`).toBeGreaterThanOrEqual(5 * early);
      });

      it(`${calc.id}: its incremental reads per frame at lap ${LATE_LAP} are at most twice those at lap ${EARLY_LAP} (C31.1)`, () => {
        const early = incrementalReads(calc, EARLY_LAP);
        const late = incrementalReads(calc, LATE_LAP);
        expect(late, `incremental: ${early} entries a frame at lap ${EARLY_LAP}`).toBeLessThanOrEqual(2 * early);
      });

      it(`${calc.id}: its accumulator after a run equals init over the projection and the config alone, no live state, situation, output or feed (C31.2)`, () => {
        const { folded, fromProjection } = foldedAndFromProjection(calc);
        expect(folded).toEqual(fromProjection);
      });

      it(`${calc.id}: incremental equals from scratch at every step of random races with rewinds, each a void fact (C31.3)`, () => {
        fc.assert(
          fc.property(WITH_REWINDS, (p) => {
            expectScheduledIncremental(calc, raceFrames(p).frames);
          }),
          { numRuns: REWIND_RUNS },
        );
      });
    }
  });
}
