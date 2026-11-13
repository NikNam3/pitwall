// The `ourLap` change trigger (SP4.3b spec §8.1; 4.3b1 Task 20, delegated engine-core change, C78; C30, C40): an
// `onChange` unit with `ourLap` runs when the projection's laps gained a lap record of one of our cars (the player's or
// the teammate's, a line crossing) since it last ran; a mini-sector crossing without a line crossing, or a rival's
// lap record, does not make it due.
import { describe, expect, it } from 'vitest';
import { carId, unknown, type CarId, type LapRecord, type MiniSectorCrossing } from '@pitwall/domain';
import { lap, NO_DRIVERS, NO_PRIORS } from '../../../../test-support/builders/index.ts';
import type { SchedulerInput } from '../../src/index.ts';
import { feed, len, quick, RACING, sched } from '../support/scheduler.ts';

const PLAYER = carId(3);
const TEAMMATE = carId(7);
const RIVAL = carId(11);

/**
 * A feed of frames: each appends the given cars' lap records to `laps` (setting `laps`) and the given cars' mini-sector
 * crossings to `crossings` (setting `miniSectors`).
 */
const feedOf = () => {
  const laps: LapRecord[] = [];
  const crossings: MiniSectorCrossing[] = [];
  let frame = 0;
  return (o: { laps?: CarId[]; crossings?: CarId[] } = {}): SchedulerInput => {
    frame += 1;
    const before = { laps: laps.length, crossings: crossings.length };
    for (const car of o.laps ?? []) laps.push(lap({ carId: car, positionAtEnd: 5, frame }));
    for (const car of o.crossings ?? []) crossings.push({ carId: car, lap: 1, segment: frame % 50, at: frame * 100, frame });
    const changed = new Set<string>([...((o.laps ?? []).length > 0 ? ['laps'] : []), ...((o.crossings ?? []).length > 0 ? ['miniSectors'] : [])]);
    return {
      live: { feedId: 'f1', sessionTime: frame * 100, playerCar: PLAYER, teammateCar: TEAMMATE, cars: [] } as never,
      situation: RACING,
      history: { laps: [...laps], crossings: [...crossings], decisions: [] } as never,
      changed: changed as never,
      delta: { before: len(before), after: len({ laps: laps.length, crossings: crossings.length }) },
      weekend: undefined,
      feed,
      config: {},
      priors: NO_PRIORS,
      drivers: NO_DRIVERS,
      track: unknown('notApplicable'),
    };
  };
};

/** A scheduler over one `{ onChange: ['ourLap'] }` unit reading the laps, past its first run (which always runs). */
const started = () => {
  const s = sched([quick('c', { reads: ['laps', 'miniSectors'], cadence: { onChange: ['ourLap'] } })]);
  const next = feedOf();
  expect(s.run(next()).ran).toEqual(['c']);
  return { s, next };
};

describe('Scheduler: the ourLap change trigger', () => {
  it('ourLap fires on a lap record of one of our cars', () => {
    const { s, next } = started();
    expect(s.run(next({ laps: [PLAYER] })).ran).toEqual(['c']);
    expect(s.run(next({ laps: [TEAMMATE] })).ran).toEqual(['c']);
    // among rivals' records, and pending while the unit was not needed
    expect(s.run(next({ laps: [RIVAL, TEAMMATE] })).ran).toEqual(['c']);
    s.setNeeded([]);
    s.run(next({ laps: [PLAYER] }));
    s.setNeeded(['c']);
    expect(s.run(next()).ran).toEqual(['c']);
    expect(s.run(next()).ran).toEqual([]);
  });

  it('a mini-sector crossing without a line crossing does not fire ourLap', () => {
    const { s, next } = started();
    expect([s.run(next({ crossings: [PLAYER] })).ran, s.run(next({ crossings: [TEAMMATE, PLAYER] })).ran]).toEqual([[], []]);
  });

  it("a rival's lap record does not fire ourLap", () => {
    const { s, next } = started();
    expect([s.run(next({ laps: [RIVAL] })).ran, s.run(next({ laps: [RIVAL], crossings: [PLAYER] })).ran]).toEqual([[], []]);
  });
});
