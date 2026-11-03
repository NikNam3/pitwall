// The projection (C26, C28-C30): the log without hidden facts. A void range hides its facts; a non-span fact whose
// described frame lies in the formation span of `session-phase-race` is hidden (C29), whether that span is still open
// or already closed and whenever the fact was recorded; spans are never hidden that way.
import { carId as car, type FactList } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LogLengths } from '../../src/log/types.ts';
import { createLog, logWriter } from '../../src/log/log.ts';
import { ProjectionTracker } from '../../src/log/projection.ts';
import { clockJump, crossing, event, NOTHING_OPEN, openSpan, situation, span, voidFact } from '../support/log-facts.ts';

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

  it('a fact whose described frame lies in a formation span is hidden: while the span is open, after it closed, and a late fact recorded after it closed', () => {
    const log = createLog();
    const writer = logWriter(log);
    const tracker = new ProjectionTracker(log);

    // Formation: the session-phase span 0 of kind `formation` opened on frame 10, so it is only in the situation.
    const formationOpen = situation(openSpan('session-phase-race', 0, 'formation', 1000, { startFrame: 10 }));
    const beforeFormation = event(900, 9);
    const onItsFirstFrame = event(1000, 10);
    const duringFormation = event(2000, 15, car(0));
    const formationClock = clockJump(2200, 16);
    writer.append('events', beforeFormation);
    writer.append('events', onItsFirstFrame);
    writer.append('events', duringFormation);
    writer.append('clock', formationClock);
    const open = tracker.update(formationOpen);
    expect(len(open.after, 'events')).toBe(1);
    expect(tracker.projection.events).toEqual([beforeFormation]);
    expect(tracker.projection.clock).toEqual([]);

    // Lights out on frame 20: the formation span closes into the log, covering frames 10 to 19, and racing opens.
    const formation = span('session-phase-race', 0, 'formation', 1000, 3000, { startFrame: 10, endFrame: 20 });
    writer.append('spans:session-phase-race', formation);
    // A fact recorded after lights out that describes a frame inside the formation (a confirmed lap of its crossing).
    const late = event(2900, 19, car(1));
    const atLightsOut = event(3000, 20);
    writer.append('events', late);
    writer.append('events', atLightsOut);
    const racingOpen = situation(openSpan('session-phase-race', 1, 'racing', 3000, { startFrame: 20 }));
    const closed = tracker.update(racingOpen);
    expect(closed.rewound).toBeUndefined();
    expect(len(closed.before, 'events')).toBe(1);
    expect(len(closed.after, 'events')).toBe(2);
    expect(tracker.projection.events).toEqual([beforeFormation, atLightsOut]);
    expect(tracker.projection.clock).toEqual([]);

    // Later still: a fact describing a formation frame is hidden by the closed span alone.
    const later = event(2500, 12);
    writer.append('events', later);
    tracker.update(racingOpen);
    expect(tracker.projection.events).toEqual([beforeFormation, atLightsOut]);

    // A tracker that never saw the formation span open hides the same facts from the closed span in the log alone.
    const fresh = new ProjectionTracker(log);
    fresh.update(racingOpen);
    expect(fresh.projection.events).toEqual([beforeFormation, atLightsOut]);
    expect(fresh.projection.clock).toEqual([]);
  });

  it('a span is never hidden by formation: the formation span itself and a span inside it stay visible', () => {
    const log = createLog();
    const writer = logWriter(log);
    const tracker = new ProjectionTracker(log);
    const flagDuringFormation = span('flags', 0, 'yellow', 1800, 2400, { startFrame: 12, endFrame: 18 });
    writer.append('spans:flags', flagDuringFormation);
    tracker.update(situation(openSpan('session-phase-race', 0, 'formation', 1000, { startFrame: 10 })));
    expect(tracker.projection.spans['flags']).toEqual([flagDuringFormation]);

    const formation = span('session-phase-race', 0, 'formation', 1000, 3000, { startFrame: 10, endFrame: 20 });
    writer.append('spans:session-phase-race', formation);
    tracker.update(situation(openSpan('session-phase-race', 1, 'racing', 3000, { startFrame: 20 })));
    expect(tracker.projection.spans['session-phase-race']).toEqual([formation]);
    expect(tracker.projection.spans['flags']).toEqual([flagDuringFormation]);
  });

  it('only the formation span of session-phase-race hides: a span of kind formation of another sub-machine, a car\'s too, hides nothing (C29)', () => {
    const log = createLog();
    const writer = logWriter(log);
    const tracker = new ProjectionTracker(log);
    const carThree = situation(openSpan('car-activity', 0, 'formation', 1000, { startFrame: 10, carId: car(3) }));
    writer.append('spans:car-activity', span('car-activity', 0, 'formation', 3000, 4000, { startFrame: 30, endFrame: 40, carId: car(4) }));
    writer.append('spans:other-session', span('other-session', 0, 'formation', 3000, 4000, { startFrame: 30, endFrame: 40 }));
    const facts = [event(1500, 15, car(3)), event(1500, 15), event(3500, 35, car(4)), event(3500, 35)];
    for (const e of facts) writer.append('events', e);
    writer.append('crossings', crossing(car(3), 1500, 15));
    tracker.update(carThree);
    expect(tracker.projection.events).toEqual(facts);
    expect(tracker.projection.crossings).toEqual([crossing(car(3), 1500, 15)]);
  });

  it('without a void the projection only grows', () => {
    type Append = { list: 'events' | 'clock' | 'spans:flags' | 'spans:session-phase-race'; at: number };
    const arbAppend: fc.Arbitrary<Append> = fc.record({
      list: fc.constantFrom('events', 'clock', 'spans:flags', 'spans:session-phase-race'),
      at: fc.integer({ min: 0, max: 3_600_000 }),
    });
    // Each inner array is one frame's appends, followed by one `update`.
    fc.assert(
      fc.property(fc.array(fc.array(arbAppend, { maxLength: 6 }), { maxLength: 20 }), (frames) => {
        const log = createLog();
        const writer = logWriter(log);
        const tracker = new ProjectionTracker(log);
        const ids = { flags: 0, 'session-phase-race': 0 };
        const appended = new Map<FactList, number>();
        let previous: LogLengths = {};
        for (const frame of frames) {
          for (const a of frame) {
            if (a.list === 'events') writer.append('events', event(a.at));
            else if (a.list === 'clock') writer.append('clock', clockJump(a.at));
            else if (a.list === 'spans:flags') writer.append('spans:flags', span('flags', ids.flags++, 'yellow', a.at, a.at + 1));
            else writer.append('spans:session-phase-race', span('session-phase-race', ids['session-phase-race']++, 'racing', a.at, a.at + 1));
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
