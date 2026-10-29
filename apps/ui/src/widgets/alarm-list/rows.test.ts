import { describe, expect, it } from 'vitest';
import { ackToken } from '@pitwall/contracts';
import { feedId, toSessionTime, type Insight } from '@pitwall/domain';
import { alarmRows } from './rows.ts';

const feed = feedId('test');
const make = (key: string, severity: Insight['severity'], category: Insight['category'], raisedAt: number): Insight => ({
  key, severity, category, feedId: feed, kind: key, params: {}, raisedAt: toSessionTime(raisedAt),
});
const active = (...list: Insight[]): Map<string, Insight> => new Map(list.map((i) => [i.key, i]));
const none = { acknowledged: [], muted: [] };
const keys = (v: ReturnType<typeof alarmRows>): string[] => v.rows.map((r) => r.insight.key);

describe('alarmRows', () => {
  it('is empty for no insights', () => {
    expect(alarmRows(new Map(), none)).toEqual({ rows: [], muted: [] });
  });

  it('orders by severity: critical, advisory, info', () => {
    const view = alarmRows(active(make('i', 'info', 'race', 3), make('a', 'advisory', 'tyres', 2), make('c', 'critical', 'damage', 1)), none);
    expect(keys(view)).toEqual(['c', 'a', 'i']);
  });

  it('orders newest first within a severity, then by key', () => {
    const view = alarmRows(
      active(make('old', 'advisory', 'race', 100), make('b', 'advisory', 'race', 200), make('a', 'advisory', 'race', 200)),
      none,
    );
    expect(keys(view)).toEqual(['a', 'b', 'old']);
  });

  it('gives each row its occurrence token and acknowledged flag', () => {
    const c = make('c', 'critical', 'damage', 5);
    const view = alarmRows(active(c), { acknowledged: [ackToken(c)], muted: [] });
    expect(view.rows).toEqual([{ insight: c, token: ackToken(c), acknowledged: true }]);
  });

  it('keeps acknowledged insights listed, after every unacknowledged one', () => {
    const ackd = make('ackd', 'critical', 'damage', 1);
    const view = alarmRows(active(ackd, make('adv', 'advisory', 'tyres', 2), make('crit', 'critical', 'tyres', 3)), {
      acknowledged: [ackToken(ackd)],
      muted: [],
    });
    expect(keys(view)).toEqual(['crit', 'adv', 'ackd']);
    expect(view.rows.map((r) => r.acknowledged)).toEqual([false, false, true]);
  });

  it('does not treat a later raising of the same key as acknowledged', () => {
    const first = make('k', 'critical', 'damage', 1);
    const again = make('k', 'critical', 'damage', 9);
    const view = alarmRows(active(again), { acknowledged: [ackToken(first)], muted: [] });
    expect(view.rows[0]?.acknowledged).toBe(false);
  });

  it('hides a muted category and counts what it hides', () => {
    const view = alarmRows(
      active(make('e1', 'advisory', 'energy', 1), make('e2', 'critical', 'energy', 2), make('t', 'advisory', 'tyres', 3)),
      { acknowledged: [], muted: ['energy'] },
    );
    expect(keys(view)).toEqual(['t']);
    expect(view.muted).toEqual([{ category: 'energy', count: 2 }]);
  });

  it('counts acknowledged alarms of a muted category too', () => {
    const e = make('e', 'critical', 'energy', 1);
    const view = alarmRows(active(e), { acknowledged: [ackToken(e)], muted: ['energy'] });
    expect(view.rows).toEqual([]);
    expect(view.muted).toEqual([{ category: 'energy', count: 1 }]);
  });

  it('lists a muted category with no active alarm at count 0', () => {
    expect(alarmRows(new Map(), { acknowledged: [], muted: ['feed'] }).muted).toEqual([{ category: 'feed', count: 0 }]);
  });

  it('lists muted categories in the fixed category order, not the order muted', () => {
    const view = alarmRows(new Map(), { acknowledged: [], muted: ['system', 'strategy', 'damage'] });
    expect(view.muted.map((m) => m.category)).toEqual(['strategy', 'damage', 'system']);
  });
});
