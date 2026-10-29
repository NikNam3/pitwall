// Gallery declaration of the alarm-list display (spec 9.1). Test-phase file: the implementer does not edit it.
import { ackToken, type InsightEntry } from '@pitwall/contracts';
import { carId, feedId, toSessionTime, type Insight } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const feed = feedId('gallery');
/** An insight as the alarms analysis raises it for car 0: key `<kind>:<car>:<channel>` (packages/analysis/src/alarms). */
const make = (kind: string, channel: string, severity: Insight['severity'], category: Insight['category'], raisedAt: number, params: Insight['params']): Insight => ({
  key: `${kind}:0:${channel}`, severity, category, feedId: feed, carId: carId(0), kind, params, raisedAt: toSessionTime(raisedAt),
});
type Active = Map<string, Insight>;
// The gallery feeds an append topic its raw entries (the widget folds them), but `GalleryEntry` types the case as the fold's result: cast until the type knows.
const entries = (list: InsightEntry[]): Active => list as unknown as Active;
const active = (...list: Insight[]): Active => entries(list.map((insight) => ({ type: 'raised' as const, insight })));

const brake = make('bandOutLap', 'brakesC.fr', 'critical', 'car', 230_000, { channel: 'brakesC.fr', lo: 300, hi: 900 });
const fuel = make('fuelShort', 'fuel', 'critical', 'energy', 230_000, { marginLaps: -0.7 });
const carcass = make('bandOut', 'tyre.carcassC.fr', 'advisory', 'tyres', 229_000, { channel: 'tyre.carcassC.fr', state: 'above', value: 109, lo: 85, hi: 105 });
const warning = make('warningLast', 'warnings', 'advisory', 'race', 210_000, { warnings: 2, before: 3 });
const wing = make('damageJump', '140000', 'critical', 'damage', 140_000, { lap: 12, parts: 'frontLeftWingPct', deltaPct: 12 });
const engine = make('bandOut', 'engineC', 'advisory', 'car', 225_000, { channel: 'engineC', state: 'above', value: 127, lo: 90, hi: 120 });
const pressure = make('bandOut', 'tyre.pressurePsi.rl', 'advisory', 'tyres', 200_000, { channel: 'tyre.pressurePsi.rl', state: 'below', value: 21.2, lo: 21.5, hi: 23.5 });

/** Synthetic cases and fit expectations for `alarm-list`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['ttZandvoortLap1.crossing', 'raceSingaporeStart.grid'],
  cases: {
    mixed: {
      insights: active(brake, fuel, carcass, warning, wing, engine),
      alerts: { acknowledged: [ackToken(wing)], muted: ['energy'] },
    },
    none: { insights: entries([]), alerts: { acknowledged: [], muted: [] } },
    critical: { insights: active(brake, fuel), alerts: { acknowledged: [], muted: [] } },
    advisory: { insights: active(carcass, warning, pressure), alerts: { acknowledged: [], muted: [] } },
    acknowledged: { insights: active(brake, wing), alerts: { acknowledged: [ackToken(wing)], muted: [] } },
    mutedCategory: { insights: active(brake, fuel), alerts: { acknowledged: [], muted: ['energy'] } },
    mutedNothingActive: { insights: entries([]), alerts: { acknowledged: [], muted: ['feed'] } },
  },
  // Task 22: one at each mode's minimum plus the edges just inside it. Not realism dependent: no rival data.
  fit: [
    { mode: 'compact', cols: 40, rows: 3 },
    { mode: 'compact', cols: 61, rows: 5 },
    { mode: 'full', cols: 62, rows: 6 },
    { mode: 'full', cols: 80, rows: 10 },
  ],
};

export default gallery;
