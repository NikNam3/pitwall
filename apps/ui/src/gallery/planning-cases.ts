// The top bar between sessions (SP4.3f Task 5, spec §4.4; mockup docs/design/2026-11-18-sp4.3f/topbar-planning.html):
// topic overrides by case name, typed by the contracts. The gallery draws each as a top bar cell (`topbar-cases.ts`,
// `shell/topbar/planning-<name>`, no baseline: the budget). Between sessions: no `session.info`, the feed between sessions.
// fit.spec checks every cell.
import type { FeedStatus, PlanningRoundState, TopicValue } from '@pitwall/contracts';
import { carId, feedId, known, unknown, type ForecastSample, type SessionRef, type Weather } from '@pitwall/domain';
import type { GalleryOverride } from './gallery-connection.ts';

const TEXAS = 15;
const WEEKEND = '548397152';
const OLD_WEEKEND = '411122233';
const P17: SessionRef = { sessionUid: '5022233344455566677', weekendId: WEEKEND };
const Q17: SessionRef = { sessionUid: '12101553556244014932', weekendId: WEEKEND };
const P03: SessionRef = { sessionUid: '7766554433221100998', weekendId: OLD_WEEKEND };
const Q04: SessionRef = { sessionUid: '9988776655443322110', weekendId: OLD_WEEKEND };

type Entry = TopicValue<'plans.sessions'>['sessions'][number];
const CARS: Entry['cars'] = [
  { carId: carId(19), raceNumber: 64, name: null },
  { carId: carId(18), raceNumber: 13, name: null },
];
const entry = (ref: SessionRef, kind: Entry['kind'], startedAt: string, stale = false): Entry => ({ ref, kind, trackId: TEXAS, startedAt, team: 0, cars: CARS, stale });
/** The track's stored sessions: this weekend's (current) and the 3–4 Nov weekend's (the qualifying stale). */
const SESSIONS: TopicValue<'plans.sessions'> = {
  sessions: [
    entry(Q17, 'qualifying', '2026-11-17T14:00:00.000Z'),
    entry(P17, 'practice', '2026-11-17T10:00:00.000Z'),
    entry(Q04, 'qualifying', '2026-11-04T19:00:00.000Z', true),
    entry(P03, 'practice', '2026-11-03T19:00:00.000Z'),
  ],
};

const sample = (minutes: number, weather: Weather, rainPct: number): ForecastSample => ({
  offsetMs: minutes * 60_000,
  weather,
  trackTempC: 31,
  trackTempTrend: 'flat',
  airTempC: 24,
  airTempTrend: 'flat',
  rainPct,
});
/** The 17 Nov qualifying's race samples as the game sent them (rain 1 % to 12 %). */
const SAMPLES = [sample(0, 'clear', 1), sample(5, 'clear', 1), sample(10, 'clear', 2), sample(15, 'clear', 4), sample(30, 'lightCloud', 12), sample(45, 'lightCloud', 10)];

type OpenRound = Extract<PlanningRoundState, { open: true }>;
const round = (over: Partial<OpenRound> = {}): OpenRound => ({
  open: true,
  qualifying: Q17,
  practice: [P17],
  race: { laps: 56, sets: 'fresh', conditions: { kind: 'imported' } },
  team: 0,
  trackId: TEXAS,
  playerCar: carId(19),
  teammateCar: carId(18),
  forecast: { source: { ref: Q17, startedAt: '2026-11-17T14:00:00.000Z' }, rows: known(SAMPLES.map((s) => ({ sample: s, overridden: false })), 0) },
  rebuilding: false,
  cars: {},
  running: false,
  saved: [],
  ...over,
});

const betweenSessions: FeedStatus = {
  feedId: feedId('gallery'),
  connected: true,
  stale: false,
  lossPercent: 0,
  latePackets: 0,
  decodeErrors: 0,
  packetsPerSecond: 0,
  betweenSessions: true,
};
const of = (prepared: PlanningRoundState): GalleryOverride[] => [
  { topic: 'plans.prepared', value: prepared },
  { topic: 'plans.sessions', value: SESSIONS },
  { topic: 'feed.status', value: betweenSessions },
  // No session: `session.info` has no data.
  { topic: 'session.info' },
];

/** The cases by name, in gallery order. */
export const PLANNING_CASES = {
  // A fresh bridge, no round: the quiet `Plan…` button.
  'no-round': of({ open: false, saved: [] }),
  // A round open on the 17 Nov practice and qualifying, the qualifying's race samples.
  round: of(round()),
  // A pick of the 3–4 Nov weekend being rebuilt (C61).
  rebuilding: of(round({ qualifying: Q04, practice: [P03], rebuilding: true, forecast: { source: { ref: Q04, startedAt: '2026-11-04T19:00:00.000Z' }, rows: unknown('notReceived') } })),
  // A one-session lobby: no race samples and none entered, rain unknown (C3).
  'no-race-samples': of(round({ forecast: { source: { ref: Q17, startedAt: '2026-11-17T14:00:00.000Z' }, rows: unknown('notReceived') } })),
} satisfies Record<string, GalleryOverride[]>;
