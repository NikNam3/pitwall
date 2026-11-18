// SP4.3e Task 7c-2: the `basis.active` and `plans.prepared` values the shell's basis tests push (C54, C62, C62d).
// Track 15 (Texas): two practices (16 and 17 Nov), the 17 Nov qualifying of the weekend, the 4 Nov qualifying of the
// team's last confirmed choice; two saved plans of the team. `sessions` lists every stored session of the feed's seat
// on the track (the picker's candidates), keyed `<sessionUid>@<weekendId>`.
import type { BasisActive, PlanningRoundState } from '@pitwall/contracts';
import type { SessionRef } from '@pitwall/domain';

export const TRACK = 15;
export const WEEKEND = '548397152';
export const OLD_WEEKEND = '411122233';

export const P16: SessionRef = { sessionUid: '4011121896695002375', weekendId: WEEKEND };
export const P17: SessionRef = { sessionUid: '5022233344455566677', weekendId: WEEKEND };
export const Q17: SessionRef = { sessionUid: '12101553556244014932', weekendId: WEEKEND };
export const Q04: SessionRef = { sessionUid: '9988776655443322110', weekendId: OLD_WEEKEND };

/** The picker's key of a session, as `basis.active.sessions` keys it. */
export const keyOf = (ref: SessionRef): string => `${ref.sessionUid}@${ref.weekendId}`;

export const SESSIONS: BasisActive['sessions'] = {
  [keyOf(P16)]: { date: '2026-11-16', kind: 'practice', trackId: TRACK },
  [keyOf(Q04)]: { date: '2026-11-04', kind: 'qualifying', trackId: TRACK },
  [keyOf(P17)]: { date: '2026-11-17', kind: 'practice', trackId: TRACK },
  [keyOf(Q17)]: { date: '2026-11-17', kind: 'qualifying', trackId: TRACK },
};

export const PLAN_NAME = 'Texas 18 Nov 09:40';
export const PLAN_ID = 'plan-texas-1809';
export const OLD_PLAN_ID = 'plan-texas-0411';

/** The basis in use: the 17 Nov practice and qualifying, the morning's saved plan, computed for 56 laps of a 56-lap race. */
export const active = (over: Partial<BasisActive> = {}): BasisActive => ({
  basis: { practice: [P17], qualifying: Q17 },
  start: { practice: [P17], qualifying: Q17 },
  sessions: SESSIONS,
  plan: { id: PLAN_ID, name: PLAN_NAME, laps: 56 },
  raceLaps: 56,
  rebuilding: null,
  lastChoice: null,
  ...over,
});

export const SAVED: PlanningRoundState['saved'] = [
  { id: OLD_PLAN_ID, name: 'Texas 4 Nov', savedAt: '2026-11-04T21:10:00.000Z' },
  { id: PLAN_ID, name: PLAN_NAME, savedAt: '2026-11-18T09:40:00.000Z' },
];

/** `plans.prepared` outside a planning round: the team's saved plans on the track only (R15). */
export const CLOSED_ROUND: PlanningRoundState = { open: false, saved: SAVED };
