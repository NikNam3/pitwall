import { carId, MINI_SECTORS, type MiniSectorCrossing } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GapsOutput } from '../../src/gaps/index.ts';
import { gapsToCar } from '../../src/gaps/gaps.ts';
import { byTime, plain, progressOf, run, viewOf } from './race.ts';

/**
 * 3 to 5 cars over 1 to 3 laps, each mini-sector 1.7 to 1.9 s and a start up to 3 s late: the field stays within
 * one lap, so no car is lapped.
 */
const raceArb = fc.integer({ min: 3, max: 5 }).chain((cars) =>
  fc.record({
    laps: fc.integer({ min: 1, max: 3 }),
    startsMs: fc.array(fc.integer({ min: 0, max: 3_000 }), { minLength: cars, maxLength: cars }),
    segmentsMs: fc.array(fc.array(fc.integer({ min: 1_700, max: 1_900 }), { minLength: 3 * MINI_SECTORS, maxLength: 3 * MINI_SECTORS }), {
      minLength: cars,
      maxLength: cars,
    }),
    cut: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
);
type Race = { laps: number; startsMs: number[]; segmentsMs: number[][]; cut: number };

const crossingsOf = ({ laps, startsMs, segmentsMs }: Race): MiniSectorCrossing[] =>
  byTime(
    startsMs.flatMap((start, i) => {
      let at = start;
      return Array.from({ length: laps * MINI_SECTORS }, (_, k) => {
        at += segmentsMs[i]![k]!;
        return { carId: carId(i), lap: Math.floor(k / MINI_SECTORS) + 1, segment: k % MINI_SECTORS, at };
      });
    }),
  );

/** The gap of car a behind car b, which must be known. */
const gap = (out: GapsOutput, a: number, b: number): number => {
  const g = gapsToCar(out, carId(b))?.find((x) => x.carId === a)?.gapMs;
  if (g?.known !== true) throw new Error(`gap of ${a} to ${b} is not known: ${JSON.stringify(g)}`);
  return g.value;
};

const pairs = (n: number): [number, number][] =>
  Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => [a, b] as [number, number])).flat().filter(([a, b]) => a !== b);

describe('gap properties', () => {
  it('gap(A,B) = −gap(B,A) at any moment', () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        // from the moment every car has crossed its first mini-sector
        const first = Math.max(...race.startsMs.map((_, i) => all.findIndex((m) => m.carId === i))) + 1;
        const history = all.slice(0, first + Math.floor(race.cut * (all.length - first)));
        const out = run(viewOf(history));
        for (const [a, b] of pairs(race.startsMs.length)) expect(plain(gap(out, a, b) + gap(out, b, a))).toBe(0);
      }),
    );
  });

  it('gap(A,B) is tA(p) − tB(p) at p, the last point both passed, at any moment', () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        const first = Math.max(...race.startsMs.map((_, i) => all.findIndex((m) => m.carId === i))) + 1;
        const history = all.slice(0, first + Math.floor(race.cut * (all.length - first)));
        const time = new Map(history.map((m) => [`${m.carId}:${progressOf(m)}`, m.at]));
        const latest = (car: number) => progressOf(history.findLast((m) => m.carId === car)!);
        const out = run(viewOf(history));
        for (const [a, b] of pairs(race.startsMs.length)) {
          const p = Math.min(latest(a), latest(b));
          expect(plain(gap(out, a, b))).toBe(plain(time.get(`${a}:${p}`)! - time.get(`${b}:${p}`)!));
        }
      }),
    );
  });

  it('gap(A,C) = gap(A,B) + gap(B,C) at a segment all three crossed', () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        // every car's latest crossing is the same mini-sector
        const point = Math.min(race.laps * MINI_SECTORS - 1, Math.floor(race.cut * race.laps * MINI_SECTORS));
        const history = all.filter((m) => progressOf(m) <= point);
        const at = (car: number) => history.findLast((m) => m.carId === car)!.at;
        const out = run(viewOf(history));
        const cars = race.startsMs.length;
        for (const [a, b] of pairs(cars)) {
          expect(plain(gap(out, a, b))).toBe(plain(at(a) - at(b)));
          for (let c = 0; c < cars; c++) {
            if (c === a || c === b) continue;
            expect(plain(gap(out, a, c))).toBe(plain(gap(out, a, b) + gap(out, b, c)));
          }
        }
      }),
    );
  });
});
