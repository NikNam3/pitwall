import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crossings as lapCrossings, field } from '../../../test-support/builders/index.ts';
import { carId, currentCrossings, currentCrossingTimes, foldCurrentCrossing, type CrossingIndex, type FactRef, type MiniSectorCrossing } from '../src/index.ts';

const crossing = (car: number, lap: number, segment: number, at: number, supersedes?: number): MiniSectorCrossing => ({
  carId: carId(car),
  lap,
  segment,
  at: at as MiniSectorCrossing['at'],
  frame: at as MiniSectorCrossing['frame'],
  ...(supersedes === undefined ? {} : { supersedes: { list: 'crossings', index: supersedes } satisfies FactRef }),
});

describe('currentCrossings', () => {
  it('keeps a crossing no one supersedes', () => {
    const list = [crossing(0, 2, 3, 100), crossing(1, 2, 3, 110)];
    expect(currentCrossings(list)).toEqual(list);
  });

  it('drops a crossing a later crossing names', () => {
    const list = [crossing(0, 2, 3, 100), crossing(0, 2, 3, 200, 0)];
    expect(currentCrossings(list)).toEqual([list[1]]);
  });

  it('keeps log order', () => {
    const list = [crossing(0, 2, 3, 100), crossing(1, 2, 3, 110), crossing(0, 2, 4, 120), crossing(1, 2, 3, 130, 1)];
    expect(currentCrossings(list)).toEqual([list[0], list[2], list[3]]);
  });

  it('gives an empty list for an empty list', () => {
    expect(currentCrossings([])).toEqual([]);
  });
});

describe('foldCurrentCrossing', () => {
  const folded = (list: readonly MiniSectorCrossing[]): CrossingIndex => {
    const index: CrossingIndex = new Map();
    for (const c of list) foldCurrentCrossing(index, c);
    return index;
  };
  const flatten = (index: CrossingIndex): MiniSectorCrossing[] => {
    const out: MiniSectorCrossing[] = [];
    for (const byLap of index.values()) for (const slots of byLap.values()) for (const c of slots) if (c !== undefined) out.push(c);
    return out;
  };
  const key = (c: MiniSectorCrossing): string => `${c.carId}/${c.lap}/${c.segment}`;
  const sorted = (list: readonly MiniSectorCrossing[]): MiniSectorCrossing[] => [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

  it('replaces the superseded crossing in its slot', () => {
    const list = [crossing(0, 2, 3, 100), crossing(0, 2, 3, 200, 0)];
    expect(folded(list).get(carId(0))?.get(2)?.[3]).toEqual(list[1]);
  });

  it('equals currentCrossings by car, lap and segment (property)', () => {
    const step = fc.record({ car: fc.integer({ min: 0, max: 2 }), lap: fc.integer({ min: 1, max: 3 }), segment: fc.integer({ min: 0, max: 4 }) });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const list: MiniSectorCrossing[] = [];
        const latest = new Map<string, number>();
        steps.forEach((s, i) => {
          const k = `${s.car}/${s.lap}/${s.segment}`;
          list.push(crossing(s.car, s.lap, s.segment, 100 + i, latest.get(k)));
          latest.set(k, i);
        });
        const current = currentCrossings(list);
        expect(current).toHaveLength(latest.size);
        expect(sorted(flatten(folded(list)))).toEqual(sorted(current));
      }),
    );
  });
});

describe('currentCrossingTimes', () => {
  /** What the typed array must hold, cell by cell, from `currentCrossings`: the matching entry's `at`, NaN where none. */
  const expected = (list: readonly MiniSectorCrossing[], cars: number, laps: number, segments: readonly number[]): number[] => {
    const current = currentCrossings(list);
    const cells: number[] = [];
    for (let car = 0; car < cars; car++)
      for (let lap = 0; lap <= laps; lap++)
        for (const segment of segments) cells.push(current.find((c) => c.carId === car && c.lap === lap && c.segment === segment)?.at ?? NaN);
    return cells;
  };
  const cell = (times: Float64Array, car: number, lap: number, k: number, laps: number, chosen: number): number | undefined =>
    times[(car * (laps + 1) + lap) * chosen + k];

  it('currentCrossingTimes equals currentCrossings for every chosen cell', () => {
    const { crossings: base } = field({ cars: 3, laps: 4, paceMs: 90_000 });
    // Car 1 restarts lap 2 and car 2 lap 4: each restarted crossing names the earlier one of its (car, lap, segment) (C25).
    const list: MiniSectorCrossing[] = [...base];
    for (const [car, lap, startAt] of [[1, 2, 500_000], [2, 4, 600_000]] as const) {
      for (const c of lapCrossings(carId(car), lap, 95_000, startAt)) {
        const earlier = list.findIndex((e) => e.carId === c.carId && e.lap === c.lap && e.segment === c.segment);
        list.push({ ...c, supersedes: { list: 'crossings', index: earlier } });
      }
    }
    const segments = [0, 10, 25, 49];
    const times = currentCrossingTimes(list, 3, 5, segments);
    expect(times).toBeInstanceOf(Float64Array);
    expect(times).toHaveLength(3 * 6 * segments.length);
    expect(Array.from(times)).toEqual(expected(list, 3, 5, segments));
    expect(cell(times, 1, 2, 1, 5, segments.length)).toBe(500_000 + Math.round((10 * 95_000) / 50));
    expect(cell(times, 0, 0, 0, 5, segments.length)).toBeNaN();
    expect(cell(times, 2, 5, 0, 5, segments.length)).toBe(360_000);
    expect(cell(times, 2, 5, 1, 5, segments.length)).toBeNaN();
  });

  it('a later crossing of the same car, lap and segment supersedes the earlier', () => {
    const list = [crossing(0, 2, 3, 100), crossing(0, 2, 3, 200, 0)];
    const times = currentCrossingTimes(list, 1, 2, [3]);
    expect(times).toHaveLength(3);
    expect(cell(times, 0, 2, 0, 2, 1)).toBe(200);
    expect(cell(times, 0, 0, 0, 2, 1)).toBeNaN();
    expect(cell(times, 0, 1, 0, 2, 1)).toBeNaN();
  });

  it('segments not chosen are not stored; car or lap out of range is ignored', () => {
    const list = [
      crossing(0, 1, 7, 100), // segment not chosen
      crossing(2, 1, 3, 110), // car out of range (cars = 2)
      crossing(1, 3, 3, 120), // lap out of range (laps = 2)
      crossing(1, 2, 3, 130), // in range: stored
      crossing(0, 0, 9, 140), // in range, second chosen segment
    ];
    const times = currentCrossingTimes(list, 2, 2, [3, 9]);
    expect(times).toHaveLength(2 * 3 * 2);
    const stored = Array.from(times).map((t, i) => [i, t] as const).filter(([, t]) => !Number.isNaN(t));
    expect(stored).toEqual([
      [(0 * 3 + 0) * 2 + 1, 140],
      [(1 * 3 + 2) * 2 + 0, 130],
    ]);
    expect(Array.from(currentCrossingTimes([], 2, 2, [3, 9])).every(Number.isNaN)).toBe(true);
  });

  it('agrees with currentCrossings on every cell for random crossing lists (property)', () => {
    const step = fc.record({ car: fc.integer({ min: 0, max: 3 }), lap: fc.integer({ min: 0, max: 4 }), segment: fc.integer({ min: 0, max: 5 }) });
    fc.assert(
      fc.property(
        fc.array(step, { maxLength: 60 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 4 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { maxLength: 6 }),
        (steps, cars, laps, segments) => {
          const list: MiniSectorCrossing[] = [];
          const latest = new Map<string, number>();
          steps.forEach((s, i) => {
            const k = `${s.car}/${s.lap}/${s.segment}`;
            list.push(crossing(s.car, s.lap, s.segment, 100 + i, latest.get(k)));
            latest.set(k, i);
          });
          const times = currentCrossingTimes(list, cars, laps, segments);
          expect(times).toHaveLength(cars * (laps + 1) * segments.length);
          expect(Array.from(times)).toEqual(expected(list, cars, laps, segments));
        },
      ),
    );
  });
});
