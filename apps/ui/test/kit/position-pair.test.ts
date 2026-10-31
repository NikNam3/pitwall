// The before/after position pair of an incident, as cell parts (review 5, R5; review 6, R6-3). Contract of
// `positionPairParts(from, to)` in src/kit/values/position-mark.ts (pure; it replaces `positionPairText`):
//  - `from` and `to` are each a `Known<number>`; the result is the kit grid's `CellPart[]`;
//  - both known: `P5→P4` in the kit position format, `—` (`positionUnchanged`) when the position held;
//  - an unknown side is its mark in its own part (`{ text: '', reason }`), and the known side still shows: `P5→…`,
//    `…→P4`; the arrow is notation and stays when both sides are unknown (as the incident feed's gap pair);
//  - an unknown side never reads as held: no `—` unless both sides are known and equal;
//  - `positionUnchanged` is fixed UI text: it lives in kit/text.ts, and position-mark.ts does not re-export it.
import { known, unknown, type Known } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { CellPart } from '../../src/kit/grid/grid.ts';
import { positionUnchanged } from '../../src/kit/text.ts';
import * as positionMark from '../../src/kit/values/position-mark.ts';
import { positionPairParts } from '../../src/kit/values/position-mark.ts';

const k = (v: number): Known<number> => known(v, 0);
/** The parts as one line, `‹reason›` at each mark. */
const marked = (parts: readonly CellPart[]): string => parts.map((p) => (p.reason === undefined ? p.text : `‹${p.reason}›`)).join('');
/** The pair's parts as one line, after checking that each mark stands alone in its part. */
const pair = (from: Known<number>, to: Known<number>): string => {
  const parts = positionPairParts(from, to);
  expect(parts.filter((p) => p.reason !== undefined).every((p) => p.text === ''), 'a mark stands alone in its part').toBe(true);
  return marked(parts);
};

describe('positionPairParts: every known/unknown combination of before and after', () => {
  it('both known: the pair in the kit position format, no mark', () => {
    expect(pair(k(5), k(4))).toBe('P5→P4');
    expect(pair(k(12), k(14))).toBe('P12→P14');
  });

  it('both known and equal: the position held', () => {
    expect(pair(k(5), k(5))).toBe(positionUnchanged);
    expect(positionUnchanged).toBe('—');
  });

  it('the held mark is kit text, read from kit/text.ts only', () => {
    expect('positionUnchanged' in positionMark).toBe(false);
  });

  it('after unknown: the position before, the arrow, then the after\'s mark', () => {
    expect(pair(k(5), unknown('insufficientData'))).toBe('P5→‹insufficientData›');
  });

  it('before unknown: the before\'s mark, the arrow, then the known position after (…→P4)', () => {
    expect(pair(unknown('notReceived'), k(4))).toBe('‹notReceived›→P4');
  });

  it('both unknown: the arrow stays between the two marks, each with its own reason', () => {
    expect(pair(unknown('notReceived'), unknown('insufficientData'))).toBe('‹notReceived›→‹insufficientData›');
  });

  it('an unknown side never reads as held', () => {
    expect(pair(unknown('notReceived'), k(5))).toBe('‹notReceived›→P5');
    expect(pair(k(5), unknown('notReceived'))).toBe('P5→‹notReceived›');
  });
});
