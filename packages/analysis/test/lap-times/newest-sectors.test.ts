// `lap-times`, the newest sector times of a board row (live polish spec 3.4, C3, C25, C65): per sector the newest
// finished time, its status against the bests before it, and whether it is older than the car's current pass of its lap.
import { carId, unknown, type CarTiming } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { crossings, field } from '../../../../test-support/builders/index.ts';
import { activeCars, rowOf, restartPass, run, scene, sectorLap } from './scene.ts';

const insufficientData = unknown('insufficientData');
const notApplicable = unknown('notApplicable');

// car 1 holds the session bests 29.0 / 29.8 / 30.5 on lap 1; car 0 has 30.0 / 30.0 / 30.0 on lap 1 and 29.5 / 29.7 / 29.9 on lap 2
const car1Lap1 = sectorLap(1, 1, [29_000, 29_800, 30_500], 89_300);
const car0Lap1 = sectorLap(0, 1, [30_000, 30_000, 30_000], 90_000);
const car0Lap2 = sectorLap(0, 2, [29_500, 29_700, 29_900], 179_500);

/** The two cars with car 0's live timing as given (car 1 stays on lap 2, sector 1). */
const cars = (timing: Partial<CarTiming>) => activeCars(2, { 0: timing, 1: { lap: 2, sector: 1 } });
const valueOf = (k: unknown): number | undefined => (k as { known: boolean; value?: number }).known ? (k as { value: number }).value : undefined;

describe('lap-times newest sectors', () => {
  it('row S1: sector 1 appears when the car passes sector 2 start, with its status against the bests before it', () => {
    const row = (s1: number) => rowOf(run(scene({ laps: [car1Lap1, car0Lap1], cars: cars({ lap: 2, sector: 2, sector1TimeMs: s1 }) })), 0)!;
    // 29.5 beats car 0's 30.0, not car 1's 29.0
    expect(valueOf(row(29_500).newestSectorsMs[0])).toBe(29_500);
    expect(row(29_500).newestSectorStatus[0]).toBe('personalBest');
    expect(row(29_500).newestSectorOlder[0]).toBe(false);
    // 31.0 beats nothing
    expect(row(31_000).newestSectorStatus[0]).toBe('none');
    // sectors 2 and 3 are still those of lap 1, older
    const r = row(29_500);
    expect(r.newestSectorsMs.slice(1).map(valueOf)).toEqual([30_000, 30_000]);
    expect(r.newestSectorOlder).toEqual([false, true, true]);
  });

  it('row S2: sector 2 appears when the car passes sector 3 start', () => {
    const view = scene({ laps: [car1Lap1, car0Lap1], cars: cars({ lap: 2, sector: 3, sector1TimeMs: 29_500, sector2TimeMs: 29_700 }) });
    const r = rowOf(run(view), 0)!;
    expect(r.newestSectorsMs.map(valueOf)).toEqual([29_500, 29_700, 30_000]);
    // 29.7 beats car 1's session-best 29.8
    expect(r.newestSectorStatus.slice(0, 2)).toEqual(['personalBest', 'sessionBest']);
    expect(r.newestSectorOlder).toEqual([false, false, true]);
  });

  it('row line: at the line all three times are those of the lap just finished, judged as the lap record is', () => {
    const view = scene({ laps: [car1Lap1, car0Lap1, car0Lap2], cars: cars({ lap: 3, sector: 1, sector1TimeMs: 0, sector2TimeMs: 0 }) });
    const r = rowOf(run(view), 0)!;
    expect(r.newestSectorsMs.map(valueOf)).toEqual([29_500, 29_700, 29_900]);
    expect(r.newestSectorStatus).toEqual(r.lastSectorStatus);
    expect(r.newestSectorStatus).toEqual(['personalBest', 'sessionBest', 'sessionBest']);
    expect(r.newestSectorOlder).toEqual([false, false, false]);
    // `lastSectorsMs` stays for the other readers
    expect(r.lastSectorsMs.map(valueOf)).toEqual([29_500, 29_700, 29_900]);
  });

  it("row after the line: S2 and S3 of the previous lap stay, older; the new lap's S1 replaces S1, not older", () => {
    const view = scene({ laps: [car1Lap1, car0Lap1, car0Lap2], cars: cars({ lap: 3, sector: 2, sector1TimeMs: 29_400 }) });
    const r = rowOf(run(view), 0)!;
    expect(r.newestSectorsMs.map(valueOf)).toEqual([29_400, 29_700, 29_900]);
    expect(r.newestSectorStatus[0]).toBe('personalBest');
    expect(r.newestSectorStatus.slice(1)).toEqual(r.lastSectorStatus.slice(1));
    expect(r.newestSectorOlder).toEqual([false, true, true]);
  });

  it('row session-best S1 mid-lap: sessionBest at once', () => {
    const view = scene({ laps: [car1Lap1, car0Lap1], cars: cars({ lap: 2, sector: 2, sector1TimeMs: 28_900 }) });
    expect(rowOf(run(view), 0)!.newestSectorStatus[0]).toBe('sessionBest');
  });

  describe('row garage restart (same lap number, practice)', () => {
    const five = field({ cars: 1, laps: 5, paceMs: 100_000 });
    // lap 6 first pass: from 500 s to segment 20, then the garage; the restart's line at 700 s repeats (6, 0)
    const first = [...five.crossings, ...crossings(carId(0), 6, 100_000, 500_000).slice(1, 21)];
    const restarted = (segment: number) => restartPass(first, 0, 6, 98_000, 700_000, segment);

    it("the S1 of the attempt before the restart is older on the restarted pass's sector 1", () => {
      const miniSectors = [...first, ...restarted(5)];
      const view = scene({ laps: five.laps, miniSectors, cars: activeCars(1, { 0: { lap: 6, sector: 1, sector1TimeMs: 28_000 } }), sessionTime: 700_000 + 9_800 });
      const r = rowOf(run(view), 0)!;
      expect(valueOf(r.newestSectorsMs[0])).toBe(28_000);
      expect(r.newestSectorOlder[0]).toBe(true);
    });

    it("the restarted pass's own S1 is not older once it has passed sector 2's start", () => {
      const miniSectors = [...first, ...restarted(20)];
      const view = scene({ laps: five.laps, miniSectors, cars: activeCars(1, { 0: { lap: 6, sector: 2, sector1TimeMs: 27_500 } }), sessionTime: 700_000 + 39_200 });
      const r = rowOf(run(view), 0)!;
      expect(valueOf(r.newestSectorsMs[0])).toBe(27_500);
      expect(r.newestSectorOlder[0]).toBe(false);
    });
  });

  describe('row lap validity', () => {
    /** Car 0 passes sector 2's start with an S1 faster than every best, its lap-validity span `kind`. */
    const withValidity = (kind: 'valid' | 'invalid') => {
      const view = scene({ laps: [car1Lap1, car0Lap1], cars: cars({ lap: 2, sector: 2, sector1TimeMs: 28_900 }) });
      const span = { machine: 'lap-validity', id: 0, carId: carId(0), kind, start: 0, confirmed: true, detail: undefined, startFrame: 1 };
      const withSpan = { ...view, situation: { ...view.situation, byMachine: { ...view.situation.byMachine, 'lap-validity': [span] } } };
      return rowOf(run(withSpan), 0)!;
    };

    it('a live sector of an invalid lap has status none; the time itself still shows', () => {
      const r = withValidity('invalid');
      expect(valueOf(r.newestSectorsMs[0])).toBe(28_900);
      expect(r.newestSectorStatus[0]).toBe('none');
    });

    it('the same time on a valid lap is sessionBest (as row session-best S1 mid-lap)', () => {
      expect(withValidity('valid').newestSectorStatus[0]).toBe('sessionBest');
    });
  });

  describe('row no live sector times', () => {
    it('a car on its first lap before any sector keeps unknown with the reason', () => {
      const r = rowOf(run(scene({ cars: activeCars(1, { 0: { lap: 1, sector: 1 } }) })), 0)!;
      expect(r.newestSectorsMs).toEqual([insufficientData, insufficientData, insufficientData]);
      expect(r.newestSectorStatus).toEqual(['none', 'none', 'none']);
    });

    it('a car with only sector 1 known keeps the others unknown', () => {
      const r = rowOf(run(scene({ cars: activeCars(1, { 0: { lap: 1, sector: 2, sector1TimeMs: 30_000 } }) })), 0)!;
      expect(r.newestSectorsMs[0]).toMatchObject({ known: true });
      expect(valueOf(r.newestSectorsMs[0])).toBe(30_000);
      expect(r.newestSectorsMs.slice(1)).toEqual([insufficientData, insufficientData]);
    });

    it('a car out of the race has notApplicable, as its other times', () => {
      const r = rowOf(run(scene({ cars: activeCars(1, { 0: { lap: 1, sector: 1 } }), kinds: { 0: { status: 'retired' } } })), 0)!;
      expect(r.outOfRace).toBe(true);
      expect(r.newestSectorsMs).toEqual([notApplicable, notApplicable, notApplicable]);
    });
  });
});
