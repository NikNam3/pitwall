// `bindJob` with a select (SP4.3b2 Task 1, C55): the select maps the job's output to the `V` of the topic's
// `Computed<V>` (or `undefined` for no data); the publisher wraps it in `computedFor`. Checked twice, like
// typed-job-bindings.test.ts: `pnpm typecheck` compiles this file, so the `@ts-expect-error` lines are the compiler
// tests; vitest runs the same calls.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Computed } from '@pitwall/contracts';
import type { CarId, ForecastScoreReport } from '@pitwall/domain';
import type { Job } from '@pitwall/engine';
import { bindJob, selectCar, type TopicBinding } from '../../src/features/feature.ts';

const workerModule = new URL('./fixtures/none.ts', import.meta.url);
const job = <Out>(id: string): Job<number, Out> => ({ kind: 'job', id, reads: ['timing'], trigger: 'lapCompleted', prepare: () => 1, module: workerModule });
type PerCar = Record<CarId, ForecastScoreReport>;

describe('bindJob with a select: the select returns the topic\'s Computed value', () => {
  it('bindJob compiles only when the select\'s return type matches the topic\'s Computed value', () => {
    // A per-car output with selectCar: the entry is the V of Computed<V>.
    const perCar = bindJob('forecastScore.report', job<PerCar>('a'), selectCar);
    expectTypeOf(perCar).toEqualTypeOf<TopicBinding>();
    // A hand-written select, `undefined` for no data.
    const own = bindJob('forecastScore.report', job<{ report?: ForecastScoreReport }>('b'), (out) => out.report);
    expectTypeOf(own).toEqualTypeOf<TopicBinding>();
    // The select's output parameter is the job's output.
    bindJob('forecastScore.report', job<PerCar>('c'), (out, params) => {
      expectTypeOf(out).toEqualTypeOf<PerCar>();
      expectTypeOf(params).toEqualTypeOf<object>();
      return undefined;
    });

    // @ts-expect-error a number is not the topic's V
    const wrongValue = bindJob('forecastScore.report', job<PerCar>('d'), () => 1);
    // @ts-expect-error the select returns V, not Computed<V>: the publisher wraps it
    const wrapped = bindJob('forecastScore.report', job<Computed<ForecastScoreReport>>('e'), (out) => out);
    // @ts-expect-error a topic that is no job topic takes no job, with a select or without
    const notJobTopic = bindJob('laps', job<Record<CarId, number>>('f'), selectCar);
    // @ts-expect-error a select whose output type is not the job's
    const wrongOut = bindJob('forecastScore.report', job<number>('g'), (out: string) => (out === '' ? undefined : undefined));
    expect([perCar, own, wrongValue, wrapped, notJobTopic, wrongOut].map((b) => b.topic)).toEqual([
      'forecastScore.report',
      'forecastScore.report',
      'forecastScore.report',
      'forecastScore.report',
      'laps',
      'forecastScore.report',
    ]);
    expect('select' in perCar).toBe(true);
  });
});
