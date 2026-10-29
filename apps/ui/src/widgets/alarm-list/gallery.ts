// Gallery declaration of the alarm-list display (spec 9.1). Test-phase file: the implementer does not edit it.
import { ackToken } from '@pitwall/contracts';
import { feedId, toSessionTime, type Insight } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const feed = feedId('gallery');
const make = (key: string, severity: Insight['severity'], category: Insight['category'], raisedAt: number, params: Insight['params'] = {}): Insight => ({
  key, severity, category, feedId: feed, kind: key, params, raisedAt: toSessionTime(raisedAt),
});
const active = (...list: Insight[]): Map<string, Insight> => new Map(list.map((i) => [i.key, i]));

const brake = make('brake.fr', 'critical', 'tyres', 230_000, { corner: 'FR', celsius: 1043 });
const fuel = make('fuel.short', 'critical', 'strategy', 230_000, { margin: -0.7 });
const carcass = make('carcass.fr', 'advisory', 'tyres', 229_000, { corner: 'FR', celsius: 109 });
const warning = make('warnings.left', 'advisory', 'race', 210_000, { left: 1 });
const wing = make('damage.fl-wing', 'critical', 'damage', 140_000, { percent: 12 });
const ers = make('ers.low', 'advisory', 'energy', 225_000);
const info = make('pit.window', 'info', 'strategy', 200_000);

/** Synthetic cases and fit expectations for `alarm-list`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['ttZandvoortLap1.crossing', 'raceSingaporeStart.grid'],
  cases: {
    none: { insights: new Map(), alerts: { acknowledged: [], muted: [] } },
    critical: { insights: active(brake, fuel), alerts: { acknowledged: [], muted: [] } },
    advisory: { insights: active(carcass, warning, info), alerts: { acknowledged: [], muted: [] } },
    acknowledged: { insights: active(brake, wing), alerts: { acknowledged: [ackToken(wing)], muted: [] } },
    mutedCategory: { insights: active(brake, ers), alerts: { acknowledged: [], muted: ['energy'] } },
    mutedNothingActive: { insights: new Map(), alerts: { acknowledged: [], muted: ['feed'] } },
    mixed: {
      insights: active(brake, fuel, carcass, warning, wing, ers),
      alerts: { acknowledged: [ackToken(wing)], muted: ['energy'] },
    },
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
