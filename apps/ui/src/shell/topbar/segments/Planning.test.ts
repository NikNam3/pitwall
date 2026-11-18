// @vitest-environment jsdom
// SP4.3f Task 5 (spec §4.4 "The top bar"; mockup docs/design/2026-11-18-sp4.3f/topbar-planning.html; C65, C68, C72): the
// top bar between sessions. Contract assumed:
//  - "between sessions" is: the window's feed has no `session.info`, or its `feed.status.betweenSessions` is true
//    (supervisor ruling); then the top bar shows the planning segment (`segments/Planning.svelte`) instead of the basis
//    segment; in a session the basis segment stays as today and no planning segment shows;
//  - with an open round (`plans.prepared`, feed topic) the planning segment is one button reading
//    `Planning · P <days> · Q <day> · <laps> laps · <sets> · rain <min>–<max> %`: the days are `formatDay` of the
//    `startedAt` of the round's refs in `plans.sessions` (global topic, looked up by ref: the round names refs, not
//    dates), min and max the rain range of `forecast.rows`, formatted only (C65); wording in `kit/text.ts` (C68);
//  - while `forecast.rows` is unknown the rain part is the unknown mark of its reason, never `0 %` (C3);
//  - clicking the segment runs `basis.pick` (the top bar's `onPickBasis`), as the basis segment does;
//  - without a round (`open: false`) the segment is a quiet `Plan…` button that runs `basis.pick`;
//  - `basis.pick` is registered while the window has a feed, also with no session (C72), and opens the picker.
// Fails until the segment exists (implementation).
import type { FeedStatus, PlanningRoundState, SessionInfo, TopicValue } from '@pitwall/contracts';
import { carId, feedId, known, unknown, type ForecastSample, type SessionRef, type Weather } from '@pitwall/domain';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeConnection } from '../../../../test/connection/fake-connection.ts';
import { TEST_WIDGETS } from '../../../../test/shell/fixtures/index.ts';
import { group1, makeStore, stubBrowser, workbook } from '../../../../test/shell/shell-harness.ts';
import { TopicStore } from '../../../connection/topic-store.svelte.ts';
import * as text from '../../../kit/text.ts';
import { CommandRegistry } from '../../commands/registry.ts';
import TopBar from '../TopBar.svelte';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../windows/WindowShell.svelte';

const FEED = feedId('f1');
const WEEKEND = '548397152';
const P17: SessionRef = { sessionUid: '5022233344455566677', weekendId: WEEKEND };
const Q17: SessionRef = { sessionUid: '12101553556244014932', weekendId: WEEKEND };
/** Another session of the track, stored a day earlier: the days come from the round's refs, not the newest entry. */
const P16: SessionRef = { sessionUid: '4011121896695002375', weekendId: WEEKEND };

const sample = (minutes: number, weather: Weather, rainPct: number): ForecastSample => ({
  offsetMs: minutes * 60_000,
  weather,
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 24,
  airTempTrend: 'flat',
  rainPct,
});
/** The qualifying's race samples: rain 1 % to 4 %, not in order of their rain. */
const ROWS = [sample(0, 'clear', 1), sample(5, 'clear', 4), sample(15, 'lightCloud', 2)].map((s) => ({ sample: s, overridden: false }));

type OpenRound = Extract<PlanningRoundState, { open: true }>;
const ROUND: OpenRound = {
  open: true,
  qualifying: Q17,
  practice: [P17],
  race: { laps: 56, sets: 'fresh', conditions: { kind: 'imported' } },
  team: 0,
  trackId: 15,
  playerCar: carId(19),
  teammateCar: carId(18),
  forecast: { source: { ref: Q17, startedAt: '2026-11-17T14:00:00.000Z' }, rows: known(ROWS, 0) },
  rebuilding: false,
  cars: {},
  running: false,
  saved: [],
};
const CLOSED: PlanningRoundState = { open: false, saved: [] };

type PlansSessions = TopicValue<'plans.sessions'>;

const entry = (ref: SessionRef, kind: 'practice' | 'qualifying', startedAt: string): PlansSessions['sessions'][number] => ({
  ref,
  kind,
  trackId: 15,
  startedAt,
  team: 0,
  cars: [
    { carId: carId(19), raceNumber: 64, name: null },
    { carId: carId(18), raceNumber: 13, name: null },
  ],
  stale: false,
});
const SESSIONS: PlansSessions = {
  sessions: [entry(Q17, 'qualifying', '2026-11-17T14:00:00.000Z'), entry(P17, 'practice', '2026-11-17T10:00:00.000Z'), entry(P16, 'practice', '2026-11-16T10:00:00.000Z')],
};

const status = (betweenSessions: boolean): FeedStatus => ({
  feedId: FEED,
  connected: true,
  stale: false,
  lossPercent: 0,
  latePackets: 0,
  decodeErrors: 0,
  packetsPerSecond: 60,
  betweenSessions,
});
const inSession = { feedId: FEED, sessionUid: '1', playerCar: carId(19), teammateCar: carId(18) } as unknown as SessionInfo;

const normalise = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
/** The buttons of the top bar whose text starts with `prefix`. */
const buttons = (prefix: string): HTMLElement[] => screen.queryAllByRole('button').filter((b) => normalise(b.textContent).startsWith(prefix));
const planning = (): HTMLElement[] => buttons('Planning ·');
const planButton = (): HTMLElement[] => screen.queryAllByRole('button').filter((b) => normalise(b.textContent) === 'Plan…');

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the top bar between sessions: the planning segment', () => {
  const setup = () => {
    const connection = new FakeConnection();
    const store = new TopicStore(connection);
    connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x', team: null }] });
    const onPickBasis = vi.fn();
    render(TopBar, { store, feedId: FEED, send: () => {}, sendReplay: () => {}, onPickBasis });
    /** Pushes a value to the newest subscription of `topic`: the window's feed, or the global one (no feed id). */
    const push = async (topic: string, value: unknown, global = false): Promise<void> => {
      const found = connection.subscribes().filter((s) => s.topic === topic && (global ? s.feedId === undefined : s.feedId === FEED)).at(-1);
      if (found === undefined) throw new Error(`the top bar has no subscription to ${topic}${global ? ' (global)' : ''}`);
      connection.push({ type: 'snapshot', id: found.id, value });
      await tick();
    };
    return { push, onPickBasis };
  };

  it('the round fixture renders "Planning · P 17 Nov · Q 17 Nov · 56 laps · fresh · rain 1–4 %", and a click runs basis.pick', async () => {
    const { push, onPickBasis } = setup();
    await push('plans.prepared', ROUND);
    await push('plans.sessions', SESSIONS, true);
    expect(planning().map((b) => normalise(b.textContent))).toEqual(['Planning · P 17 Nov · Q 17 Nov · 56 laps · fresh · rain 1–4 %']);
    await fireEvent.click(planning()[0]!);
    expect(onPickBasis).toHaveBeenCalledTimes(1);
  });

  it('with rows unknown, the rain part shows the missing mark (no 0 %)', async () => {
    const { push } = setup();
    await push('plans.prepared', { ...ROUND, forecast: { ...ROUND.forecast, rows: unknown('notReceived') } } satisfies OpenRound);
    await push('plans.sessions', SESSIONS, true);
    const shown = planning().map((b) => normalise(b.textContent));
    expect(shown).toEqual([`Planning · P 17 Nov · Q 17 Nov · 56 laps · fresh · rain ${text.unknownMark.notReceived}`]);
    expect(shown[0]).not.toMatch(/\b0 ?%/);
  });

  it('without a round, a Plan… button invokes basis.pick', async () => {
    const { push, onPickBasis } = setup();
    await push('plans.prepared', CLOSED);
    expect(planning()).toEqual([]);
    expect(planButton()).toHaveLength(1);
    await fireEvent.click(planButton()[0]!);
    expect(onPickBasis).toHaveBeenCalledTimes(1);
  });

  it('between sessions is no session.info or feed.status.betweenSessions; in a session the basis segment, not the planning one', async () => {
    const { push } = setup();
    await push('plans.prepared', ROUND);
    await push('plans.sessions', SESSIONS, true);
    // No session.info: between sessions.
    expect(planning()).toHaveLength(1);
    // A session running: the session decides, the planning segment goes.
    await push('session.info', inSession);
    await push('feed.status', status(false));
    expect(planning()).toEqual([]);
    expect(planButton()).toEqual([]);
    // The session has ended (its session.info stays): between sessions again.
    await push('feed.status', status(true));
    expect(planning()).toHaveLength(1);
  });
});

describe('basis.pick with no session (C72)', () => {
  /** Watches `register` (it still registers); the shell's registry is the `this` of its first call. */
  let registering: { mock: { contexts: unknown[] } } | undefined;
  const shellRegistry = (): CommandRegistry => {
    const registry = registering?.mock.contexts[0] as CommandRegistry | undefined;
    if (registry === undefined) throw new Error('the shell registered no command');
    return registry;
  };
  beforeEach(() => {
    mocks.mountDock.mockReset();
    mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn(), setEditing: vi.fn(), focusPanel: vi.fn() }));
    stubBrowser();
    registering = vi.spyOn(CommandRegistry.prototype, 'register');
  });

  it('basis.pick is registered with no session, and the Plan… button opens the picker', async () => {
    const ctx = makeStore();
    ctx.connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x', team: null }] });
    render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
    await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
    await ctx.push('ui.linkGroups', [group1()]);
    await tick();
    const pushFeed = async (topic: string, value: unknown): Promise<void> => {
      const found = ctx.connection.subscribes().filter((s) => s.topic === topic && s.feedId === FEED).at(-1);
      if (found === undefined) throw new Error(`no subscription to ${topic} for the feed`);
      ctx.connection.push({ type: 'snapshot', id: found.id, value });
      await tick();
    };
    // No session.info is ever pushed: the bridge has no session.
    await pushFeed('plans.prepared', CLOSED);
    expect(shellRegistry().list().map((c) => c.id)).toContain('basis.pick');
    expect(screen.queryByTestId('basis-picker')).toBeNull();
    expect(planButton()).toHaveLength(1);
    await fireEvent.click(planButton()[0]!);
    await tick();
    expect(screen.getByTestId('basis-picker')).toBeTruthy();
  });
});
