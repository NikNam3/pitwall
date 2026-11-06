// The pit-loss table's columns (mockup docs/design/2026-11-06-sp4.1a/source-badge.html, priorities from
// docs/design/2026-10-30-sp4a-displays/README.md: pit loss `COND, LOSS > SOURCE > N > STAT`). Contract assumed of
// `columns.ts`: `CONDITION_COLUMNS` and `STOP_COLUMNS`, each `{ key, widthCols, align, priority }[]` in display order,
// fitted with the kit's `fitColumns(columns, size.cols, 1)` as the other tables do.
import { describe, expect, it } from 'vitest';
import { fitColumns } from '../../kit/size/size.ts';
import { CONDITION_COLUMNS, STOP_COLUMNS } from './columns.ts';

const kept = (cols: number) => fitColumns(CONDITION_COLUMNS, cols, 1);

describe('CONDITION_COLUMNS', () => {
  it('lists the grid of the mockup: COND LOSS STAT N SOURCE, SOURCE 11 cells wide for "calibration"', () => {
    expect(CONDITION_COLUMNS.map((c) => [c.key, c.widthCols])).toEqual([
      ['cond', 5], ['loss', 5], ['stat', 4], ['n', 2], ['source', 11],
    ]);
  });

  it('left-aligns the condition and the source word and right-aligns every number', () => {
    expect(CONDITION_COLUMNS.map((c) => [c.key, c.align])).toEqual([
      ['cond', 'left'], ['loss', 'right'], ['stat', 'right'], ['n', 'right'], ['source', 'left'],
    ]);
  });

  it('shows every column at the full size (32 cols)', () => {
    expect(kept(32)).toEqual(['cond', 'loss', 'stat', 'n', 'source']);
  });

  it('keeps COND and LOSS at the compact size (18 cols)', () => {
    expect(kept(18)).toEqual(['cond', 'loss']);
  });

  it('drops STAT first, then N, then SOURCE, and never COND or LOSS', () => {
    expect(kept(30)).toEqual(['cond', 'loss', 'n', 'source']);
    expect(kept(25)).toEqual(['cond', 'loss', 'source']);
    expect(kept(22)).toEqual(['cond', 'loss']);
    expect(kept(11)).toEqual(['cond', 'loss']);
  });

  it('ranks the priorities COND, LOSS > SOURCE > N > STAT', () => {
    const priority = Object.fromEntries(CONDITION_COLUMNS.map((c) => [c.key, c.priority]));
    expect(priority['cond']).toBe(priority['loss']);
    expect(priority['loss']).toBeLessThan(priority['source']!);
    expect(priority['source']).toBeLessThan(priority['n']!);
    expect(priority['n']).toBeLessThan(priority['stat']!);
  });
});

describe('STOP_COLUMNS', () => {
  it('lists the grid of the mockup: LAP DRV COND LOSS STAT', () => {
    expect(STOP_COLUMNS.map((c) => [c.key, c.widthCols, c.align])).toEqual([
      ['lap', 3, 'left'], ['drv', 3, 'left'], ['cond', 5, 'left'], ['loss', 5, 'right'], ['stat', 4, 'right'],
    ]);
  });

  it('fits whole in the full size (32 cols)', () => {
    expect(fitColumns(STOP_COLUMNS, 32, 1)).toEqual(['lap', 'drv', 'cond', 'loss', 'stat']);
  });
});
