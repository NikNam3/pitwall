// The `Job` type (groundwork task 7) lives next to the calculator types, so `strategy` can declare jobs.
// Compiled by `pnpm typecheck`; vitest runs the runtime assertions.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Cadence, Calculator, CalculatorId, Dependency, EngineView, Job } from '../../src/index.ts';

describe('Job', () => {
  it('has the fields of a calculator trigger plus a worker module', () => {
    expectTypeOf<Job<{ n: number }, string>['kind']>().toEqualTypeOf<'job'>();
    expectTypeOf<Job<{ n: number }, string>['id']>().toEqualTypeOf<CalculatorId>();
    expectTypeOf<Job<{ n: number }, string>['reads']>().toEqualTypeOf<Dependency[]>();
    expectTypeOf<Job<{ n: number }, string>['trigger']>().toEqualTypeOf<Cadence>();
    expectTypeOf<Job<{ n: number }, string>['module']>().toEqualTypeOf<URL>();
    expectTypeOf<Job<{ n: number }, string>['prepare']>().toEqualTypeOf<(view: EngineView) => { n: number }>();
  });

  it('ties the output type to the job through the optional phantom field `out`', () => {
    expectTypeOf<Job<number, string>['out']>().toEqualTypeOf<string | undefined>();
    const job: Job<number, string> = { kind: 'job', id: 'j', reads: ['timing'], trigger: 'lapCompleted', prepare: () => 1, module: new URL('file:///j.ts') };
    expect(job.out).toBeUndefined();
  });

  it('a job of any input and output fits the unknown form that a feature lists', () => {
    expectTypeOf<Job<{ n: number }, string>>().toMatchTypeOf<Job<unknown, unknown>>();
  });

  it('is not a calculator', () => {
    // @ts-expect-error a job has no `cadence` and no `compute`; the pipeline turns it into the calculator `job:<id>`
    const calc: Calculator = {} as Job<number, string>;
    expect(calc).toBeDefined();
  });

  it('a job without `reads`, `trigger` or `prepare` does not compile', () => {
    // @ts-expect-error reads, trigger and prepare are required
    const incomplete: Job<number, string> = { kind: 'job', id: 'j', module: new URL('file:///j.ts') };
    expect(incomplete.id).toBe('j');
  });
});
