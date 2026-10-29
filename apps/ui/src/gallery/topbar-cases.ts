// The top bar's gallery cases (spec 10): topic overrides by case name, typed by the contracts. Task 4 draws them as cells.
import type { InsightEntry, ReplayStatus, TopicValue, UiSettings } from '@pitwall/contracts';
import { feedId, known, unknown } from '@pitwall/domain';
import type { GalleryOverride } from './gallery-connection.ts';

/** A battle: a car within reach on the next laps (spec 7.2, moment 4); battle has no `since` (ruling R1). */
const battle: TopicValue<'raceMoment.current'> = known(
  { moment: 'battle', since: unknown('notApplicable'), cause: { rule: 'battle', params: { carId: 3, lapsToDrs: 1.5 } }, active: ['battle', 'carCare'] },
  1_200_000,
);

/** One tier-1 alert (a critical insight, not acknowledged, not muted): a new 5 s penalty. */
const alertEntries: InsightEntry[] = [
  { type: 'raised', insight: { key: 'gallery-critical', severity: 'critical', category: 'race', feedId: feedId('gallery'), kind: 'penaltyNew', params: { timeMs: 5000 }, raisedAt: 600_000 } },
];

/** The session's realism differs from the setting for the next one. */
const realismPending: UiSettings = { realismNextSession: false, keys: {} };

/** A replay paused at lap 2, at the recorded pace. */
const replayStatus: ReplayStatus = { paused: true, speed: 1, sessionTimeMs: 600_000, playerLap: 2, atEnd: false };

/** The top bar's cases by name; Task 4's cells are `topbar/<name>`. The base moment (race, a realism-on session) is the cell's. */
export const TOP_BAR_CASES = {
  'race-alert': [
    { topic: 'insights', value: alertEntries },
    { topic: 'ui.alerts', value: { acknowledged: [], muted: [] } },
  ],
  'realism-pending': [{ topic: 'ui.settings', value: realismPending }],
  'replay-transport': [{ topic: 'replay.status', value: replayStatus }],
  battle: [{ topic: 'raceMoment.current', value: battle }],
} satisfies Record<string, GalleryOverride[]>;
