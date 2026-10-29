// The insight lines of the kit gallery's `kit/insight-line` cell: real alarm kinds (spec 5.6), so the cell shows real texts.
import { feedId, type Insight } from '@pitwall/domain';

const insight = (key: string, kind: string, severity: Insight['severity'], category: Insight['category'], params: Insight['params']): Insight => ({
  key, severity, category, feedId: feedId('gallery'), kind, params, raisedAt: 0,
});

const wear = insight('wear', 'wearLimitNear', 'critical', 'tyres', { corner: 'fl', lapsToLimit: 1.8, wearPct: 68, limitPct: 70 });

/** Unacknowledged critical, advisory, then the critical once acknowledged. */
export const KIT_INSIGHTS: readonly { insight: Insight; acknowledged: boolean }[] = [
  { insight: wear, acknowledged: false },
  { insight: insight('carcass', 'bandOut', 'advisory', 'tyres', { channel: 'tyre.carcassC.fr', state: 'above', value: 109.4, lo: 85, hi: 105 }), acknowledged: false },
  { insight: { ...wear, key: 'wear-acknowledged' }, acknowledged: true },
];
