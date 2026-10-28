// resolveLink (spec 7.5, Review Focus 5): a link group's CarRefs become concrete car ids through session.info.
import type { LinkGroup, SessionInfo } from '@pitwall/contracts';
import { carId, feedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { resolveLink } from '../../src/shell/link-groups/resolve.ts';

const DEFAULT_FEED = feedId('f1');
const session = (playerCar: number, teammateCar?: number): SessionInfo =>
  ({ feedId: DEFAULT_FEED, playerCar: carId(playerCar), ...(teammateCar === undefined ? {} : { teammateCar: carId(teammateCar) }) }) as unknown as SessionInfo;
const group = (extra: Partial<LinkGroup> = {}): LinkGroup => ({ id: 1, primary: 'player', compare: [], window: { kind: 'live' }, ...extra });

describe('resolveLink', () => {
  it('"player" resolves to session.playerCar and the link carries group, default feed and window', () => {
    expect(resolveLink(group({ id: 2, window: { kind: 'lap', lap: 4 } }), session(5), DEFAULT_FEED)).toEqual({
      group: 2,
      feedId: DEFAULT_FEED,
      primary: carId(5),
      compare: [],
      window: { kind: 'lap', lap: 4 },
    });
  });

  it('"player" follows a new session.info.playerCar (Review Focus 5)', () => {
    const g = group({ compare: ['player'] });
    expect(resolveLink(g, session(5), DEFAULT_FEED)).toMatchObject({ primary: carId(5), compare: [carId(5)] });
    expect(resolveLink(g, session(9), DEFAULT_FEED)).toMatchObject({ primary: carId(9), compare: [carId(9)] });
  });

  it('the group\'s own feedId wins over the default feed', () => {
    expect(resolveLink(group({ feedId: feedId('f2') }), session(5), DEFAULT_FEED)?.feedId).toBe('f2');
  });

  it('"teammate" resolves to session.teammateCar', () => {
    const link = resolveLink(group({ primary: 'teammate', compare: ['player'] }), session(5, 6), DEFAULT_FEED);
    expect(link).toMatchObject({ primary: carId(6), compare: [carId(5)] });
  });

  it('"teammate" without a teammate: dropped from compare, and as primary the whole link is undefined', () => {
    expect(resolveLink(group({ compare: ['teammate', carId(7), 'player'] }), session(5), DEFAULT_FEED)?.compare).toEqual([carId(7), carId(5)]);
    expect(resolveLink(group({ primary: 'teammate' }), session(5), DEFAULT_FEED)).toBeUndefined();
  });

  it('an explicit CarId stays as given, in order, whatever the session says', () => {
    const link = resolveLink(group({ primary: carId(12), compare: [carId(3), carId(19)] }), session(5, 6), DEFAULT_FEED);
    expect(link).toMatchObject({ primary: carId(12), compare: [carId(3), carId(19)] });
  });

  it('without a session, "player" cannot be resolved', () => {
    expect(resolveLink(group(), undefined, DEFAULT_FEED)).toBeUndefined();
  });
});
