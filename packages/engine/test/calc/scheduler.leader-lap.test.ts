// The `leaderLap` cadence (SP4.3a spec 5, plan Task 3; C30, C40): a unit runs when the projection's laps gained a lap
// record with `positionAtEnd` 1 (the leader's) since it last ran, or on a rewind; another car's lap record does not
// make it due.
import { describe, expect, it } from 'vitest';
import { carId, unknown, type LapRecord } from '@pitwall/domain';
import { lap, NO_DRIVERS, NO_PRIORS } from '../../../../test-support/builders/index.ts';
import type { SchedulerInput } from '../../src/index.ts';
import { feed, len, quick, RACING, sched } from '../support/scheduler.ts';

/**
 * A feed of frames: each appends the given positions' lap records (car = position) to the projection's `laps` and sets
 * `laps` when it appends one; `rewound` marks a void fact (C30).
 */
const feedOf = () => {
  const laps: LapRecord[] = [];
  let frame = 0;
  return (positions: number[], o: { rewound?: boolean } = {}): SchedulerInput => {
    frame += 1;
    const before = laps.length;
    for (const p of positions) laps.push(lap({ carId: carId(p), positionAtEnd: p, frame }));
    return {
      live: { feedId: 'f1', sessionTime: frame * 100, cars: [] } as never,
      situation: RACING,
      history: { laps: [...laps], crossings: [], decisions: [] } as never,
      changed: new Set(positions.length > 0 || o.rewound ? ['laps'] : []),
      delta: {
        before: len({ laps: before }),
        after: len({ laps: laps.length }),
        ...(o.rewound ? { rewound: { frameId: frame, at: frame * 100 } } : {}),
      },
      weekend: undefined,
      feed,
      config: {},
      priors: NO_PRIORS,
      drivers: NO_DRIVERS,
      track: unknown('notApplicable'),
    };
  };
};

/** A scheduler over one `leaderLap` unit that reads the laps, past its first run (which always runs). */
const started = () => {
  const s = sched([quick('c', { reads: ['laps'], cadence: 'leaderLap' })]);
  const next = feedOf();
  expect(s.run(next([])).ran).toEqual(['c']);
  return { s, next };
};

describe('Scheduler: the leaderLap cadence', () => {
  it("leaderLap is due on the leader's lap record only, and on a rewind", () => {
    const { s, next } = started();
    // a P2 lap record: not due
    expect(s.run(next([2])).ran).toEqual([]);
    // a P1 one: due
    expect(s.run(next([1])).ran).toEqual(['c']);
    // a rewound frame: due, whatever it appended
    expect(s.run(next([], { rewound: true })).ran).toEqual(['c']);
  });

  it('a frame appending several cars\' lap records is due when one is the leader\'s, whatever the order', () => {
    const { s, next } = started();
    expect(s.run(next([3, 4])).ran).toEqual([]);
    expect(s.run(next([5, 1, 6])).ran).toEqual(['c']);
  });

  it('frames without a lap record do not make it due', () => {
    const { s, next } = started();
    expect([[], [], []].map((p) => s.run(next(p)).ran)).toEqual([[], [], []]);
  });

  it('a leader\'s lap record appended while the unit was not due counts at its next pass: only the new records since it ran are read', () => {
    // the unit is not needed for two frames (a P1 lap among them), then needed again: the pending P1 lap makes it due
    const s = sched([quick('c', { reads: ['laps'], cadence: 'leaderLap' })]);
    const next = feedOf();
    expect(s.run(next([])).ran).toEqual(['c']);
    s.setNeeded([]);
    s.run(next([1]));
    s.run(next([2]));
    s.setNeeded(['c']);
    expect(s.run(next([])).ran).toEqual(['c']);
    // after that run, a P2 lap alone is not due again
    expect(s.run(next([2])).ran).toEqual([]);
  });
});
