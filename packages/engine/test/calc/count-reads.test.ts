// `countReads` (contract C31.1): the projection entries a unit reads through its guarded view, counted, never timed.
import { carId, unknown, type MiniSectorCrossing, type OpenSpan, type Span } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { ChangeTag, EngineView, IncrementalCalculator, QuickCalculator } from '../../src/index.ts';
import { UndeclaredReadError } from '../support/guarded-input.ts';
import { countReads, feed, RACING } from '../support/scheduler.ts';

const crossing = (i: number): MiniSectorCrossing => ({ carId: carId(0), lap: 1, segment: i, at: 1_000 * i, frame: i + 1 });
const span = (id: number, startFrame: number, endFrame: number): Span => ({
  machine: 'car-status',
  id,
  kind: 'competing',
  start: startFrame,
  end: endFrame,
  confirmed: true,
  detail: undefined,
  startFrame,
  endFrame,
  carId: carId(0),
});
const OPEN: OpenSpan = { machine: 'car-status', id: 2, kind: 'competing', start: 9, confirmed: true, detail: undefined, startFrame: 9, carId: carId(0) };

/** Five crossings, two closed car-status spans and one open. */
const VIEW: EngineView = {
  live: { feedId: 'f1', sessionTime: 0 } as never,
  situation: { ...RACING, byMachine: { 'car-status': [OPEN] } },
  history: { laps: [], stints: [], pitStops: [], events: [], penalties: [], decisions: [], clock: [], crossings: [0, 1, 2, 3, 4].map(crossing), spans: { 'car-status': [span(0, 1, 5), span(1, 5, 9)] }, appendedAt: {} },
  changed: new Set(),
  delta: { before: { crossings: 3 }, after: { crossings: 5 } },
  weekend: undefined,
  feed,
  config: {},
  priors: unknown('notApplicable'),
  track: unknown('notApplicable'),
  drivers: [],
  outputs: new Map(),
};

const quick = (reads: ChangeTag[], compute: (view: EngineView) => unknown): QuickCalculator<unknown> => ({ kind: 'quick', id: 'probe', reads, cadence: 'frame', compute });

describe('countReads (C31.1)', () => {
  it('counts the entries of a projection list a quick unit reads: a slice reads only its entries', () => {
    expect(countReads(quick(['miniSectors'], (v) => v.history.crossings.slice(2).map((c) => c.at)), VIEW)).toBe(3);
  });

  it('counts an entry once however often it is read', () => {
    const twice = quick(['miniSectors'], (v) => [v.history.crossings[1]?.at, v.history.crossings[1]?.lap, v.history.crossings.find((c) => c.segment === 1)]);
    expect(countReads(twice, VIEW)).toBe(2);
  });

  it('counts no entry for a list length', () => {
    expect(countReads(quick(['miniSectors'], (v) => v.history.crossings.length), VIEW)).toBe(0);
  });

  it("counts a sub-machine's closed spans in the projection, not its open spans in the situation", () => {
    const spans = quick(['spans:car-status'], (v) => [...(v.history.spans['car-status'] ?? []), ...(v.situation.byMachine['car-status'] ?? [])].map((s) => s.kind));
    expect(countReads(spans, VIEW)).toBe(2);
  });

  it("counts an incremental unit's init by default, and its fold when given: the delta's new entries", () => {
    const fold: IncrementalCalculator<number, number> = {
      kind: 'incremental',
      id: 'probe',
      reads: ['miniSectors'],
      cadence: 'frame',
      init: (v) => v.history.crossings.length,
      update: (acc, d, v) => acc + v.history.crossings.slice(d.before.crossings, d.after.crossings).length,
      output: (acc) => acc,
    };
    const scan = { ...fold, init: (v: EngineView) => v.history.crossings.filter((c) => c.lap === 1).length };
    expect(countReads(scan, VIEW)).toBe(5);
    expect(countReads(fold, VIEW, (v) => fold.update(3, v.delta, v))).toBe(2);
  });

  it('still guards the view: an undeclared read throws (C41)', () => {
    expect(() => countReads(quick(['laps'], (v) => v.history.crossings[0]), VIEW)).toThrow(UndeclaredReadError);
  });
});
