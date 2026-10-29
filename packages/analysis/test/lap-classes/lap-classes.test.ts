import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyLap } from '../../src/lap-classes/index.ts';
import { lap } from '../../../../test-support/builders/index.ts';

const race = { isRace: true };
const practice = { isRace: false };

describe('classifyLap', () => {
  it('a clean lap counts for pace, rate and best', () => {
    expect(classifyLap(lap({ lapNumber: 3 }), race)).toEqual({
      forPace: true,
      forRate: true,
      forBest: { lap: true, sectors: [true, true, true] },
    });
  });

  it('in lap and out lap count for neither pace nor rate', () => {
    for (const over of [{ inLap: true }, { outLap: true }]) {
      const c = classifyLap(lap({ lapNumber: 3, ...over }), race);
      expect(c.forPace).toBe(false);
      expect(c.forRate).toBe(false);
    }
  });

  it('a lap with scShare 0.1 or vscShare 0.1 counts for neither pace nor rate', () => {
    for (const over of [{ scShare: 0.1 }, { vscShare: 0.1 }]) {
      const c = classifyLap(lap({ lapNumber: 3, ...over }), race);
      expect(c.forPace).toBe(false);
      expect(c.forRate).toBe(false);
    }
  });

  it('an invalid lap counts for rate but not for pace or best; its valid sectors count for best', () => {
    const c = classifyLap(lap({ lapNumber: 3, valid: { lap: false, sectors: [true, false, true] } }), race);
    expect(c.forRate).toBe(true);
    expect(c.forPace).toBe(false);
    expect(c.forBest).toEqual({ lap: false, sectors: [true, false, true] });
  });

  it('lap 1 of a race is not a pace lap; lap 1 of practice is', () => {
    expect(classifyLap(lap({ lapNumber: 1 }), race).forPace).toBe(false);
    expect(classifyLap(lap({ lapNumber: 1 }), race).forRate).toBe(true);
    expect(classifyLap(lap({ lapNumber: 1 }), practice).forPace).toBe(true);
    expect(classifyLap(lap({ lapNumber: 2 }), race).forPace).toBe(true);
  });

  it('property: forPace implies forRate', () => {
    fc.assert(
      fc.property(
        fc.record({
          lapNumber: fc.integer({ min: 1, max: 80 }),
          inLap: fc.boolean(),
          outLap: fc.boolean(),
          scShare: fc.double({ min: 0, max: 1, noNaN: true }),
          vscShare: fc.double({ min: 0, max: 1, noNaN: true }),
          valid: fc.record({ lap: fc.boolean(), sectors: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()) }),
        }),
        fc.boolean(),
        (over, isRace) => {
          const c = classifyLap(lap(over), { isRace });
          return !c.forPace || c.forRate;
        },
      ),
    );
  });
});
