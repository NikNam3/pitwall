// The position mark's text (spec 8.4, A.4; review 6, R6-3). Contract of `positionMarkText(props)` in src/kit/values/position-mark.ts (pure):
//  - `{ change }`: positive = places gained, `▲2`; negative = places lost, `▼1`; zero = empty string;
//  - it takes no before/after pair (supervisor ruling on review 6 R6-3: that form had no reader; `positionPairParts` is
//    the one pair rendering, `—` when the position held): `PositionMarkProps` is `{ change }` alone, exported from the
//    same file (A.4), and the props of the kit `PositionMark`;
//  - its fixed glyphs (`▲`, `▼`, `—`, the arrow) are UI text and live in kit/text.ts: the file's code holds none.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { positionMarkText, type PositionMarkProps } from '../../src/kit/values/position-mark.ts';

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
});

describe('positionMarkText takes no target: positionPairParts is the one pair rendering', () => {
  it('its props, and the PositionMark component\'s, are a change of places only', () => {
    expectTypeOf<Parameters<typeof positionMarkText>[0]>().toEqualTypeOf<{ change: number }>();
    expectTypeOf<PositionMarkProps>().toEqualTypeOf<{ change: number }>();
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
