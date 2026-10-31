// The position mark's text (spec 8.4, A.4; review 6, R6-3). Contract of `positionMarkText(props)` in src/kit/values/position-mark.ts (pure):
//  - `{ change }`: positive = places gained, `▲2`; negative = places lost, `▼1`; zero = empty string;
//  - `{ from, to }`: `P7→P9`; an unknown `to` shows its reason's mark (`unknownMark`), `P7→…`: the unknown side of a
//    pair follows the one rule of `positionPairParts`, whose parts read the same with each mark in place;
//  - `PositionMarkProps` (the union of both shapes, A.4) is exported from the same file;
//  - its fixed glyphs (`▲`, `▼`, `—`, the arrow) are UI text and live in kit/text.ts: the file's code holds none.
import { known, unknown, type Known, type SessionTime, type UnknownReason } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { CellPart } from '../../src/kit/grid/grid.ts';
import { unknownMark, unknownReason } from '../../src/kit/text.ts';
import { positionMarkText, positionPairParts } from '../../src/kit/values/position-mark.ts';

const REASONS = Object.keys(unknownReason) as UnknownReason[];
const k = (v: number): Known<number> => known(v, 0 as SessionTime);
/** Parts as the cell shows them: each unknown as its reason's mark. */
const shown = (parts: readonly CellPart[]): string => parts.map((p) => (p.reason === undefined ? p.text : unknownMark[p.reason])).join('');

describe('positionMarkText', () => {
  it('shows places gained as ▲n', () => {
    expect(positionMarkText({ change: 2 })).toBe('▲2');
    expect(positionMarkText({ change: 13 })).toBe('▲13');
  });
  it('shows places lost as ▼n', () => {
    expect(positionMarkText({ change: -1 })).toBe('▼1');
  });
  it('shows nothing for no change', () => {
    expect(positionMarkText({ change: 0 })).toBe('');
  });
  it('shows a before/after pair', () => {
    expect(positionMarkText({ from: 7, to: k(9) })).toBe('P7→P9');
    expect(positionMarkText({ from: 7, to: k(7) })).toBe('P7→P7');
  });
  it('shows the unknown target\'s mark after the arrow: P7→…', () => {
    expect(positionMarkText({ from: 7, to: unknown('notReceived') })).toBe('P7→…');
  });
  it.each(REASONS)('an unknown target (%s) shows that reason\'s mark', (reason) => {
    expect(positionMarkText({ from: 7, to: unknown(reason) })).toBe(`P7→${unknownMark[reason]}`);
  });
});

describe('one rule for the unknown side of a pair: positionMarkText and positionPairParts agree', () => {
  const targets: [string, Known<number>][] = [['known', k(9)], ...REASONS.map((r): [string, Known<number>] => [r, unknown(r)])];
  it.each(targets)('target %s: the text is the pair\'s parts with each mark in place', (_, to) => {
    expect(positionMarkText({ from: 7, to })).toBe(shown(positionPairParts(k(7), to)));
  });
});

// The UI's types have no Node, so fs is typed here.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, encoding: 'utf8'): string };
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
/** A source without its comments (doc examples such as `▲2` may stay there). */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the position mark\'s glyphs are kit text', () => {
  it('position-mark.ts holds no fixed glyph in its code: every non-ASCII character is in kit/text.ts', () => {
    expect([...code(source('../../src/kit/values/position-mark.ts'))].filter((c) => c > '\u007f')).toEqual([]);
  });
  it('kit/text.ts holds the gained, lost and unchanged glyphs', () => {
    const text = code(source('../../src/kit/text.ts'));
    for (const glyph of ['▲', '▼', '—']) expect(text, glyph).toContain(glyph);
  });
});
