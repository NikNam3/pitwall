// SP4.3f Task 6: the `plans.sessions` values the picker-between-sessions tests push (spec §4.2, §4.4; C62d, C54).
// The Texas pair: the 17 Nov practice and qualifying of weekend 548397152, stored for Mercedes (team 0, #64 #2).
// Plus one 18 Nov practice of the next Texas weekend, stored for Mercedes (#63 #12, another seat) and for Ferrari
// (team 1, #2 #16): one entry per team it is stored for. Plus Zandvoort (track 26): a 10 Nov qualifying and practice of
// one weekend and a 3 Nov practice of an earlier weekend, all Mercedes. Entries in the topic's order, newest first.
import type { TopicValue } from '@pitwall/contracts';
import { carId, type SessionRef } from '@pitwall/domain';

/** `plans.sessions` (`packages/contracts/src/topics/plans.sessions.ts`). */
export type PlansSessions = TopicValue<'plans.sessions'>;
export type StoredSessionEntry = PlansSessions['sessions'][number];

export const TEXAS = 15;
export const ZANDVOORT = 26;
export const MERCEDES = 0;
export const FERRARI = 1;

export const WEEKEND = '548397152';
export const NEXT_WEEKEND = '548461001';
export const ZANDVOORT_WEEKEND = '547100202';
export const OLD_ZANDVOORT_WEEKEND = '546600303';

export const TEXAS_P17: SessionRef = { sessionUid: '4011121896695002375', weekendId: WEEKEND };
export const TEXAS_Q17: SessionRef = { sessionUid: '12101553556244014932', weekendId: WEEKEND };
export const TEXAS_P18: SessionRef = { sessionUid: '6100200300400500600', weekendId: NEXT_WEEKEND };
export const ZANDVOORT_Q10: SessionRef = { sessionUid: '7000000000000000010', weekendId: ZANDVOORT_WEEKEND };
export const ZANDVOORT_P10: SessionRef = { sessionUid: '7000000000000000011', weekendId: ZANDVOORT_WEEKEND };
export const ZANDVOORT_P03: SessionRef = { sessionUid: '7000000000000000003', weekendId: OLD_ZANDVOORT_WEEKEND };

/** A session's key, as `candidates.ts` `sessionKey` makes it: `<sessionUid>@<weekendId>`. */
export const keyOf = (ref: SessionRef): string => `${ref.sessionUid}@${ref.weekendId}`;
/** A qualifying option's key (`PlanningDraft.qualifying`): `<sessionKey>#<team>`. */
export const qualifyingKey = (ref: SessionRef, team: number): string => `${keyOf(ref)}#${team}`;

const OUR_SEAT = [
  { carId: carId(0), raceNumber: 64, name: null },
  { carId: carId(1), raceNumber: 2, name: null },
];

const entry = (
  ref: SessionRef,
  kind: StoredSessionEntry['kind'],
  trackId: number,
  startedAt: string,
  team = MERCEDES,
  cars: StoredSessionEntry['cars'] = OUR_SEAT,
  stale = false,
): StoredSessionEntry => ({ ref, kind, trackId, startedAt, team, cars, stale });

export const P18_MERCEDES = entry(TEXAS_P18, 'practice', TEXAS, '2026-11-18T17:30:00.000Z', MERCEDES, [
  { carId: carId(3), raceNumber: 63, name: null },
  { carId: carId(4), raceNumber: 12, name: null },
]);
export const P18_FERRARI = entry(TEXAS_P18, 'practice', TEXAS, '2026-11-18T17:30:00.000Z', FERRARI, [
  { carId: carId(5), raceNumber: 2, name: null },
  { carId: carId(6), raceNumber: 16, name: null },
]);
export const Q17 = entry(TEXAS_Q17, 'qualifying', TEXAS, '2026-11-17T19:10:00.000Z');
export const P17 = entry(TEXAS_P17, 'practice', TEXAS, '2026-11-17T18:05:00.000Z');
export const ZQ10 = entry(ZANDVOORT_Q10, 'qualifying', ZANDVOORT, '2026-11-10T19:00:00.000Z');
export const ZP10 = entry(ZANDVOORT_P10, 'practice', ZANDVOORT, '2026-11-10T17:45:00.000Z');
export const ZP03 = entry(ZANDVOORT_P03, 'practice', ZANDVOORT, '2026-11-03T17:45:00.000Z');

/** Every stored practice and qualifying of the tests, newest first. */
export const STORED: PlansSessions = { sessions: [P18_MERCEDES, P18_FERRARI, Q17, P17, ZQ10, ZP10, ZP03] };

/** The same, with the 18 Nov session a qualifying (its two teams' entries): a qualifying stored for two teams. */
export const STORED_TWO_TEAM_QUALIFYING: PlansSessions = {
  sessions: STORED.sessions.map((s): StoredSessionEntry => (s.ref === TEXAS_P18 ? { ...s, kind: 'qualifying' } : s)),
};
