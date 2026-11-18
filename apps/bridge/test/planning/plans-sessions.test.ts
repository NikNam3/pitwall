// SP4.3f Task 1 (C54, C55, C61, C62; spec §4.0 idea 2, §4.2 "The stored-sessions topic"): `plans.sessions` lists every
// stored practice and qualifying once per session and team it is stored for (the team of each stored row's player
// car), newest first, then by session uid. A session stored by two of the team's feeds (one row per player car) is one
// entry: its `startedAt` is the earliest row's, its `cars` the first row's in start order (its player car, then its
// teammate), and it is `stale` when any of its rows is of another rules version. The topic is bridge user state,
// published as a global core topic (C54, C55). Rows are built in memory: no storage is read here (C84).
//
// Seams this file assumes (the implement phase adds them; the import fails until then):
//  - `apps/bridge/src/planning/sessions-topic.ts`: `sessionEntriesOf(rows, rulesVersion)` (pure) and
//    `publishStoredSessions({ hub, repo, rulesVersion })`, which publishes `plans.sessions` with `hub.publishGlobal`.
import { describe, expect, it, vi } from 'vitest';
import type { TopicName, TopicValue } from '@pitwall/contracts';
import { known, unknown, type CarId, type CarKey, type SessionUid } from '@pitwall/domain';
import type { TopicHub, ValueFor } from '../../src/hub/topic-hub.ts';
import { publishStoredSessions, sessionEntriesOf } from '../../src/planning/sessions-topic.ts';
import type { StoredSessionKind, StoredSessionRow } from '../../src/storage/db.ts';

const RULES = 'rules-of-this-bridge';
const TEXAS = 15;
const WEEKEND = '548397152';
const PRACTICE = '4011121896695002375';
const QUALIFYING = '12101553556244014932';
const RACE = '8123456789012345678';

const MERCEDES_64: CarKey = { teamId: 0, raceNumber: 64 };
const MERCEDES_2: CarKey = { teamId: 0, raceNumber: 2 };
const FERRARI_16: CarKey = { teamId: 1, raceNumber: 16 };
const FERRARI_55: CarKey = { teamId: 1, raceNumber: 55 };

const car = (n: number) => n as CarId;

/** The Texas grid's slots this file needs: Mercedes in 0 and 1 (#64 named, #2 not), Ferrari in 5 and 6. */
const CARS: StoredSessionRow['cars'] = [
  { carId: car(0), carKey: MERCEDES_64, driver: known('Asymetrisch', 0) },
  { carId: car(1), carKey: MERCEDES_2, driver: unknown('notReceived') },
  { carId: car(5), carKey: FERRARI_16, driver: known('DR', 0) },
  { carId: car(6), carKey: FERRARI_55, driver: known('Sainz', 0) },
];

/** The teammate each player car's feed placed: Mercedes 0 ↔ 1, Ferrari 5 ↔ 6. */
const TEAMMATE: Record<number, number> = { 0: 1, 1: 0, 5: 6, 6: 5 };

/** A complete stored row of the Texas weekend as `storedSessions` gives it, of this bridge's rules version unless told. */
const row = (uid: string, kind: StoredSessionKind, playerCar: number, startedAt: string, o: Partial<StoredSessionRow> = {}): StoredSessionRow => ({
  sessionUid: uid as SessionUid,
  weekendId: WEEKEND,
  seasonId: '1',
  playerCar: car(playerCar),
  teammateCar: car(TEAMMATE[playerCar]!),
  trackId: TEXAS,
  startedAt,
  pwrecPath: `/rec/${uid}-${playerCar}.pwrec.gz`,
  settings: {},
  cars: CARS,
  kind,
  rulesVersion: RULES,
  complete: true,
  ...o,
});

/** The Texas pair, each stored by both of team 0's feeds (player cars 0 and 1), in start order. */
const TEXAS_PAIR: StoredSessionRow[] = [
  row(PRACTICE, 'practice', 1, '2026-11-16T19:00:00.000Z'),
  row(PRACTICE, 'practice', 0, '2026-11-16T19:00:02.000Z'),
  row(QUALIFYING, 'qualifying', 0, '2026-11-16T20:00:00.000Z'),
  row(QUALIFYING, 'qualifying', 1, '2026-11-16T20:00:03.000Z'),
];

describe('sessionEntriesOf: the stored sessions per team (C62)', () => {
  it('two feeds, one entry: the Texas pair stored twice gives two entries, the earlier row\'s player first', () => {
    expect(sessionEntriesOf(TEXAS_PAIR, RULES)).toEqual([
      {
        ref: { sessionUid: QUALIFYING, weekendId: WEEKEND },
        kind: 'qualifying',
        trackId: TEXAS,
        startedAt: '2026-11-16T20:00:00.000Z',
        team: 0,
        cars: [{ carId: 0, raceNumber: 64, name: 'Asymetrisch' }, { carId: 1, raceNumber: 2, name: null }],
        stale: false,
      },
      {
        ref: { sessionUid: PRACTICE, weekendId: WEEKEND },
        kind: 'practice',
        trackId: TEXAS,
        startedAt: '2026-11-16T19:00:00.000Z',
        team: 0,
        cars: [{ carId: 1, raceNumber: 2, name: null }, { carId: 0, raceNumber: 64, name: 'Asymetrisch' }],
        stale: false,
      },
    ]);
  });

  it('the 18 Nov race row is not listed', () => {
    const race = row(RACE, 'race', 0, '2026-11-18T20:00:00.000Z');
    const entries = sessionEntriesOf([...TEXAS_PAIR, race], RULES);
    expect(entries.map((e) => e.ref.sessionUid)).toEqual([QUALIFYING, PRACTICE]);
  });

  it('a row of team 1 in the same session is its own entry for team 1', () => {
    const ferrari = row(QUALIFYING, 'qualifying', 5, '2026-11-16T20:00:05.000Z');
    const entries = sessionEntriesOf([...TEXAS_PAIR, ferrari], RULES);
    expect(entries.map((e) => [e.ref.sessionUid, e.team])).toEqual([[QUALIFYING, 1], [QUALIFYING, 0], [PRACTICE, 0]]);
    expect(entries[0]).toEqual({
      ref: { sessionUid: QUALIFYING, weekendId: WEEKEND },
      kind: 'qualifying',
      trackId: TEXAS,
      startedAt: '2026-11-16T20:00:05.000Z',
      team: 1,
      cars: [{ carId: 5, raceNumber: 16, name: 'DR' }, { carId: 6, raceNumber: 55, name: 'Sainz' }],
      stale: false,
    });
  });

  it('a session with one stale row is stale', () => {
    const rows = TEXAS_PAIR.map((r) => (r.sessionUid === QUALIFYING && r.playerCar === 1 ? { ...r, rulesVersion: 'an-older-bridge' } : r));
    const entries = sessionEntriesOf(rows, RULES);
    expect(entries.map((e) => [e.ref.sessionUid, e.stale])).toEqual([[QUALIFYING, true], [PRACTICE, false]]);
  });

  it('a row without a teammate lists only its player car', () => {
    const alone = row(QUALIFYING, 'qualifying', 5, '2026-11-16T20:00:05.000Z', { teammateCar: null });
    expect(sessionEntriesOf([alone], RULES)[0]?.cars).toEqual([{ carId: 5, raceNumber: 16, name: 'DR' }]);
  });

  it('is sorted newest first, then by session uid', () => {
    const at = '2026-11-16T20:00:00.000Z';
    const rows = [row('300', 'practice', 0, at), row('100', 'practice', 0, at), row('200', 'qualifying', 0, '2026-11-16T21:00:00.000Z')];
    expect(sessionEntriesOf(rows, RULES).map((e) => e.ref.sessionUid)).toEqual(['200', '100', '300']);
  });
});

/** A hub that records what is published globally; a per-feed publication is a failure (the topic is global). */
function hubFake() {
  const published: Array<{ topic: TopicName; value: unknown }> = [];
  const hub = {
    publishGlobal: vi.fn((topic: TopicName, valueFor: ValueFor) => { published.push({ topic, value: valueFor({}) }); }),
    publishState: vi.fn(() => { throw new Error('plans.sessions is a global topic: published with publishGlobal'); }),
  };
  return { hub: hub as unknown as TopicHub, published };
}

describe('publishStoredSessions: plans.sessions as a global core topic (C54, C55)', () => {
  it('publishes the entries of the repository\'s rows on the global topic plans.sessions', () => {
    const { hub, published } = hubFake();
    publishStoredSessions({ hub, repo: { storedSessions: () => TEXAS_PAIR }, rulesVersion: RULES });
    const value: TopicValue<'plans.sessions'> = { sessions: sessionEntriesOf(TEXAS_PAIR, RULES) };
    expect(published).toEqual([{ topic: 'plans.sessions', value }]);
  });

  it('with no rows, publishes { sessions: [] }', () => {
    const { hub, published } = hubFake();
    publishStoredSessions({ hub, repo: { storedSessions: () => [] }, rulesVersion: RULES });
    expect(published).toEqual([{ topic: 'plans.sessions', value: { sessions: [] } }]);
  });
});
