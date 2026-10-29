import { describe, expect, it } from 'vitest';
import { fitColumns } from '../../kit/size/size.ts';
import { TOWER_COLUMNS } from './columns.ts';

const GAP = 1;
const kept = (cols: number) => fitColumns(TOWER_COLUMNS, cols, GAP);

describe('TOWER_COLUMNS', () => {
  it('lists the full grid in order, widths from the mockup', () => {
    expect(TOWER_COLUMNS.map((c) => [c.key, c.widthCols])).toEqual([
      ['position', 2], ['change', 2], ['car', 3], ['gap', 7], ['interval', 6], ['toUs', 6], ['last', 8],
      ['s1', 6], ['s2', 6], ['s3', 6], ['compound', 1], ['age', 3], ['stops', 2], ['penalty', 3], ['pit', 3],
    ]);
  });

  it('shows every column at the full size (84 cols)', () => {
    expect(kept(84)).toEqual(TOWER_COLUMNS.map((c) => c.key));
  });

  it('keeps position, change, car, interval and last lap at the compact size (30 cols)', () => {
    expect(kept(30)).toEqual(['position', 'change', 'car', 'interval', 'last']);
  });

  it('drops pit, penalty, stops, age and compound, then the sectors, TO US and GAP as it narrows', () => {
    expect(kept(60)).toEqual(['position', 'change', 'car', 'gap', 'interval', 'toUs', 'last', 's1', 's2', 's3']);
    expect(kept(40)).toEqual(['position', 'change', 'car', 'gap', 'interval', 'last']);
  });

  it('right-aligns the numbers and left-aligns the car, change, compound and pit columns', () => {
    const left = TOWER_COLUMNS.filter((c) => c.align === 'left').map((c) => c.key);
    expect(left).toEqual(['change', 'car', 'compound', 'pit']);
  });
});
