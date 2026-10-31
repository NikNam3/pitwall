// The unknown value's cell part is built by one kit function (review 6, R6-4). Contract assumed of `kit/grid/grid.ts`,
// next to `CellPart` (the grid's convention, read by `fitParts`):
//  - `unknownPart(reason)`: the part of an unknown value, `{ text: '', reason }` (its mark shows in place);
//  - `knownPart(v, format)`: a `Known<T>` as a part: `{ text: format(value) }` (no `reason` key) when known, else
//    `unknownPart(v.reason)`; `format` is not called for an unknown;
//  - no other UI source spells the unknown part out by hand: displays and the kit build it through these two.
// The grid does not import kit/values (the dependency goes values -> grid); that is a depcruise rule, not a test here.
import { known, unknown, type Known, type UnknownReason } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { knownPart, unknownPart } from '../../src/kit/grid/grid.ts';
import { unknownReason } from '../../src/kit/text.ts';

const REASONS = Object.keys(unknownReason) as UnknownReason[];

describe('unknownPart', () => {
  it.each(REASONS)('%s: an empty text with the reason, so the mark shows in place', (reason) => {
    expect(unknownPart(reason)).toStrictEqual({ text: '', reason });
  });
});

describe('knownPart', () => {
  const format = (n: number): string => `P${n}`;

  it('a known value is its formatted text, with no reason', () => {
    expect(knownPart(known(3, 0), format)).toStrictEqual({ text: 'P3' });
  });

  it.each(REASONS)('an unknown value (%s) is the unknown part, and its format is never called', (reason) => {
    const never = (): string => {
      throw new Error('format called for an unknown value');
    };
    const v: Known<number> = unknown(reason);
    expect(knownPart(v, never)).toStrictEqual(unknownPart(reason));
  });
});

// The UI's types have no Node, so fs is typed here.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, encoding: 'utf8'): string };

// Every UI source (the glob only lists them; nothing is imported), tests and gallery declarations left out, and the grid
// file that owns the builder.
const SOURCES = Object.keys(
  import.meta.glob(['../../src/**/*.svelte', '../../src/**/*.ts', '!../../src/**/*.test.ts', '!../../src/**/gallery.ts', '!../../src/kit/grid/grid.ts']),
);
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
/** `{ text: '', reason… }` or `{ reason…, text: '' }`: the unknown part written out. */
const HAND_BUILT = /\{\s*text:\s*''\s*,\s*reason\b|\{\s*reason\b[^{}]*,\s*text:\s*''\s*\}/;

describe('one builder of the unknown part', () => {
  it('the glob finds the UI sources', () => {
    expect(SOURCES.map((p) => p.replace('../../src/', ''))).toEqual(
      expect.arrayContaining(['kit/values/position-mark.ts', 'widgets/incident-feed/rows.ts', 'kit/car/gap-to-car.ts']),
    );
  });

  it('no UI source writes the unknown part out by hand: it is unknownPart or knownPart', () => {
    expect(SOURCES.filter((p) => HAND_BUILT.test(source(p))).map((p) => p.replace('../../src/', ''))).toEqual([]);
  });
});
