// The name prompt "Save plan"'s gallery cases (SP4.3f Task 10, spec §4.4 "Saving in the panel"; the user's layout of
// 2026-11-18): topic overrides by case name, typed by the contracts. The gallery draws each as the prompt overlay
// (`shell/plan-save/<name>`, `cells.ts`) on the window's feed; no baseline (the screenshot budget). fit.spec checks
// every cell. The prompt's name is prefilled from the gallery's frozen clock (`fixed-clock.ts`).
import type { PlanningRoundState } from '@pitwall/contracts';
import { carId, unknown, type SessionRef } from '@pitwall/domain';
import type { GalleryOverride } from './gallery-connection.ts';

const TEXAS = 15;
const Q17: SessionRef = { sessionUid: '12101553556244014932', weekendId: '548397152' };

/** The round on Texas, saved once this morning: one `overwrite` radio. */
const ONE_SAVED: PlanningRoundState = {
  open: true,
  qualifying: Q17,
  practice: [],
  race: { laps: 56, sets: 'fresh', conditions: { kind: 'imported' } },
  team: 0,
  trackId: TEXAS,
  playerCar: carId(0),
  teammateCar: carId(1),
  forecast: { source: { ref: Q17, startedAt: '2026-11-17T19:10:00.000Z' }, rows: unknown('notReceived') },
  rebuilding: false,
  cars: {},
  running: false,
  saved: [{ id: 'plan-texas-1809', name: 'Texas 18 Nov 09:40', savedAt: '2026-11-18T08:40:00.000Z' }],
};

export const PLAN_SAVE_CASES = {
  'one-saved': [{ topic: 'plans.prepared', value: ONE_SAVED }],
} as const satisfies Record<string, readonly GalleryOverride[]>;

export type PlanSaveCaseName = keyof typeof PLAN_SAVE_CASES;
