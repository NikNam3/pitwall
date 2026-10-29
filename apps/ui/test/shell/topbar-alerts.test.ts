// Top bar logic without a component (Task 17, spec 7.7).
// Contract: `shell/topbar/alerts.ts` exports `activeInsights: Fold<InsightEntry, Map<string, Insight>>` (copy on write, like
// every fold: `add` returns a new Map and leaves `acc` alone) and `tierOneAlerts(active, alerts)`;
// `kit/insight/insight-text.ts` (moved from the shell) exports `formatInsight(i)`, whose fallback for a kind it does not know contains the kind
// and every param value; `shell/topbar/layout.ts` exports `TOP_BAR` (the approved mockup 9-top-bar).
import type { InsightEntry } from '@pitwall/contracts';
import { feedId, type Insight } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { activeInsights, tierOneAlerts } from '../../src/shell/topbar/alerts.ts';
import { formatInsight } from '../../src/kit/insight/insight-text.ts';
import { TOP_BAR } from '../../src/shell/topbar/layout.ts';

const insight = (key: string, over: Partial<Insight> = {}): Insight => ({
  key,
  severity: 'critical',
  category: 'damage',
  feedId: feedId('f1'),
  kind: 'someUnknownKind',
  params: { pct: 42 },
  raisedAt: 1000,
  ...over,
});
const raised = (i: Insight): InsightEntry => ({ type: 'raised', insight: i });
const resolved = (key: string, at = 5000): InsightEntry => ({ type: 'resolved', key, at: at });
const none = { acknowledged: [], muted: [] };
const toMap = (...list: Insight[]) => new Map(list.map((i) => [i.key, i]));

describe('activeInsights', () => {
  it('starts empty', () => {
    expect(activeInsights.init().size).toBe(0);
  });

  it('a raised insight is active under its key', () => {
    const a = insight('a');
    expect(activeInsights.add(activeInsights.init(), [raised(a)]).get('a')).toEqual(a);
  });

  it('raised then resolved: absent', () => {
    const a = insight('a');
    const acc = activeInsights.add(activeInsights.init(), [raised(a), raised(insight('b')), resolved('a')]);
    expect([...acc.keys()]).toEqual(['b']);
  });

  it('resolved in a later batch removes it; resolving an unknown key changes nothing', () => {
    const first = activeInsights.add(activeInsights.init(), [raised(insight('a'))]);
    const second = activeInsights.add(first, [resolved('zzz'), resolved('a')]);
    expect(second.size).toBe(0);
  });

  it('raised again after it was resolved: active again', () => {
    const acc = activeInsights.add(activeInsights.init(), [raised(insight('a')), resolved('a'), raised(insight('a', { raisedAt: 9000 }))]);
    expect(acc.get('a')?.raisedAt).toBe(9000);
  });

  it('returns a new Map and does not change the one it was given', () => {
    const before = toMap(insight('a'));
    const after = activeInsights.add(before, [raised(insight('b'))]);
    expect(after).not.toBe(before);
    expect([...before.keys()]).toEqual(['a']);
  });
});

describe('tierOneAlerts', () => {
  it('keeps critical insights and excludes advisory and info', () => {
    const active = toMap(insight('c'), insight('adv', { severity: 'advisory' }), insight('inf', { severity: 'info' }));
    expect(tierOneAlerts(active, none).map((i) => i.key)).toEqual(['c']);
  });

  it('excludes acknowledged occurrences, keyed `<feedId>:<insightKey>:<raisedAt>`', () => {
    const active = toMap(insight('a'), insight('b'));
    expect(tierOneAlerts(active, { acknowledged: ['f1:a:1000'], muted: [] }).map((i) => i.key)).toEqual(['b']);
  });

  it('an occurrence raised later (other raisedAt) or on another feed is not covered by the acknowledgement', () => {
    const acknowledged = ['f1:a:1000'];
    const later = toMap(insight('a', { raisedAt: 7000 }));
    expect(tierOneAlerts(later, { acknowledged, muted: [] }).map((i) => i.key)).toEqual(['a']);
    const otherFeed = toMap(insight('a', { feedId: feedId('f2') }));
    expect(tierOneAlerts(otherFeed, { acknowledged, muted: [] }).map((i) => i.key)).toEqual(['a']);
    expect(tierOneAlerts(toMap(insight('a')), { acknowledged: ['a'], muted: [] }).map((i) => i.key)).toEqual(['a']);
  });

  it('excludes muted categories', () => {
    const active = toMap(insight('a', { category: 'tyres' }), insight('b', { category: 'damage' }));
    expect(tierOneAlerts(active, { acknowledged: [], muted: ['tyres'] }).map((i) => i.key)).toEqual(['b']);
  });

  it('is sorted by raisedAt, whatever the insertion order', () => {
    const active = toMap(insight('late', { raisedAt: 9000 }), insight('early', { raisedAt: 1000 }), insight('mid', { raisedAt: 5000 }));
    expect(tierOneAlerts(active, none).map((i) => i.key)).toEqual(['early', 'mid', 'late']);
  });

  it('is empty for no insights', () => {
    expect(tierOneAlerts(new Map(), none)).toEqual([]);
  });
});

describe('formatInsight', () => {
  it('the fallback for an unknown kind names the kind and shows every param', () => {
    const out = formatInsight(insight('a', { kind: 'madeUpKind', params: { wheel: 'FL', pct: 71 } }));
    expect(out).toContain('madeUpKind');
    expect(out).toContain('FL');
    expect(out).toContain('71');
  });

  it('is a non-empty string for any insight', () => {
    expect(formatInsight(insight('a', { params: {} })).length).toBeGreaterThan(0);
  });
});

describe('TOP_BAR layout (mockup 9)', () => {
  it('left: workbook, session, flag, moment; right: alerts, replay, feed, realism', () => {
    expect(TOP_BAR.left).toEqual(['workbook', 'session', 'flag', 'moment']);
    expect(TOP_BAR.right).toEqual(['alerts', 'replay', 'feed', 'realism']);
  });
});
