// The `ourCrossing` cadence (SP4.2 spec 3.1, C30, C40, C41): a unit runs exactly when the projection's mini-sector
// crossings gained one of our cars' (the player's or the teammate's) since it last ran, or on a rewind.
import { describe, expect, it } from 'vitest';
import { carId, unknown, type CarId, type MiniSectorCrossing } from '@pitwall/domain';
import { NO_PRIORS } from '../../../../test-support/builders/index.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import type { EngineView, SchedulerInput } from '../../src/index.ts';
import { feed, len, quick, RACING, sched } from '../support/scheduler.ts';

const PLAYER = carId(3);
const TEAMMATE = carId(7);
const RIVAL = carId(11);
const OTHER = carId(12);

const crossing = (car: CarId, frame: number): MiniSectorCrossing => ({ carId: car, lap: 1, segment: frame % 50, at: frame * 100, frame });

/**
 * A feed of frames: each frame appends the given crossings to the projection's `crossings` list and sets `miniSectors`.
 * `rewound` marks a void fact (C30).
 */
const feedOf = () => {
  const crossings: MiniSectorCrossing[] = [];
  let frame = 0;
  return (cars: CarId[], o: { rewound?: boolean } = {}): SchedulerInput => {
    frame += 1;
    const before = crossings.length;
    for (const car of cars) crossings.push(crossing(car, frame));
    return {
      live: { feedId: 'f1', sessionTime: frame * 100, playerCar: PLAYER, teammateCar: TEAMMATE } as never,
      situation: RACING,
      history: { laps: [], crossings: [...crossings], decisions: [] } as never,
      changed: new Set(cars.length > 0 || o.rewound ? ['miniSectors'] : []),
      delta: {
        before: len({ crossings: before }),
        after: len({ crossings: crossings.length }),
        ...(o.rewound ? { rewound: { frameId: frame, at: frame * 100 } } : {}),
      },
      weekend: undefined,
      feed,
      config: {},
      priors: NO_PRIORS,
      track: unknown('notApplicable'),
    };
  };
};

/** A scheduler over one `ourCrossing` unit that reads the crossings, past its first run (which always runs). */
const started = () => {
  const s = sched([quick('c', { reads: ['miniSectors'], cadence: 'ourCrossing' })]);
  const next = feedOf();
  expect(s.run(next([])).ran).toEqual(['c']);
  return { s, next };
};

describe('Scheduler: the ourCrossing cadence', () => {
  it("a frame appending a crossing of the player's car makes it due", () => {
    const { s, next } = started();
    expect(s.run(next([PLAYER])).ran).toEqual(['c']);
  });

  it("a frame appending a crossing of the teammate's car makes it due", () => {
    const { s, next } = started();
    expect(s.run(next([TEAMMATE])).ran).toEqual(['c']);
  });

  it("frames appending only rivals' crossings do not make it due", () => {
    const { s, next } = started();
    expect([[RIVAL], [OTHER, RIVAL], [OTHER]].map((cars) => s.run(next(cars)).ran)).toEqual([[], [], []]);
  });

  it("one of ours after several rivals' frames makes it due: every entry since its last run counts", () => {
    const { s, next } = started();
    s.run(next([RIVAL]));
    s.run(next([OTHER]));
    expect(s.run(next([RIVAL, PLAYER, OTHER])).ran).toEqual(['c']);
    expect(s.run(next([RIVAL])).ran).toEqual([]);
  });

  it('a rewound delta makes it due', () => {
    const { s, next } = started();
    expect(s.run(next([], { rewound: true })).ran).toEqual(['c']);
  });

  it('a rewound delta with only rivals’ crossings makes it due', () => {
    const { s, next } = started();
    expect(s.run(next([RIVAL], { rewound: true })).ran).toEqual(['c']);
  });

  it('no crossing appended: not due', () => {
    const { s, next } = started();
    expect([s.run(next([])).ran, s.run(next([])).ran]).toEqual([[], []]);
  });

  it("over the long race's first lap it sees each of our cars' crossings once, 2 × 50, and runs only on frames that append one", () => {
    const race = longRace();
    const player = carId(0);
    const teammate = carId(1);
    const ours = (c: MiniSectorCrossing): boolean => c.carId === player || c.carId === teammate;
    const seen: number[] = [];
    const s = sched([
      quick('c', {
        reads: ['miniSectors'],
        cadence: 'ourCrossing',
        compute: (v: EngineView) => {
          seen.push(v.history.crossings.slice(v.delta.before.crossings, v.delta.after.crossings).filter(ours).length);
          return seen.length;
        },
      }),
    ]);
    const frames = race.framesOfLap(1);
    const expected: number[] = [];
    const runs: number[] = [];
    let total = 0;
    for (const frame of frames) {
      const view = race.viewAt(frame);
      const { outputs: _outputs, priors: _priors, ...rest } = view;
      const input: SchedulerInput = { ...rest, live: { ...view.live, playerCar: player, teammateCar: teammate }, priors: NO_PRIORS };
      const appended = view.history.crossings.slice(view.delta.before.crossings, view.delta.after.crossings).filter(ours).length;
      total += appended;
      if (appended > 0) expected.push(frame);
      if (s.run(input).ran.includes('c')) runs.push(frame);
    }
    expect(total, "our cars' crossings appended on the leader's first lap").toBe(2 * 50);
    expect(seen.reduce((a, b) => a + b, 0)).toBe(2 * 50);
    expect(runs).toEqual(expected);
    expect(seen.every((n) => n > 0)).toBe(true);
  });
});
