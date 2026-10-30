// The shared damage jump grouping (`shared/damage-jumps.ts`): from the history's `damageChange` events to the jumps per
// car (rises of one part within the window adding up to `jumpPct`) and the repairs (falls) per car and part. `damage`
// (the card and the alarm) and `incidents` (the feed, a log) both read it.
import { carId, type CarId, type DamageParts, type RaceEvent } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { event } from '../../../../test-support/builders/index.ts';
import { damageJumps } from '../../src/shared/damage-jumps.ts';

const car0 = carId(0);
const car1 = carId(1);
/** The `damage` config defaults: 5 % within 2000 ms. */
const opts = { jumpPct: 5, jumpWindowMs: 2000 };

const dmg = (at: number, part: keyof DamageParts, fromPct: number, toPct: number, id: CarId = car0): RaceEvent =>
  event({ kind: 'damageChange', carId: id, at, params: { part, fromPct, toPct } });

const jumpsOf = (events: RaceEvent[], id: CarId = car0, o = opts) => damageJumps(events, o).jumps.get(id) ?? [];

describe('damageJumps', () => {
  it('a rise of at least jumpPct is a jump of that car and part, at the event, with its rise', () => {
    const result = damageJumps([dmg(10_000, 'frontLeftWingPct', 0, 12)], opts);
    expect(result.jumps).toEqual(new Map([[car0, [{ at: 10_000, part: 'frontLeftWingPct', deltaPct: 12 }]]]));
    expect(result.repairs.get(car0)?.size ?? 0).toBe(0);
  });

  it('a rise below jumpPct alone is no jump', () => {
    expect(jumpsOf([dmg(10_000, 'floorPct', 0, 4)])).toEqual([]);
  });

  it('rises of one part within the window add up: the jump is at the event that reached jumpPct, with their sum', () => {
    const jumps = jumpsOf([dmg(10_000, 'floorPct', 0, 3), dmg(11_500, 'floorPct', 3, 6)]);
    expect(jumps).toEqual([{ at: 11_500, part: 'floorPct', deltaPct: 6 }]);
  });

  it('the window runs from the first rise: exactly jumpWindowMs later is in, one ms more is out', () => {
    expect(jumpsOf([dmg(10_000, 'floorPct', 0, 3), dmg(12_000, 'floorPct', 3, 6)])).toEqual([{ at: 12_000, part: 'floorPct', deltaPct: 6 }]);
    expect(jumpsOf([dmg(10_000, 'floorPct', 0, 3), dmg(12_001, 'floorPct', 3, 6)])).toEqual([]);
  });

  it('a rise out of the window starts a new window: it adds up with the rises after it, not with the one before', () => {
    const events = [dmg(10_000, 'floorPct', 0, 3), dmg(13_000, 'floorPct', 3, 6), dmg(14_000, 'floorPct', 6, 8)];
    expect(jumpsOf(events)).toEqual([{ at: 14_000, part: 'floorPct', deltaPct: 5 }]);
  });

  it('a jump closes its window: a small rise right after it is no second jump', () => {
    const events = [dmg(10_000, 'floorPct', 0, 6), dmg(10_500, 'floorPct', 6, 9)];
    expect(jumpsOf(events)).toEqual([{ at: 10_000, part: 'floorPct', deltaPct: 6 }]);
  });

  it('rises of two parts never add up: each part has its own window', () => {
    const events = [dmg(10_000, 'floorPct', 0, 3), dmg(10_500, 'rearWingPct', 0, 3)];
    expect(jumpsOf(events)).toEqual([]);
    const both = [dmg(10_000, 'rearWingPct', 0, 8), dmg(10_500, 'floorPct', 0, 6)];
    expect(jumpsOf(both)).toEqual([
      { at: 10_000, part: 'rearWingPct', deltaPct: 8 },
      { at: 10_500, part: 'floorPct', deltaPct: 6 },
    ]);
  });

  it('each car has its own jumps; rises of two cars never add up', () => {
    const events = [dmg(10_000, 'floorPct', 0, 3, car0), dmg(10_500, 'floorPct', 0, 3, car1), dmg(11_000, 'floorPct', 0, 9, car1)];
    const result = damageJumps(events, opts);
    expect(result.jumps.get(car0) ?? []).toEqual([]);
    expect(result.jumps.get(car1)).toEqual([{ at: 11_000, part: 'floorPct', deltaPct: 9 }]);
  });

  it('jumps of a car are in the order of the events', () => {
    const events = [dmg(10_000, 'rearWingPct', 0, 10), dmg(130_000, 'diffuserPct', 0, 7), dmg(200_000, 'rearWingPct', 10, 20)];
    expect(jumpsOf(events).map((j) => j.at)).toEqual([10_000, 130_000, 200_000]);
  });

  it('jumpPct and jumpWindowMs come from the options', () => {
    expect(jumpsOf([dmg(10_000, 'floorPct', 0, 3)], car0, { jumpPct: 3, jumpWindowMs: 2000 })).toHaveLength(1);
    const two = [dmg(10_000, 'floorPct', 0, 3), dmg(14_000, 'floorPct', 3, 6)];
    expect(jumpsOf(two)).toEqual([]);
    expect(jumpsOf(two, car0, { jumpPct: 5, jumpWindowMs: 5000 })).toEqual([{ at: 14_000, part: 'floorPct', deltaPct: 6 }]);
  });

  it('other events and events without a car are ignored', () => {
    const events = [
      event({ kind: 'collision', carId: car0, otherCarId: car1, at: 9_000 }),
      event({ kind: 'damageChange', at: 9_500, params: { part: 'floorPct', fromPct: 0, toPct: 50 } }),
      dmg(10_000, 'floorPct', 0, 7),
    ];
    const result = damageJumps(events, opts);
    expect([...result.jumps.keys()]).toEqual([car0]);
    expect(result.jumps.get(car0)).toEqual([{ at: 10_000, part: 'floorPct', deltaPct: 7 }]);
  });

  describe('repairs (a fall of a part)', () => {
    it('a fall is a repair of that car and part at its time; a partial fall too', () => {
      const events = [dmg(10_000, 'frontRightWingPct', 0, 40), dmg(200_000, 'frontRightWingPct', 40, 0), dmg(300_000, 'floorPct', 30, 10, car1)];
      const { repairs } = damageJumps(events, opts);
      expect(repairs.get(car0)).toEqual(new Map([['frontRightWingPct', [200_000]]]));
      expect(repairs.get(car1)).toEqual(new Map([['floorPct', [300_000]]]));
    });

    it("the function keeps every jump: the user's case of three hits and three wing changes gives three jumps and three repairs", () => {
      const events = [
        dmg(100_000, 'frontRightWingPct', 0, 37),
        dmg(150_000, 'frontRightWingPct', 37, 0),
        dmg(200_000, 'frontRightWingPct', 0, 33),
        dmg(250_000, 'frontRightWingPct', 33, 0),
        dmg(300_000, 'frontRightWingPct', 0, 30),
        dmg(350_000, 'frontRightWingPct', 30, 0),
      ];
      const { jumps, repairs } = damageJumps(events, opts);
      expect(jumps.get(car0)).toEqual([
        { at: 100_000, part: 'frontRightWingPct', deltaPct: 37 },
        { at: 200_000, part: 'frontRightWingPct', deltaPct: 33 },
        { at: 300_000, part: 'frontRightWingPct', deltaPct: 30 },
      ]);
      expect(repairs.get(car0)).toEqual(new Map([['frontRightWingPct', [150_000, 250_000, 350_000]]]));
    });

    it('a repair between two rises within the window: they do not add up (the repair closes the window)', () => {
      // without the repair the two rises would add up to a 6 % jump
      const events = [dmg(10_000, 'floorPct', 0, 3), dmg(10_500, 'floorPct', 3, 0), dmg(11_000, 'floorPct', 0, 3)];
      const { jumps, repairs } = damageJumps(events, opts);
      expect(jumps.get(car0) ?? []).toEqual([]);
      expect(repairs.get(car0)).toEqual(new Map([['floorPct', [10_500]]]));
    });

    it('a repair between two hits keeps both jumps, the second with its rise from the repaired value', () => {
      const events = [dmg(10_000, 'frontRightWingPct', 0, 40), dmg(11_000, 'frontRightWingPct', 40, 0), dmg(11_500, 'frontRightWingPct', 0, 12)];
      expect(jumpsOf(events)).toEqual([
        { at: 10_000, part: 'frontRightWingPct', deltaPct: 40 },
        { at: 11_500, part: 'frontRightWingPct', deltaPct: 12 },
      ]);
    });

    it('a repair of one part leaves the window of another part of the car open', () => {
      const events = [dmg(10_000, 'floorPct', 0, 3), dmg(10_500, 'rearWingPct', 20, 0), dmg(11_000, 'floorPct', 3, 6)];
      expect(jumpsOf(events)).toEqual([{ at: 11_000, part: 'floorPct', deltaPct: 6 }]);
    });

    it("a repair of one car's part leaves the same part of another car alone", () => {
      const events = [dmg(10_000, 'floorPct', 0, 3, car0), dmg(10_500, 'floorPct', 9, 0, car1), dmg(11_000, 'floorPct', 3, 6, car0)];
      const { jumps, repairs } = damageJumps(events, opts);
      expect(jumps.get(car0)).toEqual([{ at: 11_000, part: 'floorPct', deltaPct: 6 }]);
      expect(repairs.get(car0)?.size ?? 0).toBe(0);
    });
  });

  it('is pure: the same events give the same result, and a prefix of the events gives the result of that prefix', () => {
    const events = [dmg(10_000, 'floorPct', 0, 3), dmg(11_000, 'floorPct', 3, 7), dmg(50_000, 'floorPct', 7, 0), dmg(60_000, 'rearWingPct', 0, 9)];
    expect(damageJumps(events, opts)).toEqual(damageJumps([...events], opts));
    expect(damageJumps(events.slice(0, 2), opts).jumps).toEqual(new Map([[car0, [{ at: 11_000, part: 'floorPct', deltaPct: 7 }]]]));
  });
});
