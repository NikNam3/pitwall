// @vitest-environment jsdom
// SP4.3d2 Task 12 "supervisor first" (C68; mockup docs/design/2026-11-16-sp4.3d/plan-workbook.html, the planning top bar):
//  - the top bar acquires the feed's `plans.prepared`; while its value is `open: true` the phase segment (test id
//    `phase`) reads `text.topBar.phase.planning` (PLANNING) in the role `text`, over any session phase;
//  - while `feed.status.betweenSessions` the feed segment reads `text.topBar.feedBetweenSessions` in `textFaint`
//    (not stale, not amber), unless the feed is down.
import type { FeedStatus, MachineSpans, PlanningRoundState } from '@pitwall/contracts';
import { feedId, type OpenSpan } from '@pitwall/domain';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import * as text from '../../src/kit/text.ts';
import TopBar from '../../src/shell/topbar/TopBar.svelte';
import { role } from '../../src/theme/index.ts';
import { FakeConnection } from '../connection/fake-connection.ts';

const FEED = feedId('f1');
afterEach(cleanup);

const span = (machine: string, kind: string): OpenSpan => ({ machine, id: 0, kind, start: 1000, confirmed: true, detail: {}, startFrame: 1 }) as OpenSpan;
const spans = (...open: OpenSpan[]): MachineSpans => ({ open });
const OPEN: PlanningRoundState = {
  open: true,
  qualifying: { sessionUid: '1', weekendId: 'w1' },
  practice: [],
  race: { laps: null, sets: 'carried' },
  team: 0,
  cars: {},
  running: false,
  saved: [],
};
const status = (extra: Partial<FeedStatus> = {}): FeedStatus => ({
  feedId: FEED,
  connected: true,
  stale: false,
  lossPercent: 0.1,
  latePackets: 0,
  decodeErrors: 0,
  packetsPerSecond: 60,
  betweenSessions: false,
  ...extra,
});

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
const phase = () => screen.queryByTestId('phase');
const feedSegment = () => screen.getByTestId('segment-feed');

describe('the top bar in the planning round', () => {
  it('PLANNING in the role text while plans.prepared is open, over the session phase', async () => {
    const push = setup();
    await push('situation.weekendPhase', spans(span('weekend-phase', 'qualifying')));
    await push('situation.clock', spans(span('clock', 'running')));
    await push('situation.sessionPhaseQualifying', spans(span('session-phase-qualifying', 'finished')));
    expect(phase()?.textContent).toBe(text.topBar.phase.finished);
    await push('plans.prepared', OPEN);
    expect(phase()?.textContent).toBe(text.topBar.phase.planning);
    expect(text.topBar.phase.planning).toBe('PLANNING');
    expect(phase()?.getAttribute('style') ?? '').toContain(role('text'));
  });

  it('no PLANNING while the round is closed or unknown', async () => {
    const push = setup();
    expect(phase()).toBeNull();
    await push('plans.prepared', { open: false, saved: [] } satisfies PlanningRoundState);
    expect(phase()).toBeNull();
  });

  it('the feed reads "feed between sessions" in textFaint while betweenSessions', async () => {
    const push = setup();
    await push('feed.status', status({ betweenSessions: true }));
    expect(feedSegment().textContent?.trim()).toBe(text.topBar.feedBetweenSessions);
    expect(feedSegment().querySelector('span')?.getAttribute('style') ?? '').toContain(role('textFaint'));
    await push('feed.status', status({ betweenSessions: false }));
    expect(feedSegment().textContent).not.toContain(text.topBar.feedBetweenSessions);
  });

  it('a feed that is down reads down, also between sessions', async () => {
    const push = setup();
    await push('feed.status', status({ betweenSessions: true, connected: false }));
    expect(feedSegment().textContent?.trim()).toBe(text.topBar.feedDown);
  });
});
