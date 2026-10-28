// Scheduler beyond the main cases: the clock going backwards, the event cadences, what a calculator reads, failures and insights.
import { describe, expect, it } from 'vitest';
import type { Insight } from '@pitwall/domain';
import { RegistryError } from '../../src/index.ts';
import { delta, input, len, quick, sched } from '../support/scheduler.ts';

const insight = (key: string): Insight => ({ key, severity: 'info', category: 'race', feedId: 'f1', kind: key, params: {}, raisedAt: 0 }) as Insight;

describe('Scheduler: the clock', () => {
  it('a session time that went back (a flashback) makes a { hz } calculator run at once', () => {
    const s = sched([quick('a', { cadence: { hz: 2 } })]);
    expect([1_000, 1_100, 400, 500, 899, 900].map((t) => s.run(input(t)).ran)).toEqual([['a'], [], ['a'], [], [], ['a']]);
  });
  it('the same session time again is no step back', () => {
    const s = sched([quick('a', { cadence: { hz: 2 } })]);
    expect([1_000, 1_000].map((t) => s.run(input(t)).ran)).toEqual([['a'], []]);
  });
});

describe('Scheduler: event cadences', () => {
  it('pitStop runs when a pit stop was added, not before', () => {
    const s = sched([quick('p', { reads: ['pitStops'], cadence: 'pitStop' })]);
    s.run(input(0, ['pitStops']));
    expect(s.run(input(1, ['pitStops'], { before: len({ pitStops: 2 }), after: len({ pitStops: 2 }), truncated: false })).ran).toEqual([]);
    expect(s.run(input(2, ['pitStops'], { before: len({ pitStops: 2 }), after: len({ pitStops: 3 }), truncated: false })).ran).toEqual(['p']);
  });
  it('pitStop does not run for a lap', () => {
    const s = sched([quick('p', { reads: ['laps'], cadence: 'pitStop' })]);
    s.run(input(0, ['laps']));
    expect(s.run(input(1, ['laps'], { before: len({ laps: 2 }), after: len({ laps: 3 }), truncated: false })).ran).toEqual([]);
  });
  it('flagChange runs when the flag phases changed, not for other changes', () => {
    const s = sched([quick('f', { reads: ['flagPhases', 'timing'], cadence: 'flagChange' })]);
    s.run(input(0));
    expect(s.run(input(1, ['timing'])).ran).toEqual([]);
    expect(s.run(input(2, ['session'])).ran).toEqual([]);
    expect(s.run(input(3, ['flagPhases'])).ran).toEqual(['f']);
    expect(s.run(input(4, ['timing'])).ran).toEqual([]);
  });
  it('flagChange remembers a flag change that came while the calculator was not affected by it', () => {
    const s = sched([quick('f', { reads: ['laps'], cadence: 'flagChange' })]);
    s.run(input(0));
    expect(s.run(input(1, ['flagPhases'])).ran).toEqual([]);                           // due, but it reads nothing that changed
    expect(s.run(input(2, ['laps'])).ran).toEqual(['f']);
  });
});

describe('Scheduler: what a calculator reads', () => {
  it('runs when any one of the things it reads changed', () => {
    const s = sched([quick('a', { reads: ['laps', 'timing'] })]);
    s.run(input(0));
    expect(s.run(input(1, ['timing'])).ran).toEqual(['a']);
    expect(s.run(input(2, ['laps'])).ran).toEqual(['a']);
    expect(s.run(input(3, ['events'])).ran).toEqual([]);
  });
  it('a calculator that reads the feed runs on every frame', () => {
    const s = sched([quick('a', { reads: ['feed'] })]);
    expect([0, 1, 2].map((t) => s.run(input(t, ['events'])).ran)).toEqual([['a'], ['a'], ['a']]);
  });
  it('a feed calculator still waits for its cadence', () => {
    const s = sched([quick('a', { reads: ['feed'], cadence: { hz: 1 } })]);
    expect([0, 500, 1_000].map((t) => s.run(input(t, ['events'])).ran)).toEqual([['a'], [], ['a']]);
  });
});

describe('Scheduler: needed calculators', () => {
  it('setNeeded names the calculator that does not exist', () => {
    const s = sched([quick('a')]);
    const failure = (() => { try { s.setNeeded(['a', 'nope']); } catch (e) { return e as RegistryError; } })();
    expect(failure).toBeInstanceOf(RegistryError);
    expect([failure?.reason, failure?.ids, failure?.message]).toEqual(['unknownDependency', ['nope'], 'unknown calculator "nope"']);
  });
  it('a calculator that is no longer needed does not run, but sees what it missed when it is needed again', () => {
    const s = sched([quick('a', { reads: ['laps'] })]);
    s.run(input(0));
    s.setNeeded([]);
    expect(s.run(input(1, ['laps'])).ran).toEqual([]);
    s.setNeeded(['a']);
    expect(s.run(input(2, ['timing'])).ran).toEqual(['a']);
  });
});

describe('Scheduler: failures', () => {
  it('the output of a calculator that failed after it had worked is gone', () => {
    let fail = false;
    const s = sched([quick('a', { compute: () => { if (fail) throw new Error('boom'); return 7; } })]);
    expect(s.run(input(0)).outputs.get('a')).toBe(7);
    fail = true;
    const r = s.run(input(1));
    expect([r.outputs.has('a'), r.errors.map((e) => e.id)]).toEqual([false, ['a']]);
  });
  it('a calculator is skipped when any one of the calculators it reads failed', () => {
    const s = sched([
      quick('good'),
      quick('bad', { compute: () => { throw new Error('boom'); } }),
      quick('both', { reads: [{ calculator: 'good' }, { calculator: 'bad' }] }),
      quick('either', { reads: [{ calculator: 'bad' }, { calculator: 'good' }] }),
    ]);
    const r = s.run(input(0));
    expect([r.ran, r.errors.map((e) => e.id)]).toEqual([['good'], ['bad']]);
  });
});

describe('Scheduler: insights', () => {
  it('activeInsights lists what the calculators hold raised, and drops what no longer holds', () => {
    let raised = true;
    const s = sched([quick('a', { insights: () => (raised ? [insight('x')] : []) })]);
    expect(s.activeInsights).toEqual([]);
    s.run(input(5));
    expect(s.activeInsights).toEqual([{ ...insight('x'), raisedAt: 5 }]);
    raised = false;
    s.run(input(6));
    expect(s.activeInsights).toEqual([]);
  });
  it('each calculator holds its own insights: one raising does not resolve the other’s', () => {
    const s = sched([quick('a', { insights: () => [insight('x')] }), quick('b', { insights: () => [insight('y')] })]);
    const first = s.run(input(0));
    expect(first.insights.map((c) => c.type)).toEqual(['raised', 'raised']);
    expect(s.run(input(1)).insights).toEqual([]);
    expect(s.activeInsights.map((i) => i.key)).toEqual(['x', 'y']);
  });
  it('the insight of a calculator that failed is the error, and the error goes when it works again', () => {
    let fail = true;
    const s = sched([quick('a', { compute: () => { if (fail) throw new Error('boom'); return 1; } })]);
    s.run(input(0));
    expect(s.activeInsights.map((i) => i.key)).toEqual(['system.calculatorError:a']);
    fail = false;
    s.run(input(1));
    expect(s.activeInsights).toEqual([]);
  });
});

describe('Scheduler: newly needed calculators (ruling R9)', () => {
  it('setNeeded returns the calculators needed now that were not before, in registry order, dependencies included', () => {
    const s = sched([quick('a'), quick('b', { reads: [{ calculator: 'a' }] }), quick('c')], []);
    expect(s.setNeeded(['b'])).toEqual(['a', 'b']);
    expect(s.setNeeded(['b', 'a'])).toEqual([]);
    expect(s.setNeeded(['c'])).toEqual(['c']);
    expect(s.setNeeded(['a', 'c'])).toEqual(['a']);
  });
  it('a pass without changed tags and with an empty history delta runs only the calculators that never ran', () => {
    const s = sched([quick('old', { reads: ['laps'] }), quick('event', { reads: ['laps'], cadence: 'lapCompleted' }), quick('late', { reads: ['laps'] })], ['old', 'event']);
    s.run(input(0, ['laps'], delta(0, 1)));
    s.setNeeded(['old', 'event', 'late']);
    expect(s.run(input(0, [], delta(1))).ran).toEqual(['late']);
  });
});
