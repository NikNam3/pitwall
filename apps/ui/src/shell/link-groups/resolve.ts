// Link groups to concrete cars (spec 7.5): "player" and "teammate" become car ids through `session.info`, or between
// sessions through the default feed's open planning round (SP4.3f spec §4.4).
import type { CarRef, FeedInfo, LinkGroup, PlanningRoundState, SessionInfo } from '@pitwall/contracts';
import type { CarId, FeedId } from '@pitwall/domain';
import type { ResolvedLink } from '../../kit/types.ts';

/** A feed of the bridge's `hello` with its `session.info`, undefined until the feed has one. */
export type FeedSession = { info: FeedInfo; session: SessionInfo | undefined };

/** The default feed's `plans.prepared` while a round is open. */
export type OpenRound = Extract<PlanningRoundState, { open: true }>;

/** Where `player` and `teammate` come from: the session's cars, or the round's slots between sessions. */
type Cars = { playerCar: CarId | undefined; teammateCar?: CarId | undefined };

const carOf = (ref: CarRef, cars: Cars): CarId | undefined => (ref === 'player' ? cars.playerCar : ref === 'teammate' ? cars.teammateCar : ref);

/**
 * The feed whose player car is the default feed's teammate (SP4.3b spec §10, U12; C1a): another feed of the same
 * session uid and team. Undefined without a teammate, without a known team, or without such a feed.
 */
function teammateFeed(session: SessionInfo, defaultFeed: FeedId, feeds: readonly FeedSession[]): FeedId | undefined {
  const teammate = session.teammateCar;
  const team = feeds.find((f) => f.info.feedId === defaultFeed)?.info.team ?? null;
  if (teammate === undefined || team === null) return undefined;
  return feeds.find(
    (f) => f.info.feedId !== defaultFeed && f.info.team === team && f.session?.sessionUid === session.sessionUid && f.session.playerCar === teammate,
  )?.info.feedId;
}

/**
 * The link a panel of `group` follows, or undefined while it cannot be resolved: no session yet, or a primary of
 * `'teammate'` without a teammate. A compare car that cannot be resolved is dropped. The group's own feed wins over
 * `defaultFeed`; without one, a `'teammate'` primary follows the teammate's own feed when the bridge has it (`feeds`),
 * else the teammate in `defaultFeed`. `session` is the default feed's `session.info`. With no session, `round` (the
 * default feed's open planning round) gives the cars: its player car and teammate, on the default feed; a round
 * without a teammate leaves `'teammate'` unresolved. With a session, the session decides.
 */
export function resolveLink(
  group: LinkGroup,
  session: SessionInfo | undefined,
  defaultFeed: FeedId | undefined,
  feeds: readonly FeedSession[],
  round?: OpenRound,
): ResolvedLink | undefined {
  const cars: Cars | undefined =
    session !== undefined ? session : round === undefined ? undefined : { playerCar: round.playerCar, teammateCar: round.teammateCar ?? undefined };
  if (cars === undefined) return undefined;
  const ownFeed =
    session !== undefined && group.feedId === undefined && group.primary === 'teammate' && defaultFeed !== undefined
      ? teammateFeed(session, defaultFeed, feeds)
      : undefined;
  const feedId = group.feedId ?? ownFeed ?? defaultFeed;
  if (feedId === undefined) return undefined;
  const primary = carOf(group.primary, cars);
  if (primary === undefined) return undefined;
  const compare = group.compare.flatMap((ref) => carOf(ref, cars) ?? []);
  return { group: group.id, feedId, primary, compare, window: group.window };
}

/** True when two links resolve to the same feed, group, cars and time window. */
export const sameLink = (a: ResolvedLink | undefined, b: ResolvedLink | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
