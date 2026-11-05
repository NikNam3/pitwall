import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { carId, currentCrossings, foldCurrentCrossing, type CrossingIndex, type FactRef, type MiniSectorCrossing } from '../src/index.ts';

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
