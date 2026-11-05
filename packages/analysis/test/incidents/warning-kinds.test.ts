// `incidents`: a warning entry carries what the warning was given for (spec 3.3; C3, C43). The calculator reads the
// warned span: a corner-cutting count that rose is `cornerCutting` (with its count of the limit); any other warning is
// `other` and carries the span's infringement code, unknown when the span has none.
import { describe, expect, it } from 'vitest';
import { known, unknown, type IncidentEntry, type WarnedDetail } from '@pitwall/domain';
import { chain, race, run, viewOf, warned, type SpanStep } from './race.ts';

const T = 407_900;

const warnings = (feed: IncidentEntry[], id: number): IncidentEntry[] =>
  feed.filter((e) => e.kind === 'warning' && e.carIds[0] === id);

describe('incidents: warnings by kind', () => {
  it('a warning whose corner-cutting count rose is a cornerCutting entry with its count of the limit', () => {
    const [entry] = warnings(run(viewOf({ miniSectors: race(), spans: warned(7, [T]) })), 7);
    expect(entry!.warning).toEqual({ kind: 'cornerCutting', count: 1, limit: 3 });
  });

  it('a collision warning (the corner-cutting count unchanged, infringement 4) is an other entry with its infringement', () => {
    const [entry] = warnings(run(viewOf({ miniSectors: race(), spans: warned(7, [T], ['collision']) })), 7);
    expect(entry!.warning).toEqual({ kind: 'other', infringement: known(4, T) });
  });

  it('a warning without an infringement is an other entry with an unknown one', () => {
    const steps: SpanStep[] = [
      { kind: 'noWarning', at: 0, detail: {}, joinedAt: true },
      { kind: 'warned', at: T, detail: { count: 1, cornerCutting: 0, infringement: unknown('notReceived') } satisfies WarnedDetail },
    ];
    const [entry] = warnings(run(viewOf({ miniSectors: race(), spans: chain('warnings', 7, steps) })), 7);
    expect(entry!.warning).toEqual({ kind: 'other', infringement: unknown('notReceived') });
  });

  it('each warning of a car has its own kind: a collision between two corner-cutting ones does not move the count', () => {
    const spans = warned(7, [370_000, 380_000, 390_000], ['cornerCutting', 'collision', 'cornerCutting']);
    const feed = warnings(run(viewOf({ miniSectors: race(), spans })), 7); // newest first
    expect(feed.map((e) => e.warning).reverse()).toEqual([
      { kind: 'cornerCutting', count: 1, limit: 3 },
      { kind: 'other', infringement: known(4, 380_000) },
      { kind: 'cornerCutting', count: 2, limit: 3 },
    ]);
  });
});
