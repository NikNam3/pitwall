// resolveLink (spec 7.5, Review Focus 5): a link group's CarRefs become concrete car ids through session.info.
// SP4.3b2 Task 11 (spec §10 "Strategy workbook (U12)"; C1a): `resolveLink(group, session, defaultFeed, feeds)`, where
// `session` is the default feed's `session.info` and `feeds` every feed of the bridge's `hello` with its `session.info`
// (`{ info: FeedInfo; session: SessionInfo | undefined }[]`). A `teammate` primary without `group.feedId` resolves to the
// feed of the same session uid and team (`FeedInfo.team`) whose `playerCar` is the default feed's `teammateCar`, with that
// car as primary; otherwise as before (the earlier cases pass `[]`: ported, C82).
import type { FeedInfo, LinkGroup, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, type FeedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { resolveLink } from '../../src/shell/link-groups/resolve.ts';

const DEFAULT_FEED = feedId('f1');
const session = (playerCar: number, teammateCar?: number): SessionInfo =>
  ({ feedId: DEFAULT_FEED, playerCar: carId(playerCar), ...(teammateCar === undefined ? {} : { teammateCar: carId(teammateCar) }) }) as unknown as SessionInfo;
const group = (extra: Partial<LinkGroup> = {}): LinkGroup => ({ id: 1, primary: 'player', compare: [], window: { kind: 'live' }, ...extra });

describe('resolveLink', () => {
  it('"player" resolves to session.playerCar and the link carries group, default feed and window', () => {
    expect(resolveLink(group({ id: 2, window: { kind: 'lap', lap: 4 } }), session(5), DEFAULT_FEED, [])).toEqual({
      group: 2,
      feedId: DEFAULT_FEED,
      primary: carId(5),
      compare: [],
      window: { kind: 'lap', lap: 4 },
    });
  });

  it('"player" follows a new session.info.playerCar (Review Focus 5)', () => {
    const g = group({ compare: ['player'] });
    expect(resolveLink(g, session(5), DEFAULT_FEED, [])).toMatchObject({ primary: carId(5), compare: [carId(5)] });
    expect(resolveLink(g, session(9), DEFAULT_FEED, [])).toMatchObject({ primary: carId(9), compare: [carId(9)] });
  });

  it('the group\'s own feedId wins over the default feed', () => {
    expect(resolveLink(group({ feedId: feedId('f2') }), session(5), DEFAULT_FEED, [])?.feedId).toBe('f2');
  });

  it('"teammate" resolves to session.teammateCar', () => {
    const link = resolveLink(group({ primary: 'teammate', compare: ['player'] }), session(5, 6), DEFAULT_FEED, []);
    expect(link).toMatchObject({ primary: carId(6), compare: [carId(5)] });
  });

  it('"teammate" without a teammate: dropped from compare, and as primary the whole link is undefined', () => {
    expect(resolveLink(group({ compare: ['teammate', carId(7), 'player'] }), session(5), DEFAULT_FEED, [])?.compare).toEqual([carId(7), carId(5)]);
    expect(resolveLink(group({ primary: 'teammate' }), session(5), DEFAULT_FEED, [])).toBeUndefined();
  });

  it('an explicit CarId stays as given, in order, whatever the session says', () => {
    const link = resolveLink(group({ primary: carId(12), compare: [carId(3), carId(19)] }), session(5, 6), DEFAULT_FEED, []);
    expect(link).toMatchObject({ primary: carId(12), compare: [carId(3), carId(19)] });
  });

  it('without a session, "player" cannot be resolved', () => {
    expect(resolveLink(group(), undefined, DEFAULT_FEED, [])).toBeUndefined();
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
    expect(resolveLink(group2, own, DEFAULT_FEED, feeds)).toEqual({ group: 2, feedId: F2, primary: carId(6), compare: [], window: { kind: 'live' } });
    // Group 1 stays on the default feed's player.
    expect(resolveLink(group({ id: 1 }), own, DEFAULT_FEED, feeds)).toMatchObject({ feedId: DEFAULT_FEED, primary: carId(5) });
  });

  it('one feed: group 2 resolves to the teammate in that feed', () => {
    const own = sessionOf(DEFAULT_FEED, 5, 6);
    expect(resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, MERCEDES, own)])).toEqual({
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
    expect(() => resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, MERCEDES, own)])).not.toThrow();
    expect(resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, MERCEDES, own)])).toBeUndefined();
    expect(resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, MERCEDES, own), feedOf(F2, FERRARI, rival)])).toBeUndefined();
    // A feed whose team or session is not known yet.
    expect(resolveLink(group2, own, DEFAULT_FEED, [feedOf(DEFAULT_FEED, null, own), feedOf(F2, null, undefined)])).toBeUndefined();
    expect(resolveLink(group2, undefined, DEFAULT_FEED, [])).toBeUndefined();
  });
});
