// How an unknown shows is the kit's alone (wave 2, T7; review-ui finding 7; user rule: centralise presentation): a
// display renders an unknown through the kit's `TextCell` or `Value`, never the bare `UnknownMark`, and no display
// reads the glyphs (`unknownMark`) to lay out a cell itself. The widget sources are read from disk.
import { describe, expect, it } from 'vitest';

// The UI's types have no Node, so fs is typed here.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, encoding: 'utf8'): string };

// Every widget source by its path (the glob only lists them; nothing is imported), tests left out. The gap chart is in
// it too (situations plan Task 0): its reference line renders through the kit `TextCell`.
const SOURCES = Object.keys(
  import.meta.glob(['../../src/widgets/*/*.svelte', '../../src/widgets/*/*.ts', '!../../src/widgets/*/*.test.ts']),
);
// Every UI source, tests left out: once no display uses the bare mark, nothing may.
const ALL_SOURCES = Object.keys(import.meta.glob(['../../src/**/*.svelte', '../../src/**/*.ts', '!../../src/**/*.test.ts']));
const BARE_MARK = Object.keys(import.meta.glob('../../src/kit/values/UnknownMark.svelte'));
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const widgetOf = (path: string): string => path.replace('../../src/widgets/', '');

describe('unknowns render through the kit', () => {
  it('the glob finds the widget sources', () => {
    expect(SOURCES.map(widgetOf)).toEqual(expect.arrayContaining(['incident-feed/rows.ts', 'ers-budget/ErsBudget.svelte', 'gap-chart/GapChart.svelte']));
  });

  it('no display renders the bare UnknownMark: an unknown cell is the kit TextCell (or Value)', () => {
    expect(SOURCES.filter((p) => /UnknownMark\.svelte/.test(source(p))).map(widgetOf)).toEqual([]);
  });

  it('no display reads the marks to lay out a cell: the glyph and its width are the kit\'s', () => {
    expect(SOURCES.filter((p) => /\bunknownMark\b/.test(source(p))).map(widgetOf)).toEqual([]);
  });

  it('the bare UnknownMark is gone: no UI source imports it and the kit no longer has it', () => {
    expect(ALL_SOURCES.filter((p) => /UnknownMark\.svelte/.test(source(p))).map((p) => p.replace('../../src/', ''))).toEqual([]);
    expect(BARE_MARK).toEqual([]);
  });
});
