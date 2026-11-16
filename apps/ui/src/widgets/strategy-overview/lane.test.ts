// The lap lane of one Field plans row (SP4.3d spec §6.4, V06; README "What is drawn"; the rules of
// docs/design/2026-11-16-sp4.3d/gen.mjs `laneSvg`). The lane places the topic's laps, it judges nothing (C65, C43).
// Contract assumed of `lane.ts`:
//  - `laneOf(row: OverviewRow, ctx: { now: number; flag: number; own: boolean }): Lane`, `own` true on our rows (the
//    link's car and its teammate: the rows with a `plan`); `Lane = { blocks: LaneBlock[]; shades: LaneShade[];
//    marks: number[] }`, in laps (one cell a lap, laps 1…flag), blocks in lap order;
//  - `LaneBlock = { fromLap: number; toLap: number; letter: string; style: 'solid' | 'outline' | 'faint'; role: Role }`
//    (both laps inclusive; `letter` the kit `COMPOUND_MARK` letter, '' for none);
//  - past stints (`pastStints`) solid, each with its letter; then the current stint solid from the lap after the last
//    past stint (lap 1 without one) to `now`, with the letter of `compound`; solid blocks `ownCar` on our rows, `textDim`
//    on a rival's;
//  - our rows: plan A's stints outlined (`ownCar`) from `now + 1`: the first to plan A's first stop lap after now
//    without a letter (the current set runs on), each next one from the lap after a stop to the next stop (the flag for
//    the last), with the letter of the compound fitted at that stop; `marks` the laps of plan B's stops after now (drawn
//    as triangles at the end of that lap); no plan A: no outline; no plan B: no marks; a rival's row has no marks;
//  - a rival with a known `window`: faint (`textFaint`) without a letter from `now + 1` to the lap before `lowLap`
//    (none if `lowLap ≤ now + 1`); `shades` one per lap from `max(lowLap, now + 1)` to `highLap`, each
//    `{ lap, opacity: windowShade(lap, window) }`; then faint from `highLap + 1` to the flag with the letter of the
//    likeliest next compound (the largest chance of `nextCompound`; '' while it is unknown);
//  - a rival without a window (`window` unknown: it has stopped and runs to the flag, or too few laps yet): faint
//    without a letter from `now + 1` to the flag, no shades;
//  - `windowShade(lap: number, window: { lowLap; midLap; highLap }): number`, the shade's opacity in (0, 1] for a lap
//    of the window: darkest (largest) at `midLap`, never darker nearer either end (monotonic towards `midLap`).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OverviewRow } from '@pitwall/domain';
import { FLAG, NOW_LAP, ROWS, policy, row } from './fixtures.ts';
import { laneOf, windowShade } from './lane.ts';

const ctx = (own: boolean, now = NOW_LAP) => ({ now, flag: FLAG, own });
type Block = { fromLap: number; toLap: number; letter: string; style: string; role: string };
type Lane = { blocks: Block[]; shades: { lap: number; opacity: number }[]; marks: number[] };
const blocks = (l: Lane) => l.blocks.map((b: Block) => [b.fromLap, b.toLap, b.letter, b.style, b.role]);
const shadeLaps = (l: Lane) => l.shades.map((s) => s.lap);

describe('laneOf: the mockup\'s rows at L14/44', () => {
  it('NOR: mediums solid to now, faint to the window, the window L16–20 shaded, then faint hards to the flag', () => {
    const l = laneOf(ROWS.NOR, ctx(false));
    expect(blocks(l)).toEqual([
      [1, 14, 'M', 'solid', 'textDim'],
      [15, 15, '', 'faint', 'textFaint'],
      [21, 44, 'H', 'faint', 'textFaint'],
    ]);
    expect(shadeLaps(l)).toEqual([16, 17, 18, 19, 20]);
    expect(l.marks).toEqual([]);
  });

  it('ALO: the past soft stint L1–12 and the current hards L13–14 solid with their letters, then faint to the flag', () => {
    const l = laneOf(ROWS.ALO, ctx(false));
    expect(blocks(l)).toEqual([
      [1, 12, 'S', 'solid', 'textDim'],
      [13, 14, 'H', 'solid', 'textDim'],
      [15, 44, '', 'faint', 'textFaint'],
    ]);
    expect(l.shades).toEqual([]);
  });

  it('GAS: a window that opened before now (L13–17) is shaded from L15 only, no faint block before it', () => {
    const l = laneOf(ROWS.GAS, ctx(false));
    expect(blocks(l)).toEqual([
      [1, 14, 'S', 'solid', 'textDim'],
      [18, 44, 'H', 'faint', 'textFaint'],
    ]);
    expect(shadeLaps(l)).toEqual([15, 16, 17]);
  });

  it('SAI: the next stint carries the likeliest compound (M 60 % over S 40 %)', () => {
    const l = laneOf(ROWS.SAI, ctx(false));
    expect(l.blocks.at(-1)).toMatchObject({ fromLap: 31, toLap: 44, letter: 'M', style: 'faint' });
  });

  it('KUH: our mediums solid white, plan A outlined (L15–22 without a letter, then H to the flag), plan B\'s stops L18 and L33 as marks', () => {
    const l = laneOf(ROWS.KUH, ctx(true));
    expect(blocks(l)).toEqual([
      [1, 14, 'M', 'solid', 'ownCar'],
      [15, 22, '', 'outline', 'ownCar'],
      [23, 44, 'H', 'outline', 'ownCar'],
    ]);
    expect(l.marks).toEqual([18, 33]);
    expect(l.shades).toEqual([]);
  });

  it('LIN: plan A L21 outlined, plan B\'s stops L17 and L32 as marks', () => {
    const l = laneOf(ROWS.LIN, ctx(true));
    expect(blocks(l)).toEqual([
      [1, 14, 'M', 'solid', 'ownCar'],
      [15, 21, '', 'outline', 'ownCar'],
      [22, 44, 'H', 'outline', 'ownCar'],
    ]);
    expect(l.marks).toEqual([17, 32]);
  });
});

describe('laneOf: the rules', () => {
  it('a two-stop plan A: three outlined stints, each next one with the compound fitted at its stop', () => {
    const r: OverviewRow = { ...ROWS.KUH, plan: { a: policy([20, 'hard'], [34, 'soft']), b: null } };
    expect(blocks(laneOf(r, ctx(true))).slice(1)).toEqual([
      [15, 20, '', 'outline', 'ownCar'],
      [21, 34, 'H', 'outline', 'ownCar'],
      [35, 44, 'S', 'outline', 'ownCar'],
    ]);
  });

  it('no plan A: nothing outlined after now; no plan B: no marks', () => {
    const l = laneOf({ ...ROWS.KUH, plan: { a: null, b: null } }, ctx(true));
    expect(blocks(l)).toEqual([[1, 14, 'M', 'solid', 'ownCar']]);
    expect(l.marks).toEqual([]);
  });

  it('only plan B\'s stops after now are marks', () => {
    const l = laneOf({ ...ROWS.KUH, plan: { a: KUH_A_LATE, b: policy([10, 'hard'], [30, 'soft']) } }, ctx(true));
    expect(l.marks).toEqual([30]);
  });

  it('a rival with an unknown window and unknown odds: faint without a letter from now to the flag, no shades', () => {
    const r = row({ carId: ROWS.NOR.carId, position: 6, gap: -1_000, compound: 'medium', tyreAge: 2, window: 'insufficientData', next: 'insufficientData' });
    const l = laneOf(r, ctx(false, 2));
    expect(blocks(l)).toEqual([[1, 2, 'M', 'solid', 'textDim'], [3, 44, '', 'faint', 'textFaint']]);
    expect(l.shades).toEqual([]);
  });

  it('a known window with unknown odds: the stint after it faint without a letter', () => {
    const r: OverviewRow = { ...ROWS.NOR, nextCompound: { known: false, reason: 'insufficientData' } };
    expect(laneOf(r, ctx(false)).blocks.at(-1)).toMatchObject({ fromLap: 21, toLap: 44, letter: '' });
  });

  it('every shade is windowShade of its lap', () => {
    const l = laneOf(ROWS.OCO, ctx(false));
    const w = { lowLap: 20, midLap: 23, highLap: 26 };
    expect(l.shades).toEqual([20, 21, 22, 23, 24, 25, 26].map((lap) => ({ lap, opacity: windowShade(lap, w) })));
  });
});

const KUH_A_LATE = policy([22, 'hard']);

describe('windowShade: darkest at midLap, monotonic towards it', () => {
  it('the mockup\'s NOR window L16–18–20: rising to L18, falling after, symmetric', () => {
    const w = { lowLap: 16, midLap: 18, highLap: 20 };
    const o = [16, 17, 18, 19, 20].map((lap) => windowShade(lap, w));
    expect(o[0]).toBeLessThan(o[1]!);
    expect(o[1]).toBeLessThan(o[2]!);
    expect(o[3]).toBeLessThan(o[2]!);
    expect(o[4]).toBeLessThan(o[3]!);
    expect(o[0]).toBeCloseTo(o[4]!, 9);
  });

  it('property: over random windows every opacity is in (0, 1], the largest at midLap, non-decreasing up to it and non-increasing after it', () => {
    const arb = fc
      .record({ low: fc.integer({ min: 1, max: 70 }), a: fc.integer({ min: 0, max: 10 }), b: fc.integer({ min: 0, max: 10 }) })
      .map(({ low, a, b }) => ({ lowLap: low, midLap: low + a, highLap: low + a + b }));
    fc.assert(
      fc.property(arb, (w) => {
        const laps = Array.from({ length: w.highLap - w.lowLap + 1 }, (_, i) => w.lowLap + i);
        const o = laps.map((lap) => windowShade(lap, w));
        for (const x of o) {
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThanOrEqual(1);
        }
        const mid = windowShade(w.midLap, w);
        for (const x of o) expect(x).toBeLessThanOrEqual(mid);
        laps.forEach((lap, i) => {
          if (i === 0) return;
          if (lap <= w.midLap) expect(o[i]!).toBeGreaterThanOrEqual(o[i - 1]!);
          else expect(o[i]!).toBeLessThanOrEqual(o[i - 1]!);
        });
      }),
      { numRuns: 300 },
    );
  });
});
