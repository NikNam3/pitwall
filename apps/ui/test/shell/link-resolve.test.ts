// resolveLink (spec 7.5, Review Focus 5): a link group's CarRefs become concrete car ids through session.info.
// SP4.3b2 Task 11 (spec §10 "Strategy workbook (U12)"; C1a): `resolveLink(group, session, defaultFeed, feeds)`, where
// `session` is the default feed's `session.info` and `feeds` every feed of the bridge's `hello` with its `session.info`
// (`{ info: FeedInfo; session: SessionInfo | undefined }[]`). A `teammate` primary without `group.feedId` resolves to the
// feed of the same session uid and team (`FeedInfo.team`) whose `playerCar` is the default feed's `teammateCar`, with that
// car as primary; otherwise as before (the earlier cases pass `[]`: ported, C82).
// SP4.3f Task 5 (spec §4.0 3, §4.4 "Link resolution"; C64, C65): `resolveLink(group, session, defaultFeed, feeds, round)`,
// `round` the default feed's `plans.prepared` while open (`Extract<PlanningRoundState, { open: true }> | undefined`).
// With no session and an open round, `player` → `round.playerCar` and `teammate` → `round.teammateCar` on the default
// feed; a primary `teammate` with `teammateCar: null` is unresolved. With a session, the session decides, as today. The
// earlier cases pass `undefined` as the round (ported, C82). Fails until `resolveLink` reads the round (implementation).
import type { FeedInfo, LinkGroup, PlanningRoundState, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, unknown, type FeedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { resolveLink } from '../../src/shell/link-groups/resolve.ts';

const DEFAULT_FEED = feedId('f1');
const session = (playerCar: number, teammateCar?: number): SessionInfo =>
  ({ feedId: DEFAULT_FEED, playerCar: carId(playerCar), ...(teammateCar === undefined ? {} : { teammateCar: carId(teammateCar) }) }) as unknown as SessionInfo;
const group = (extra: Partial<LinkGroup> = {}): LinkGroup => ({ id: 1, primary: 'player', compare: [], window: { kind: 'live' }, ...extra });

describe('resolveLink', () => {
  it('"player" resolves to session.playerCar and the link carries group, default feed and window', () => {
    expect(resolveLink(group({ id: 2, window: { kind: 'lap', lap: 4 } }), session(5), DEFAULT_FEED, [], undefined)).toEqual({
      group: 2,
      feedId: DEFAULT_FEED,
      primary: carId(5),
      compare: [],
      window: { kind: 'lap', lap: 4 },
    });
  });

  it('"player" follows a new session.info.playerCar (Review Focus 5)', () => {
    const g = group({ compare: ['player'] });
    expect(resolveLink(g, session(5), DEFAULT_FEED, [], undefined)).toMatchObject({ primary: carId(5), compare: [carId(5)] });
    expect(resolveLink(g, session(9), DEFAULT_FEED, [], undefined)).toMatchObject({ primary: carId(9), compare: [carId(9)] });
  });

  it('the group\'s own feedId wins over the default feed', () => {
    expect(resolveLink(group({ feedId: feedId('f2') }), session(5), DEFAULT_FEED, [], undefined)?.feedId).toBe('f2');
  });

  it('"teammate" resolves to session.teammateCar', () => {
    const link = resolveLink(group({ primary: 'teammate', compare: ['player'] }), session(5, 6), DEFAULT_FEED, [], undefined);
    expect(link).toMatchObject({ primary: carId(6), compare: [carId(5)] });
  });

  it('"teammate" without a teammate: dropped from compare, and as primary the whole link is undefined', () => {
    expect(resolveLink(group({ compare: ['teammate', carId(7), 'player'] }), session(5), DEFAULT_FEED, [], undefined)?.compare).toEqual([carId(7), carId(5)]);
    expect(resolveLink(group({ primary: 'teammate' }), session(5), DEFAULT_FEED, [], undefined)).toBeUndefined();
  });

  it('an explicit CarId stays as given, in order, whatever the session says', () => {
    const link = resolveLink(group({ primary: carId(12), compare: [carId(3), carId(19)] }), session(5, 6), DEFAULT_FEED, [], undefined);
    expect(link).toMatchObject({ primary: carId(12), compare: [carId(3), carId(19)] });
  });

  it('without a session, "player" cannot be resolved', () => {
    expect(resolveLink(group(), undefined, DEFAULT_FEED, [], undefined)).toBeUndefined();
  });
});

describe('resolveLink: group 2 and the teammate\'s feed (SP4.3b2 Task 11)', () => {
  const MERCEDES = 0;
  const FERRARI = 1;
  /** Group 2's default (the bridge's ui-state). */
  const group2: LinkGroup = { id: 2, primary: 'teammate', compare: [], window: { kind: 'live' } };
  const sessionOf = (feed: FeedId, playerCar: number, teammateCar: number | undefined, sessionUid = 's1'): SessionInfo =>
    ({ feedId: feed, sessionUid, playerCar: carId(playerCar), ...(teammateCar === undefined ? {} : { teammateCar: carId(teammateCar) }) }) as unknown as SessionInfo;
  const feedOf = (feed: FeedId, team: number | null, s: SessionInfo | undefined) => ({
    info: { feedId: feed, kind: 'udp', label: feed, team, ...(s === undefined ? {} : { sessionUid: s.sessionUid }) } satisfies FeedInfo,
    session: s,
  });
  const F2 = feedId('f2');

  it('two feeds of one team: group 2 resolves to the teammate\'s own feed and car', () => {
    const own = sessionOf(DEFAULT_FEED, 5, 6);
    const teammate = sessionOf(F2, 6, 5);
    // A feed of another session and a feed of another team, both with car 6 as their player car, are not the teammate's.
    const otherSession = sessionOf(feedId('f3'), 6, 5, 's0');
    const otherTeam = sessionOf(feedId('f4'), 6, undefined);
    const feeds = [
      feedOf(DEFAULT_FEED, MERCEDES, own),
      feedOf(feedId('f3'), MERCEDES, otherSession),
      feedOf(feedId('f4'), FERRARI, otherTeam),
      feedOf(F2, MERCEDES, teammate),
    ];
    expect(resolveLink(group2, own, DEFAULT_FEED, feeds, undefined)).toEqual({ group: 2, feedId: F2, primary: carId(6), compare: [], window: { kind: 'live' } });
    // Group 1 stays on the default feed's player.
    expect(resolveLink(group({ id: 1 }), own, DEFAULT_FEED, feeds, undefined)).toMatchObject({ feedId: DEFAULT_FEED, primary: carId(5) });
  });

  it('one feed: group 2 resolves to the teammate in that feed', () => {
    const own = sessionOf(DEFAULT_FEED, 5, 6);
    expect(resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, MERCEDES, own)], undefined)).toEqual({
      group: 2,
      feedId: DEFAULT_FEED,
      primary: carId(6),
      compare: [],
      window: { kind: 'live' },
    });
  });

  it('no teammate: group 2 unresolved, no throw', () => {
    const own = sessionOf(DEFAULT_FEED, 5, undefined);
    const rival = sessionOf(F2, 9, undefined);
    expect(() => resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, MERCEDES, own)], undefined)).not.toThrow();
    expect(resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, MERCEDES, own)], undefined)).toBeUndefined();
    expect(resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, MERCEDES, own), feedOf(F2, FERRARI, rival)], undefined)).toBeUndefined();
    // A feed whose team or session is not known yet.
    expect(resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, null, own), feedOf(F2, null, undefined)], undefined)).toBeUndefined();
    expect(resolveLink(group2, undefined, DEFAULT_FEED, [], undefined)).toBeUndefined();
  });
});

describe('resolveLink between sessions: the planning round\'s cars (SP4.3f Task 5)', () => {
  type OpenRound = Extract<PlanningRoundState, { open: true }>;
  const TEAM = 0;
  /** An open round on the default feed: its player car and teammate are slots of the replayed qualifying. */
  const round = (playerCar: number, teammateCar: number | null): OpenRound => ({
    open: true,
    qualifying: { sessionUid: '12101553556244014932', weekendId: '548397152' },
    practice: [{ sessionUid: '5022233344455566677', weekendId: '548397152' }],
    race: { laps: 56, sets: 'fresh', conditions: { kind: 'imported' } },
    team: TEAM,
    trackId: 15,
    playerCar: carId(playerCar),
    teammateCar: teammateCar === null ? null : carId(teammateCar),
    forecast: { source: { ref: { sessionUid: '12101553556244014932', weekendId: '548397152' }, startedAt: '2026-11-17T14:00:00.000Z' }, rows: unknown('notReceived') },
    rebuilding: false,
    cars: {},
    running: false,
    saved: [],
  });
  /** Between sessions the bridge's feeds have no `session.info`. */
  const idle = [{ info: { feedId: DEFAULT_FEED, kind: 'udp', label: 'f1', team: null } satisfies FeedInfo, session: undefined }];
  const teammateGroup = (extra: Partial<LinkGroup> = {}): LinkGroup => group({ id: 2, primary: 'teammate', ...extra });

  it('no session, a round with playerCar 19 and teammateCar 18: player resolves to 19 and teammate to 18 on the default feed', () => {
    const r = round(19, 18);
    expect(resolveLink(group(), undefined, DEFAULT_FEED, idle, r)).toEqual({ group: 1, feedId: DEFAULT_FEED, primary: carId(19), compare: [], window: { kind: 'live' } });
    expect(resolveLink(teammateGroup(), undefined, DEFAULT_FEED, idle, r)).toEqual({ group: 2, feedId: DEFAULT_FEED, primary: carId(18), compare: [], window: { kind: 'live' } });
    // As compare cars too, in order.
    expect(resolveLink(group({ compare: ['teammate', 'player'] }), undefined, DEFAULT_FEED, idle, r)?.compare).toEqual([carId(18), carId(19)]);
    // Without any feed list (no hello yet), still the default feed.
    expect(resolveLink(teammateGroup(), undefined, DEFAULT_FEED, [], r)).toMatchObject({ feedId: DEFAULT_FEED, primary: carId(18) });
  });

  it('teammateCar null: the teammate group is undefined', () => {
    const r = round(19, null);
    expect(resolveLink(teammateGroup(), undefined, DEFAULT_FEED, idle, r)).toBeUndefined();
    // As a compare car it is dropped; the player still resolves.
    expect(resolveLink(group({ compare: ['teammate'] }), undefined, DEFAULT_FEED, idle, r)).toMatchObject({ primary: carId(19), compare: [] });
  });

  it('with a session, its cars win', () => {
    const r = round(19, 18);
    expect(resolveLink(group(), session(5, 6), DEFAULT_FEED, [], r)).toMatchObject({ feedId: DEFAULT_FEED, primary: carId(5) });
    expect(resolveLink(teammateGroup(), session(5, 6), DEFAULT_FEED, [], r)).toMatchObject({ feedId: DEFAULT_FEED, primary: carId(6) });
    // A session without a teammate: the round's teammate is not borrowed.
    expect(resolveLink(teammateGroup(), session(5), DEFAULT_FEED, [], r)).toBeUndefined();
  });
});
