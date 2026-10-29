// The gallery's insights are real alarm kinds (spec 5.6), so the kit insight line and the top bar's race alert show the
// texts an engineer would read, not the raw `kind: key value` fallback.
import { describe, expect, it } from 'vitest';
import type { InsightEntry } from '@pitwall/contracts';
import { formatInsight } from '../../src/kit/insight/insight-text.ts';
import { KIT_INSIGHTS } from '../../src/gallery/kit-insights.ts';
import { TOP_BAR_CASES } from '../../src/gallery/topbar-cases.ts';

const ALARM_KINDS = ['bandOut', 'bandOutLap', 'wearLimitNear', 'fuelShort', 'damageJump', 'warningLast', 'penaltyNew'];

describe('gallery insights', () => {
  const raceAlert = TOP_BAR_CASES['race-alert'].flatMap((o) => (o.topic === 'insights' ? (o.value as InsightEntry[]) : []));
  const all = [...KIT_INSIGHTS.map((l) => l.insight), ...raceAlert.flatMap((e) => (e.type === 'raised' ? [e.insight] : []))];

  it('has insights to show', () => expect(all.length).toBeGreaterThanOrEqual(4));

  it.each(all.map((i) => [i.key, i] as const))('%s is an alarm kind with its own text', (_key, insight) => {
    expect(ALARM_KINDS).toContain(insight.kind);
    expect(formatInsight(insight)).not.toContain(`${insight.kind}:`);
  });

  it('the kit cell shows an unacknowledged critical, an advisory and an acknowledged line', () => {
    expect(KIT_INSIGHTS.map((l) => [l.insight.severity, l.acknowledged])).toEqual([
      ['critical', false],
      ['advisory', false],
      ['critical', true],
    ]);
  });
});
