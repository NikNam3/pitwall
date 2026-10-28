// @vitest-environment jsdom
// The dense table (spec 5, brainstorm 7). Contract the tests assume of Table.svelte:
//  - every header cell and every body cell carries `data-col="<column key>"`; header cells hold the column label,
//    body cells hold the rendered `cell` snippet; header cells sit outside `[data-row]`;
//  - every body row carries `data-row="<rowKey>"` and, as classes, `inactive` and `highlight` when they apply;
//  - the available width is `size.cols`; the gap between columns is the density token `--pw-col-gap` on the document
//    root (a CSS length in `ch`, e.g. `2ch`, 1 when unset), passed to `fitColumns` as a number of cells;
//  - row banding: every second body row (index 1, 3, ...) has inline `background-color: <role('bgRowBand')>`,
//    the others have none;
//  - the text sits in the theme font at the one size: the root `.table` has inline `font-family: var(--pw-font)` and
//    `font-size: var(--pw-font-px)` and nothing in the table sets another font size.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { role } from '../../src/theme/index.ts';
import type { WidgetSize } from '../../src/kit/types.ts';
import TableHarness from './TableHarness.svelte';

const size = (cols: number): WidgetSize => ({ mode: 'full', cols, rows: 20, px: { width: cols * 8, height: 400 }, dpr: 1 });
const rows = [
  { id: 'a', name: 'VER', gap: '+0.0', tyre: 'M', notes: 'x' },
  { id: 'b', name: 'HAM', gap: '+1.2', tyre: 'H', notes: 'y' },
  { id: 'c', name: 'LEC', gap: '+2.4', tyre: 'S', notes: 'z' },
  { id: 'd', name: 'NOR', gap: '+3.1', tyre: 'M', notes: 'w' },
];

beforeEach(() => document.documentElement.style.removeProperty('--pw-col-gap'));
afterEach(cleanup);

const headers = (c: HTMLElement) => [...c.querySelectorAll('[data-col]')].filter((e) => !e.closest('[data-row]'));
const headerKeys = (c: HTMLElement) => headers(c).map((e) => e.getAttribute('data-col'));
const rowKeys = (c: HTMLElement) => [...c.querySelectorAll('[data-row]')].map((e) => e.getAttribute('data-row'));
const rowEl = (c: HTMLElement, key: string) => c.querySelector(`[data-row="${key}"]`) as HTMLElement;

describe('Table: columns', () => {
  it('shows every column when they fit, with labels and cell snippets', () => {
    const { container } = render(TableHarness, { rows, size: size(60) });
    expect(headerKeys(container)).toEqual(['name', 'gap', 'tyre', 'notes']);
    expect(headers(container).map((e) => e.textContent?.trim())).toEqual(['Driver', 'Gap', 'Tyre', 'Notes']);
    expect(rowEl(container, 'b').querySelector('[data-col="gap"]')?.textContent?.trim()).toBe('+1.2');
  });

  it('at 30 columns hides the lowest-priority column (widths 10+8+8+6 and three 1-cell gaps = 35)', () => {
    const { container } = render(TableHarness, { rows, size: size(30) });
    expect(headerKeys(container)).toEqual(['name', 'gap', 'tyre']);
    expect(container.querySelector('[data-row] [data-col="notes"]')).toBeNull();
  });

  it('keeps dropping by priority as the width shrinks (10 + 1 gap + 8 = 19)', () => {
    document.documentElement.style.setProperty('--pw-col-gap', '1ch');
    const { container } = render(TableHarness, { rows, size: size(19) });
    expect(headerKeys(container)).toEqual(['name', 'gap']);
  });

  it('uses the density token for the gap: with --pw-col-gap 2ch, 29 columns drop two columns, with 1ch only one', () => {
    const one = render(TableHarness, { rows, size: size(29) });
    expect(headerKeys(one.container)).toEqual(['name', 'gap', 'tyre']);
    cleanup();
    document.documentElement.style.setProperty('--pw-col-gap', '2ch');
    const two = render(TableHarness, { rows, size: size(29) });
    expect(headerKeys(two.container)).toEqual(['name', 'gap']);
  });

  it('follows a size change', async () => {
    document.documentElement.style.setProperty('--pw-col-gap', '1ch');
    const { container, rerender } = render(TableHarness, { rows, size: size(60) });
    expect(headerKeys(container)).toHaveLength(4);
    await rerender({ rows, size: size(19) });
    expect(headerKeys(container)).toEqual(['name', 'gap']);
  });
});

describe('Table: rows', () => {
  it('renders rows in input order, keyed by rowKey', () => {
    const { container } = render(TableHarness, { rows, size: size(60) });
    expect(rowKeys(container)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('inactive rows render last, in their original relative order, with the inactive class', () => {
    const input = [
      { ...rows[0]!, out: true },
      rows[1]!,
      { ...rows[2]!, out: true },
      rows[3]!,
    ];
    const { container } = render(TableHarness, { rows: input, size: size(60) });
    expect(rowKeys(container)).toEqual(['b', 'd', 'a', 'c']);
    expect(rowEl(container, 'a').classList.contains('inactive')).toBe(true);
    expect(rowEl(container, 'c').classList.contains('inactive')).toBe(true);
    expect(rowEl(container, 'b').classList.contains('inactive')).toBe(false);
  });

  it('bands every second row with bgRowBand; banding follows the displayed order', () => {
    const input = [{ ...rows[0]!, out: true }, rows[1]!, rows[2]!];
    const { container } = render(TableHarness, { rows: input, size: size(60) });
    // displayed: b, c, a
    expect(rowEl(container, 'b').style.backgroundColor).toBe('');
    expect(rowEl(container, 'c').style.backgroundColor).toBe(role('bgRowBand'));
    expect(rowEl(container, 'a').style.backgroundColor).toBe('');
  });

  it('marks only the highlighted row', () => {
    const { container } = render(TableHarness, { rows, size: size(60), highlight: 'c' });
    expect(rowEl(container, 'c').classList.contains('highlight')).toBe(true);
    expect(rowEl(container, 'a').classList.contains('highlight')).toBe(false);
  });

  it('renders the highlighted (own car) row bold: inline font-weight bold or >= 700', () => {
    const { container } = render(TableHarness, { rows, size: size(60), highlight: 'c' });
    const w = rowEl(container, 'c').style.fontWeight;
    expect(w === 'bold' || Number(w) >= 700).toBe(true);
    const other = rowEl(container, 'a').style.fontWeight;
    expect(other === 'bold' || Number(other) >= 700).toBe(false);
  });

  it('uses the theme font at the one size, not scaled with the panel', () => {
    const small = render(TableHarness, { rows, size: size(40) });
    const root = small.container.querySelector('.table') as HTMLElement;
    expect(root.style.fontFamily).toBe('var(--pw-font)');
    expect(root.style.fontSize).toBe('var(--pw-font-px)');
    cleanup();
    const big = render(TableHarness, { rows, size: size(120) });
    expect((big.container.querySelector('.table') as HTMLElement).style.fontSize).toBe('var(--pw-font-px)');
  });
});
