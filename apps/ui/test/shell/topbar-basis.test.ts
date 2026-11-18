// @vitest-environment jsdom
// SP4.3e Task 7c-2 (spec §4.2, §4.3; C65, C68): the top bar's basis segment. Contract assumed:
//  - the top bar acquires the feed's `basis.active`; its segment `basis` (`segments/Basis.svelte`, listed in
//    `topbar/layout.ts`, test id `segment-basis`) reads `Practice 17 Nov · Qualifying 17 Nov · Plan: <name>`: per kind
//    the day of the basis in use (`formatDay` of `basis.active.sessions[<key>].date`), `none` for a kind without a
//    session and for no plan; wording in `kit/text.ts`;
//  - a plan computed for other race laps (`plan.laps` differs from `raceLaps`) adds `56 / 20 laps` (both numbers from
//    the topic, formatted only: no judgement, C65); equal laps, an unknown race laps (`null`) or no plan add nothing;
//  - nothing while `basis.active` has no value.
// Fails until the segment exists (implementation).
import { feedId } from '@pitwall/domain';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import { TOP_BAR } from '../../src/shell/topbar/layout.ts';
import TopBar from '../../src/shell/topbar/TopBar.svelte';
import { FakeConnection } from '../connection/fake-connection.ts';
import { P16, PLAN_NAME, Q17, active } from './basis-fixtures.ts';

const FEED = feedId('f1');
afterEach(cleanup);

const setup = () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x', team: null }] });
  render(TopBar, { store, feedId: FEED, send: () => {}, sendReplay: () => {} });
  return async (topic: string, value: unknown) => {
    const found = connection.subscribes().filter((s) => s.topic === topic && s.feedId === FEED).at(-1);
    if (found === undefined) throw new Error(`no subscription to ${topic}`);
    connection.push({ type: 'snapshot', id: found.id, value });
    await tick();
  };
};
const segment = (): string => (screen.getByTestId('segment-basis').textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the top bar\'s basis segment', () => {
  it('is a segment of the top bar', () => {
    expect([...TOP_BAR.left, ...TOP_BAR.right] as string[]).toContain('basis');
  });

  it('reads "Practice 17 Nov · Qualifying 17 Nov · Plan: <name>" for the basis in use', async () => {
    const push = setup();
    await push('basis.active', active());
    expect(segment()).toBe(`Practice 17 Nov · Qualifying 17 Nov · Plan: ${PLAN_NAME}`);
  });

  it('the basis in use, not the session-start one', async () => {
    const push = setup();
    await push('basis.active', active({ basis: { practice: [P16], qualifying: Q17 } }));
    expect(segment()).toBe(`Practice 16 Nov · Qualifying 17 Nov · Plan: ${PLAN_NAME}`);
  });

  it('"none" per part', async () => {
    const push = setup();
    await push('basis.active', active({ basis: { practice: [], qualifying: null }, plan: null }));
    expect(segment()).toBe('Practice none · Qualifying none · Plan: none');
    await push('basis.active', active({ basis: { practice: [P16], qualifying: null }, plan: null }));
    expect(segment()).toBe('Practice 16 Nov · Qualifying none · Plan: none');
  });

  it('a plan computed for other race laps shows "56 / 20 laps"', async () => {
    const push = setup();
    await push('basis.active', active({ plan: { id: 'p', name: PLAN_NAME, laps: 56 }, raceLaps: 20 }));
    expect(segment()).toContain(`Plan: ${PLAN_NAME}`);
    expect(segment()).toContain('56 / 20 laps');
  });

  it('equal laps, unknown race laps or no plan: no laps', async () => {
    const push = setup();
    await push('basis.active', active({ plan: { id: 'p', name: PLAN_NAME, laps: 56 }, raceLaps: 56 }));
    expect(segment()).not.toContain('laps');
    await push('basis.active', active({ plan: { id: 'p', name: PLAN_NAME, laps: 56 }, raceLaps: null }));
    expect(segment()).not.toContain('laps');
    await push('basis.active', active({ plan: null, raceLaps: 20 }));
    expect(segment()).not.toContain('laps');
  });

  it('nothing before basis.active has a value', () => {
    setup();
    expect(segment()).toBe('');
  });
});
