// Every calculator a bridge feature registers reads only what it declares (contract C41, C87): one generic test over
// the feature registry (`FEATURES`), the bridge's own units (session.info, feed.status) and the analyses
// it wires alike. Each runs on the standard builder race (`packages/analysis/test/standard-race.ts`: a stop and a safety
// car) through its guarded view (`guardedView`): a quick unit computes on the view during the SC and on the one after
// the race, an incremental one inits on the first, folds the delta into the second, gives its output on each and inits
// on the second; both raise their insights. Upstream outputs come from the units before it in the registry's order,
// computed unguarded on the same view.
import { CalculatorRegistry, type Calculator, type CalculatorId, type EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { UndeclaredReadError } from '../../../../packages/engine/test/support/guarded-input.ts';
import { guardedView } from '../../../../packages/engine/test/support/scheduler.ts';
import { AFTER, DURING, grown, raceAt } from '../../../../packages/analysis/test/standard-race.ts';
import { FEATURES } from '../../src/features/index.generated.ts';

const ORDER = CalculatorRegistry.build(FEATURES.flatMap((f) => f.calculators)).order;

/** What a unit gives on a view, unguarded: its output, or its accumulator's. */
const outputOf = (calc: Calculator, view: EngineView): unknown => (calc.kind === 'quick' ? calc.compute(view) : calc.output(calc.init(view), view));

/**
 * The race's view at `at` with every unit's output, unguarded, in the registry's order: the upstream outputs a unit
 * reads. A unit that throws here has no output; its own test below reports why.
 */
function viewWithOutputs(at: number): EngineView {
  const outputs = new Map<CalculatorId, unknown>();
  for (const calc of ORDER) {
    try {
      outputs.set(calc.id, outputOf(calc, raceAt(at, outputs)));
    } catch {
      // Reported by the unit's own test.
    }
  }
  return raceAt(at, outputs);
}

const during = viewWithOutputs(DURING);
const after = grown(during, viewWithOutputs(AFTER));

/**
 * The undeclared reads of `calc` on the standard race, one per step that hit one (each stops at its first): every step
 * through the unit's guarded view. Any other error is a failure of the test, not a read.
 */
function undeclaredReads(calc: Calculator): string[] {
  const g = (view: EngineView) => guardedView(view, calc.reads, { unit: calc.id });
  const reads: string[] = [];
  const attempt = <T>(step: string, run: () => T): T | undefined => {
    try {
      return run();
    } catch (error) {
      if (!(error instanceof UndeclaredReadError)) throw error;
      reads.push(`${step}: ${error.path}`);
      return undefined;
    }
  };
  const insights = (step: string, out: unknown, prev: unknown, view: EngineView) => {
    if (calc.insights !== undefined && out !== undefined) attempt(step, () => calc.insights?.(out, prev, g(view)));
  };
  if (calc.kind === 'quick') {
    const first = attempt('compute (during the SC)', () => calc.compute(g(during)));
    insights('insights (during the SC)', first, undefined, during);
    const second = attempt('compute (after the race)', () => calc.compute(g(after)));
    insights('insights (after the race)', second, first, after);
    return reads;
  }
  const acc = attempt('init (during the SC)', () => calc.init(g(during)));
  const folded = acc === undefined ? undefined : attempt('update (to after the race)', () => calc.update(acc, after.delta, g(after)));
  const first = acc === undefined ? undefined : attempt('output (during the SC)', () => calc.output(acc, g(during)));
  insights('insights (during the SC)', first, undefined, during);
  insights('insights (after the race)', folded === undefined ? undefined : attempt('output (after the race)', () => calc.output(folded, g(after))), first, after);
  attempt('init (after the race)', () => calc.init(g(after)));
  return reads;
}

describe("every calculator a bridge feature registers reads only what it declares (C41, C87)", () => {
  it('the feature registry registers the bridge units and the analyses it wires', () => {
    // M7-R2: cars.overview is a live binding (C55), so no calculator of that id is registered
    expect(ORDER.map((c) => c.id)).not.toContain('cars.overview');
    expect(ORDER.map((c) => c.id)).toEqual(expect.arrayContaining(['session.info', 'feed.status', 'gaps', 'incidents', 'race-moment']));
  });

  for (const calc of ORDER) {
    it(`${calc.id} ${calc.kind === 'quick' ? 'computes' : 'inits and folds'} on the standard race through its guarded view`, () => {
      expect(undeclaredReads(calc)).toEqual([]);
    });
  }
});
