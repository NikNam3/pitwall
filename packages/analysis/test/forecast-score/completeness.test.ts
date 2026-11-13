// `forecast-score`'s job under the completeness rules (SP4.3b Task 20c; C41, C44, C51): its behaviour table covers every
// kind of every sub-machine the job reads, and its `prepare` reads only what the job declares, the projection's append
// frames (`history.appendedAt`) included.
import { SPAN_DECLARATIONS } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { UndeclaredReadError } from '../../../engine/test/support/guarded-input.ts';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import * as forecastScore from '../../src/forecast-score/index.ts';
import { FORECAST_SCORE_JOB } from '../../src/forecast-score/index.ts';
import { prepareScore } from '../../src/forecast-score/job.ts';
import type { BehaviourTable } from '../../src/shared/behaviour.ts';
import { generated, viewOf } from './support.ts';

/** The sub-machines the job declares in `reads` (`spans:<machine>`). */
const machinesRead = (): string[] =>
  FORECAST_SCORE_JOB.reads.flatMap((read) => (typeof read === 'string' && read.startsWith('spans:') ? [read.slice('spans:'.length)] : []));

describe('forecast-score job: completeness (C41, C44)', () => {
  it("the job's behaviour table covers every kind of every sub-machine it reads (C44)", () => {
    const table = (forecastScore as Record<string, unknown>)['FORECAST_SCORE_BEHAVIOUR'] as BehaviourTable<unknown> | undefined;
    expect(table, 'forecast-score/index.ts exports FORECAST_SCORE_BEHAVIOUR').toBeDefined();
    const read = machinesRead();
    expect(read).toEqual(expect.arrayContaining(['car-driver', 'session-phase-race', 'weekend-phase']));
    expect(Object.keys(table ?? {}).sort()).toEqual([...read].sort());
    for (const machine of read) {
      const kinds = SPAN_DECLARATIONS.find((d) => d.machine === machine)?.kinds ?? [];
      expect(Object.keys(table?.[machine] ?? {}).sort(), `rows of ${machine}`).toEqual([...kinds].sort());
    }
  });

  it('prepare reads only what the job declares (C41), and gives through its guarded view what it gives unguarded', () => {
    const view = viewOf(generated());
    expect(Object.keys(view.history.appendedAt ?? {}).length, 'the race carries append frames').toBeGreaterThan(0);
    let prepared: unknown;
    try {
      prepared = prepareScore(guardedView(view, FORECAST_SCORE_JOB.reads, { unit: FORECAST_SCORE_JOB.id }));
    } catch (error) {
      if (error instanceof UndeclaredReadError) expect.fail(`undeclared read: ${error.path}`);
      throw error;
    }
    expect(prepared).toEqual(prepareScore(view));
  });
});
