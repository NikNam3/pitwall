// The pure cell computation of `Bar` (spec 8.4, A.4). Contract assumed of `kit/bar/bar.ts`:
//   barCells(input: { value: Known<number>; min: number; max: number; cols: number; limit?: number;
//                     marker?: Known<number>; reserve?: number }): { text: string; kinds: BarCellKind[]; over: boolean; reason: UnknownReason | undefined }
//   BarCellKind = 'fill' | 'empty' | 'limit' | 'marker' | 'reserve'
//   - `kinds.length === cols` and `text` has exactly `cols` characters, one per cell (block characters only);
//   - the value fills `round((value - min) / (max - min) * cols)` cells from the left ('█' = BAR_CHARS.fill), the rest are
//     empty ('░' = BAR_CHARS.empty); a value below min fills none, above max fills all and sets `over`;
//   - a position `p` (limit, marker, reserve) lands in cell `clamp(floor((p - min) / (max - min) * cols), 0, cols - 1)`
//     and replaces that cell's character: limit '|', marker ':', reserve '¦' (BAR_CHARS.limit, .marker, .reserve);
//     on one cell the order of precedence is limit, marker, reserve;
//   - an unknown value is an all-empty bar with `reason` set; an unknown marker draws no marker; a known value has `reason` undefined.
import { known, unknown, type SessionTime } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { BAR_CHARS, barCells } from '../../src/kit/bar/bar.ts';

const at = 0 as SessionTime;
const bar = (value: number, extra: Partial<Parameters<typeof barCells>[0]> = {}) =>
  barCells({ value: known(value, at), min: 0, max: 100, cols: 10, ...extra });
const { fill, empty } = BAR_CHARS;

describe('barCells: the fill', () => {
  it('value at min is all empty', () => {
    const b = bar(0);
    expect(b.text).toBe(empty.repeat(10));
    expect(b.over).toBe(false);
  });
  it('value at max is all filled', () => {
    const b = bar(100);
    expect(b.text).toBe(fill.repeat(10));
    expect(b.over).toBe(false);
  });
  it('half is half', () => expect(bar(50).text).toBe(fill.repeat(5) + empty.repeat(5)));
  it('rounds to the nearest cell', () => {
    expect(bar(24).text).toBe(fill.repeat(2) + empty.repeat(8));
    expect(bar(26).text).toBe(fill.repeat(3) + empty.repeat(7));
  });
  it('beyond the max is all filled and flagged over', () => {
    const b = bar(130);
    expect(b.text).toBe(fill.repeat(10));
    expect(b.over).toBe(true);
  });
  it('below the min is empty and not over', () => {
    const b = bar(-20);
    expect(b.text).toBe(empty.repeat(10));
    expect(b.over).toBe(false);
  });
  it('honours a min other than zero', () => {
    expect(barCells({ value: known(5, at), min: 4, max: 6, cols: 4 }).text).toBe(fill.repeat(2) + empty.repeat(2));
  });
  it('kinds mirror the text', () => {
    expect(bar(30).kinds).toEqual([...Array(3).fill('fill'), ...Array(7).fill('empty')]);
  });
});

describe('barCells: limit, marker, reserve', () => {
  it('the limit replaces its cell', () => {
    const b = bar(10, { limit: 70 });
    expect(b.text[7]).toBe(BAR_CHARS.limit);
    expect(b.kinds[7]).toBe('limit');
    expect(b.text).toHaveLength(10);
  });
  it('a limit in the filled part still shows', () => {
    expect(bar(90, { limit: 70 }).text[7]).toBe(BAR_CHARS.limit);
  });
  it('a marker is drawn from a known value', () => {
    const b = bar(10, { marker: known(40, at) });
    expect(b.text[4]).toBe(BAR_CHARS.marker);
    expect(b.kinds[4]).toBe('marker');
  });
  it('an unknown marker draws nothing', () => {
    expect(bar(10, { marker: unknown('notReceived') }).text).toBe(bar(10).text);
  });
  it('the reserve line is drawn', () => {
    expect(bar(10, { reserve: 20 }).text[2]).toBe(BAR_CHARS.reserve);
  });
  it('a position at max lands in the last cell, below min in the first', () => {
    expect(bar(0, { limit: 100 }).text[9]).toBe(BAR_CHARS.limit);
    expect(bar(0, { limit: -5 }).text[0]).toBe(BAR_CHARS.limit);
  });
  it('on one cell: limit over marker over reserve', () => {
    expect(bar(0, { limit: 55, marker: known(50, at), reserve: 52 }).text[5]).toBe(BAR_CHARS.limit);
    expect(bar(0, { marker: known(50, at), reserve: 52 }).text[5]).toBe(BAR_CHARS.marker);
  });
});

describe('barCells: unknown value', () => {
  it('is an empty bar with the reason', () => {
    const b = barCells({ value: unknown('restricted'), min: 0, max: 100, cols: 8 });
    expect(b.text).toBe(empty.repeat(8));
    expect(b.kinds).toEqual(Array(8).fill('empty'));
    expect(b.reason).toBe('restricted');
    expect(b.over).toBe(false);
  });
  it('still shows a limit', () => {
    expect(barCells({ value: unknown('notReceived'), min: 0, max: 100, cols: 10, limit: 70 }).text[7]).toBe(BAR_CHARS.limit);
  });
  it('a known value has no reason', () => expect(bar(10).reason).toBeUndefined());
});
