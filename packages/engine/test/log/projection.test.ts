// The projection (C28-C30): the log without hidden facts. A void range hides its facts; a non-span fact stamped with a
// formation span is hidden, whether that span is still open or already closed; spans are never hidden by a stamp.
import type { FactList } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LogLengths } from '../../src/log/types.ts';
import { createLog, logWriter } from '../../src/log/log.ts';
import { ProjectionTracker } from '../../src/log/projection.ts';
import { clockJump, event, NOTHING_OPEN, openSpan, situation, span, voidFact } from '../support/log-facts.ts';

const len = (lengths: LogLengths, list: FactList): number => lengths[list] ?? 0;

describe('projection', () => {
  it('a void range hides its facts and the projection shrinks once', () => {
    const log = createLog();
    const writer = logWriter(log);
    const tracker = new ProjectionTracker(log);
    const kept = [event(1000), event(2000)];
    const undone = [event(3000), event(4000), event(5000)];
    for (const e of [...kept, ...undone]) writer.append('events', e);
    const grown = tracker.update(NOTHING_OPEN);
    expect(grown.rewound).toBeUndefined();
    expect(len(grown.after, 'events')).toBe(5);

    // The runner rewinds to the frame after the kept facts and appends the void fact over the undone ones (C27).
    writer.append('voids', voidFact(42, 2500, { events: [2, 5] }));
    const shrunk = tracker.update(NOTHING_OPEN);
    expect(shrunk.rewound).toEqual({ frameId: 42, at: 2500 });
    expect(len(shrunk.before, 'events')).toBe(5);
    expect(len(shrunk.after, 'events')).toBe(2);
    expect(tracker.projection.events).toEqual(kept);

    // Once: the next frame without a new void is no rewind and changes nothing.
    const still = tracker.update(NOTHING_OPEN);
    expect(still.rewound).toBeUndefined();
    expect(still.before).toEqual(still.after);
    expect(len(still.after, 'events')).toBe(2);

    // The replayed frames append their facts again after the void; the projection grows from the kept facts.
    const replayed = event(3100);
    writer.append('events', replayed);
    const regrown = tracker.update(NOTHING_OPEN);
    expect(regrown.rewound).toBeUndefined();
    expect(len(regrown.before, 'events')).toBe(2);
    expect(len(regrown.after, 'events')).toBe(3);
    expect(tracker.projection.events).toEqual([...kept, replayed]);
  });

  it('a fact stamped with a formation span is hidden while that span is still open, and stays hidden after it closes; the formation span itself is not', () => {
    const log = createLog();
    const writer = logWriter(log);
    const tracker = new ProjectionTracker(log);

    // Formation: the session-phase span 0 of kind `formation` is open, so it is only in the situation, not in the log.
    const formationOpen = situation(openSpan('session-phase', 0, 'formation', 1000));
    const unstamped = event(1500);
    const duringFormation = event(2000, { 'session-phase': 0 });
    const formationClock = clockJump(2200, { 'session-phase': 0 });
    // A span recorded during the formation lap carries the formation stamp too, and stays visible (C29).
    const flagDuringFormation = span('flags', 0, 'yellow', 1800, 2400, { 'session-phase': 0 });
    writer.append('events', unstamped);
    writer.append('events', duringFormation);
    writer.append('clock', formationClock);
    writer.append('spans:flags', flagDuringFormation);
    const open = tracker.update(formationOpen);
    expect(len(open.after, 'events')).toBe(1);
    expect(len(open.after, 'clock')).toBe(0);
    expect(tracker.projection.events).toEqual([unstamped]);
    expect(tracker.projection.clock).toEqual([]);
    expect(tracker.projection.spans['flags']).toEqual([flagDuringFormation]);

    // Lights out: the formation span closes into the log and the racing span 1 opens.
    const formation = span('session-phase', 0, 'formation', 1000, 3000);
    writer.append('spans:session-phase', formation);
    const lateDuringFormation = event(2900, { 'session-phase': 0 });
    writer.append('events', lateDuringFormation);
    const racing = event(3500, { 'session-phase': 1 });
    writer.append('events', racing);
    const racingOpen = situation(openSpan('session-phase', 1, 'racing', 3000));
    const closed = tracker.update(racingOpen);
    expect(closed.rewound).toBeUndefined();
    expect(len(closed.before, 'events')).toBe(1);
    expect(len(closed.after, 'events')).toBe(2);
    expect(tracker.projection.events).toEqual([unstamped, racing]);
    expect(tracker.projection.clock).toEqual([]);
    expect(tracker.projection.spans['session-phase']).toEqual([formation]);
    expect(tracker.projection.spans['flags']).toEqual([flagDuringFormation]);

    // A tracker that never saw the formation span open resolves the stamp from the closed span in the log alone.
    const fresh = new ProjectionTracker(log);
    fresh.update(racingOpen);
    expect(fresh.projection.events).toEqual([unstamped, racing]);
    expect(fresh.projection.clock).toEqual([]);
    expect(fresh.projection.spans['session-phase']).toEqual([formation]);
  });

  it('without a void the projection only grows', () => {
    type Append = { list: 'events' | 'clock' | 'spans:flags' | 'spans:session-phase'; at: number };
    const arbAppend: fc.Arbitrary<Append> = fc.record({
      list: fc.constantFrom('events', 'clock', 'spans:flags', 'spans:session-phase'),
      at: fc.integer({ min: 0, max: 3_600_000 }),
    });
    // Each inner array is one frame's appends, followed by one `update`.
    fc.assert(
      fc.property(fc.array(fc.array(arbAppend, { maxLength: 6 }), { maxLength: 20 }), (frames) => {
        const log = createLog();
        const writer = logWriter(log);
        const tracker = new ProjectionTracker(log);
        const ids = { flags: 0, 'session-phase': 0 };
        const appended = new Map<FactList, number>();
        let previous: LogLengths = {};
        for (const frame of frames) {
          for (const a of frame) {
            if (a.list === 'events') writer.append('events', event(a.at));
            else if (a.list === 'clock') writer.append('clock', clockJump(a.at));
            else if (a.list === 'spans:flags') writer.append('spans:flags', span('flags', ids.flags++, 'yellow', a.at, a.at + 1));
            else writer.append('spans:session-phase', span('session-phase', ids['session-phase']++, 'racing', a.at, a.at + 1));
            appended.set(a.list, (appended.get(a.list) ?? 0) + 1);
          }
          const delta = tracker.update(NOTHING_OPEN);
          expect(delta.rewound).toBeUndefined();
          const lists = new Set<FactList>([...Object.keys(delta.before), ...Object.keys(delta.after)] as FactList[]);
          for (const list of lists) {
            expect(len(delta.after, list)).toBeGreaterThanOrEqual(len(delta.before, list));
            expect(len(delta.before, list)).toBe(len(previous, list));
          }
          for (const [list, n] of appended) expect(len(delta.after, list)).toBe(n);
          previous = delta.after;
        }
      }),
    );
  });

  it('two voids over the same range hide it once', () => {
    const log = createLog();
    const writer = logWriter(log);
    const tracker = new ProjectionTracker(log);
    const kept = [event(1000), event(2000)];
    for (const e of [...kept, event(3000), event(4000)]) writer.append('events', e);
    tracker.update(NOTHING_OPEN);

    writer.append('voids', voidFact(10, 2500, { events: [2, 4] }));
    const first = tracker.update(NOTHING_OPEN);
    expect(first.rewound).toEqual({ frameId: 10, at: 2500 });
    expect(len(first.after, 'events')).toBe(2);

    // A second flashback to the same target before any replayed fact: the same range again.
    writer.append('voids', voidFact(10, 2500, { events: [2, 4] }));
    const second = tracker.update(NOTHING_OPEN);
    expect(second.rewound).toEqual({ frameId: 10, at: 2500 });
    expect(len(second.before, 'events')).toBe(2);
    expect(len(second.after, 'events')).toBe(2);
    expect(tracker.projection.events).toEqual(kept);

    // Both voids appearing in one frame hide the range once too.
    const both = createLog();
    const bothWriter = logWriter(both);
    for (const e of [...kept, event(3000), event(4000)]) bothWriter.append('events', e);
    bothWriter.append('voids', voidFact(10, 2500, { events: [2, 4] }));
    bothWriter.append('voids', voidFact(10, 2500, { events: [2, 4] }));
    const after = new ProjectionTracker(both);
    const delta = after.update(NOTHING_OPEN);
    expect(len(delta.after, 'events')).toBe(2);
    expect(after.projection.events).toEqual(kept);
  });
});
