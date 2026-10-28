import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { IncrementalCalculator } from '../../src/index.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { expectIncrementalEqualsFromScratch } from '../helpers/incremental.ts';

type Counts = Record<string, number>;
const fold = (acc: Counts, events: ReadonlyArray<{ kind: string }>) => { const n = { ...acc }; for (const e of events) n[e.kind] = (n[e.kind] ?? 0) + 1; return n; };
const eventCounter: IncrementalCalculator<Counts, Counts> = {
  kind: 'incremental', id: 'eventCounts', reads: ['events'], cadence: 'frame',
  init: (v) => fold({}, v.state.history.events),
  update: (acc, d, v) => fold(acc, v.state.history.events.slice(d.before.events, d.after.events)),
  output: (acc) => acc,
};
const scenario = (gaps: Array<[number, number]>) => {
  const b = new ScenarioBuilder({ cars: 4 }).session().participants();
  for (const [gap, car] of gaps) b.frames(gap, () => {}).event({ code: 'FTLP', vehicleIdx: car, lapTime: 80 + car });
  return b.frames(2, () => {}).build();
};

describe('expectIncrementalEqualsFromScratch', () => {
  it('holds for a correct fold over random event streams', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 3 })), { maxLength: 8 }),
      (gaps) => expectIncrementalEqualsFromScratch(eventCounter, scenario(gaps))), { numRuns: 30 });
  });
  it('fails for an update that ignores the delta', () => {
    const broken = { ...eventCounter, update: (acc: Counts) => acc };
    expect(() => expectIncrementalEqualsFromScratch(broken, scenario([[1, 0]]))).toThrow();
  });
});
