import { describe, expect, it } from 'vitest';
import { unknown } from '@pitwall/domain';
import { fitColumns } from '../../kit/size/size.ts';
import { formatDeltaMs } from '../../kit/values/format.ts';
import { ms } from './fixtures.ts';
import { LAP_COLUMNS, formatCell } from './columns.ts';

const kept = (cols: number) => fitColumns(LAP_COLUMNS, cols, 1);

describe('LAP_COLUMNS', () => {
  it('lists the grid of the mockup: DRV BEST S1 S2 S3 THEO', () => {
    expect(LAP_COLUMNS.map((c) => [c.key, c.widthCols])).toEqual([
      ['drv', 3], ['best', 8], ['s1', 6], ['s2', 6], ['s3', 6], ['theo', 8],
    ]);
  });

  it('left-aligns the driver code and right-aligns every number so the decimals line up', () => {
    expect(LAP_COLUMNS.filter((c) => c.align === 'left').map((c) => c.key)).toEqual(['drv']);
  });

  it('shows every column at the full size (44 cols)', () => {
    expect(kept(44)).toEqual(['drv', 'best', 's1', 's2', 's3', 'theo']);
  });

  it('keeps DRV, BEST and THEO at the compact size (22 cols)', () => {
    expect(kept(22)).toEqual(['drv', 'best', 'theo']);
  });

  it('drops the sectors before THEO and BEST as it narrows', () => {
    expect(kept(30)).toEqual(['drv', 'best', 's1', 'theo']);
    expect(kept(27)).toEqual(['drv', 'best', 'theo']);
    expect(kept(12)).toEqual(['drv', 'best']);
  });
});

describe('formatCell', () => {
  it('shows an absolute lap as m:ss.mmm and an absolute sector as ss.mmm', () => {
    expect(formatCell('best', { value: ms(104_876), absolute: true, status: 'none' })).toBe('1:44.876');
    expect(formatCell('theo', { value: ms(104_876), absolute: true, status: 'none' })).toBe('1:44.876');
    expect(formatCell('s2', { value: ms(41_288), absolute: true, status: 'none' })).toBe('41.288');
  });

  it('shows a delta signed with three decimals, as the kit formats it', () => {
    expect(formatCell('best', { value: ms(-756), absolute: false, status: 'none' })).toBe(formatDeltaMs(-756));
    expect(formatCell('s1', { value: ms(252), absolute: false, status: 'none' })).toBe('+0.252');
    expect(formatCell('theo', { value: ms(196), absolute: false, status: 'none' })).toBe('+0.196');
  });

  it('shows a delta of zero with a plus sign', () => {
    expect(formatCell('s3', { value: ms(0), absolute: false, status: 'none' })).toBe('+0.000');
  });

  it('shows a delta beyond a second in seconds, not minutes', () => {
    expect(formatCell('best', { value: ms(1_234), absolute: false, status: 'none' })).toBe('+1.234');
  });

  it('is empty for an unknown value', () => {
    expect(formatCell('best', { value: unknown('realism'), absolute: false, status: 'none' })).toBe('');
    expect(formatCell('s1', { value: unknown('notReceived'), absolute: true, status: 'none' })).toBe('');
  });
});
