import { describe, expect, it } from 'vitest';
import { feedId, toSessionTime, type Insight } from '@pitwall/domain';
import { fitAlarms, SEVERITY_COLS } from './fit.ts';
import type { AlarmRow, AlarmView } from './rows.ts';

const insight = (key: string, category: Insight['category'] = 'tyres'): Insight => ({
  key, severity: 'critical', category, feedId: feedId('test'), kind: key, params: {}, raisedAt: toSessionTime(0),
});
const row = (key: string, acknowledged = false, category: Insight['category'] = 'tyres'): AlarmRow => ({ insight: insight(key, category), token: key, acknowledged });
const view = (rows: AlarmRow[], muted: AlarmView['muted'] = []): AlarmView => ({ rows, muted });
/** The insight text is the key itself. */
const format = (i: Insight): string => i.key;
const fit = (v: AlarmView, cols: number, rows: number, full = false) => fitAlarms(v, { cols, rows }, full, format);

describe('fitAlarms', () => {
  it('keeps every row and the muted line when they fit', () => {
    const f = fit(view([row('a'), row('b')], [{ category: 'energy', count: 1 }]), 40, 3);
    expect(f.rows.map((r) => r.text)).toEqual(['a', 'b']);
    expect(f.more).toBe(0);
    expect(f.muted).toEqual([{ category: 'energy', count: 1 }]);
  });

  it('shows rows - 1 alarms and counts the rest on the last line when they do not fit', () => {
    const f = fit(view([row('a'), row('b'), row('c'), row('d')]), 40, 3);
    expect(f.rows.map((r) => r.text)).toEqual(['a', 'b']);
    expect(f.more).toBe(2);
  });

  it('counts the alarms behind the muted line when both do not fit', () => {
    const f = fit(view([row('a'), row('b'), row('c')], [{ category: 'energy', count: 1 }]), 40, 3);
    expect(f.rows).toHaveLength(2);
    expect(f.more).toBe(1);
    expect(f.muted).toEqual([{ category: 'energy', count: 1 }]);
  });

  it('cuts an insight text to the room left beside the label and the ack button', () => {
    // 5 (label) + 1 + text + 1 + 3 ("ack") = 20 columns: 10 for the text.
    const [r] = fit(view([row('abcdefghijklmnop')]), 20, 3).rows;
    expect(r?.text).toBe('abcdefghi…');
    expect(SEVERITY_COLS + 1 + (r?.text.length ?? 0) + 1 + 'ack'.length).toBe(20);
  });

  it('leaves room for "acknowledged" on an acknowledged row', () => {
    const [r] = fit(view([row('abcdefghijklmnop', true)]), 30, 3).rows;
    expect(r?.text.length).toBe(30 - SEVERITY_COLS - 1 - 1 - 'acknowledged'.length);
  });

  it('leaves room for the mute button in full mode', () => {
    const [r] = fit(view([row('abcdefghijklmnopqrstuvwxyz', false, 'tyres')]), 40, 6, true).rows;
    expect(r?.text.length).toBe(40 - SEVERITY_COLS - 1 - 1 - 'ack'.length - 1 - 'mute tyres'.length);
  });

  it('keeps short texts as they are', () => {
    expect(fit(view([row('short')]), 40, 3).rows[0]?.text).toBe('short');
  });

  it('drops the muted entries that do not fit the line', () => {
    const muted = [{ category: 'energy', count: 1 }, { category: 'damage', count: 2 }, { category: 'tyres', count: 0 }] as AlarmView['muted'];
    // "muted: energy (1) damage (2)" is 28 columns; "+ tyres (0)" would make 38.
    expect(fit(view([], muted), 30, 3).muted.map((m) => m.category)).toEqual(['energy', 'damage']);
  });

  it('puts the count before the muted entries on one line', () => {
    const f = fit(view([row('a'), row('b'), row('c')], [{ category: 'energy', count: 1 }, { category: 'damage', count: 1 }]), 26, 3);
    // "+1 muted: energy (1)" is 20 columns; " damage (1)" would make 31.
    expect(f.more).toBe(1);
    expect(f.muted.map((m) => m.category)).toEqual(['energy']);
  });
});
