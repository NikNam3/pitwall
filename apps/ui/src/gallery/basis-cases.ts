// The basis and plan picker's gallery cases (SP4.3e Task 7c-2, spec §4.2): topic overrides by case name, typed by the
// contracts. The gallery draws each as the picker overlay (`shell/basis-picker/<name>`, `cells.ts`); the top bar's
// basis segment is drawn under `none` and `laps-differ` (`topbar-cases.ts` `basis-none`, `basis-laps-differ`).
// fit.spec checks every cell.
import type { BasisActive, FeedStatus, PlanningRoundState, SessionInfo, TopicValue } from '@pitwall/contracts';
import { carId, feedId, type SessionRef } from '@pitwall/domain';
import type { GalleryOverride } from './gallery-connection.ts';

const TEXAS = 15;
const WEEKEND = '548397152';
const OLD_WEEKEND = '411122233';
const P16: SessionRef = { sessionUid: '4011121896695002375', weekendId: WEEKEND };
const P17: SessionRef = { sessionUid: '5022233344455566677', weekendId: WEEKEND };
const Q17: SessionRef = { sessionUid: '12101553556244014932', weekendId: WEEKEND };
const P03: SessionRef = { sessionUid: '7766554433221100998', weekendId: OLD_WEEKEND };
const Q04: SessionRef = { sessionUid: '9988776655443322110', weekendId: OLD_WEEKEND };
const key = (ref: SessionRef): string => `${ref.sessionUid}@${ref.weekendId}`;

/** Every stored session of the seat on the track: this weekend's and the 3–4 Nov weekend's. */
const SESSIONS: BasisActive['sessions'] = {
  [key(P17)]: { date: '2026-11-17', kind: 'practice', trackId: TEXAS, stale: false },
  [key(P16)]: { date: '2026-11-16', kind: 'practice', trackId: TEXAS, stale: false },
  [key(P03)]: { date: '2026-11-03', kind: 'practice', trackId: TEXAS, stale: false },
  [key(Q17)]: { date: '2026-11-17', kind: 'qualifying', trackId: TEXAS, stale: false },
  [key(Q04)]: { date: '2026-11-04', kind: 'qualifying', trackId: TEXAS, stale: false },
};

const MORNING = { id: 'plan-texas-1809', name: 'Texas 18 Nov 09:40', laps: 56 };
const SAVED: PlanningRoundState = {
  open: false,
  saved: [
    { id: MORNING.id, name: MORNING.name, savedAt: '2026-11-18T09:40:00.000Z' },
    { id: 'plan-texas-0411', name: 'Texas 4 Nov', savedAt: '2026-11-04T21:10:00.000Z' },
  ],
};
const OWN: BasisActive['basis'] = { practice: [P16, P17], qualifying: Q17 };
const NONE: BasisActive['basis'] = { practice: [], qualifying: null };

const basis = (over: Partial<BasisActive>): BasisActive => ({
  basis: OWN,
  start: OWN,
  sessions: SESSIONS,
  plan: MORNING,
  raceLaps: 56,
  rebuilding: null,
  lastChoice: null,
  ...over,
});
const inSession: FeedStatus = {
  feedId: feedId('gallery'),
  connected: true,
  stale: false,
  lossPercent: 0,
  latePackets: 0,
  decodeErrors: 0,
  packetsPerSecond: 60,
  betweenSessions: false,
};
/** A running session (only its feed and cars matter to the picker): the in-session picker shows (SP4.3f Task 6). */
const SESSION: SessionInfo = { feedId: feedId('gallery'), sessionUid: '1', playerCar: carId(0), teammateCar: carId(1), realism: false } as SessionInfo;
const of = (value: BasisActive): GalleryOverride[] => [
  { topic: 'session.info', value: SESSION },
  { topic: 'basis.active', value },
  { topic: 'plans.prepared', value: SAVED },
  { topic: 'feed.status', value: inSession },
];

// The picker between sessions (SP4.3f Task 6, spec §4.4; mockup docs/design/2026-11-18-sp4.3f/picker-between-sessions.html):
// no `session.info`, the global `plans.sessions` (one entry per session and team, newest first), no round open.
type StoredSessionEntry = TopicValue<'plans.sessions'>['sessions'][number];
const ZANDVOORT = 26;
const SINGAPORE = 12;
const MERCEDES = 0;
const FERRARI = 1;
const NEXT_WEEKEND = '548461001';
const Q18: SessionRef = { sessionUid: '6100200300400500601', weekendId: NEXT_WEEKEND };
const ZQ10: SessionRef = { sessionUid: '7000000000000000010', weekendId: '547100202' };
const SQ13: SessionRef = { sessionUid: '7100000000000000013', weekendId: '547400404' };
const seat = (...cars: [number, number][]): StoredSessionEntry['cars'] => cars.map(([car, raceNumber]) => ({ carId: carId(car), raceNumber, name: null }));
const OUR_SEAT = seat([0, 64], [1, 2]);
const stored = (ref: SessionRef, kind: StoredSessionEntry['kind'], trackId: number, startedAt: string, over: Partial<StoredSessionEntry> = {}): StoredSessionEntry => ({
  ref,
  kind,
  trackId,
  startedAt,
  team: MERCEDES,
  cars: OUR_SEAT,
  stale: false,
  ...over,
});
const OTHER_TRACKS = [stored(SQ13, 'qualifying', SINGAPORE, '2026-11-13T19:00:00.000Z'), stored(ZQ10, 'qualifying', ZANDVOORT, '2026-11-10T19:00:00.000Z')];
const between = (sessions: StoredSessionEntry[]): GalleryOverride[] => [
  { topic: 'plans.sessions', value: { sessions } },
  { topic: 'session.info' },
  { topic: 'basis.active' },
  { topic: 'plans.prepared', value: { open: false, saved: [] } satisfies PlanningRoundState },
  { topic: 'feed.status', value: { ...inSession, betweenSessions: true } },
];

/** The cases by name, in gallery order; the first has the picker's one baseline. */
export const BASIS_CASES = {
  // The session's own weekend: both practices and the qualifying preselected, the morning's plan.
  'own-weekend': of(basis({})),
  // No stored session and no plan chosen: every kind none.
  none: of(basis({ basis: NONE, start: NONE, plan: null })),
  // The team's last confirmed choice on the track (the 3–4 Nov weekend), in use and marked.
  'last-choice': of(
    basis({
      basis: { practice: [P03], qualifying: Q04 },
      start: { practice: [P03], qualifying: Q04 },
      plan: { id: 'plan-texas-0411', name: 'Texas 4 Nov', laps: 56 },
      lastChoice: { basis: { practice: [P03], qualifying: Q04 }, plan: 'plan-texas-0411' },
    }),
  ),
  // A confirmed basis being rebuilt: one of three sessions current.
  rebuilding: of(basis({ rebuilding: { done: 1, total: 3 } })),
  // A plan computed for 56 laps in a 20-lap race.
  'laps-differ': of(basis({ raceLaps: 20 })),
  // Between sessions, preselected: Texas, the 17 Nov qualifying of Mercedes (#64 #2), its practice; an older stale one.
  'planning-texas-pair': between([
    stored(Q17, 'qualifying', TEXAS, '2026-11-17T19:10:00.000Z'),
    stored(P17, 'practice', TEXAS, '2026-11-17T18:05:00.000Z'),
    ...OTHER_TRACKS,
    stored(Q04, 'qualifying', TEXAS, '2026-11-04T19:10:00.000Z', { stale: true }),
    stored(P03, 'practice', TEXAS, '2026-11-03T18:00:00.000Z'),
  ]),
  // One 18 Nov qualifying stored for two teams (our drivers in two teams): listed once per team; the 17 Nov practice
  // of the earlier weekend is offered, not preselected.
  'planning-two-teams': between([
    stored(Q18, 'qualifying', TEXAS, '2026-11-18T19:10:00.000Z', { cars: seat([3, 63], [4, 12]) }),
    stored(Q18, 'qualifying', TEXAS, '2026-11-18T19:10:00.000Z', { team: FERRARI, cars: seat([5, 2], [6, 16]) }),
    stored(P17, 'practice', TEXAS, '2026-11-17T18:05:00.000Z'),
    ...OTHER_TRACKS.slice(1),
  ]),
  // The preselected qualifying and practice stored by an older rules version: marked, rebuilt when the round opens.
  'planning-stale': between([
    stored(Q17, 'qualifying', TEXAS, '2026-11-17T19:10:00.000Z', { stale: true }),
    stored(P17, 'practice', TEXAS, '2026-11-17T18:05:00.000Z', { stale: true }),
    stored(P16, 'practice', TEXAS, '2026-11-16T18:05:00.000Z'),
  ]),
  // Nothing stored: the none-stored label, Confirm disabled.
  'planning-none-stored': between([]),
} satisfies Record<string, GalleryOverride[]>;

export type BasisCaseName = keyof typeof BASIS_CASES;
