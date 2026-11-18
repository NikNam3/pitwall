// @vitest-environment jsdom
// SP4.3f Task 6 (spec §4.4; C43, C64, C65, C72, C73; mockup docs/design/2026-11-18-sp4.3f/picker-between-sessions.html):
// the picker between sessions. Contract assumed:
//  - "between sessions" is the window's feed without `session.info` (its topic answers `noData`) or with
//    `feed.status.betweenSessions`; the picker then reads the global `plans.sessions` (through the store, C64) instead
//    of `basis.active`, and is titled `Plan a race`; in a session it stays SP4.3e's basis-and-plan picker;
//  - its parts, each preselected (`candidates.ts` `planningChoice`): track (`<input type="radio"
//    data-testid="track-<trackId>">`), qualifying, one per team it is stored for (`<input type="radio"
//    data-testid="qualifying-<sessionUid>@<weekendId>#<team>">`, its label `<day> · <team name> #<n> #<n>`), practice
//    (`<input type="checkbox" data-testid="practice-<sessionUid>@<weekendId>">`, several or `practice-none`); no plan part;
//  - Confirm (`basis-confirm`) sends exactly one `plans.round.open { feedId, qualifying, team, practice }`, the team the
//    qualifying's (never the feed's) and no race (the bridge takes the race assumptions' defaults);
//  - a rejection keeps the picker open with the bridge's message in `[data-testid="basis-error"]`;
//  - with nothing stored it reads `no stored qualifying` and Confirm is disabled.
// Fails until the picker has its planning mode (implementation).
import type { ActionOutcome, FeedStatus, PlanningRoundState, SessionInfo, UiAction } from '@pitwall/contracts';
import { carId, feedId, type SessionUid } from '@pitwall/domain';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeConnection } from '../../../test/connection/fake-connection.ts';
import { CLOSED_ROUND, P17 as SP43E_P17, Q17 as SP43E_Q17, active, keyOf as sp43eKey } from '../../../test/shell/basis-fixtures.ts';
import { MERCEDES, STORED, TEXAS, TEXAS_P17, TEXAS_Q17, keyOf, qualifyingKey, type PlansSessions } from '../../../test/shell/planning-fixtures.ts';
import { TopicStore } from '../../connection/topic-store.svelte.ts';
import BasisPicker from './BasisPicker.svelte';

const FEED = feedId('20777');
/** The feed's own team differs from the qualifying's: the round's team comes with the qualifying, never from a feed. */
const FEED_TEAM = 5;

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const status = (betweenSessions: boolean): FeedStatus => ({
  feedId: FEED,
  connected: true,
  stale: false,
  lossPercent: 0,
  latePackets: 0,
  decodeErrors: 0,
  packetsPerSecond: 0,
  betweenSessions,
});
const SESSION: SessionInfo = { feedId: FEED, sessionUid: '548397152' as SessionUid, playerCar: carId(0), session: {} as SessionInfo['session'], realism: false };
const NO_ROUND: PlanningRoundState = { open: false, saved: [] };

type Answer = (outcome: ActionOutcome) => void;

const mount = () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x', team: FEED_TEAM }] });
  const answers: Answer[] = [];
  const send = vi.fn((_action: UiAction) => new Promise<ActionOutcome>((resolve) => answers.push(resolve)));
  const onClose = vi.fn();
  render(BasisPicker, { store, feedId: FEED, send, onClose });
  const subscription = (topic: string) => connection.subscribes().filter((s) => s.topic === topic && (s.feedId === undefined || s.feedId === FEED)).at(-1);
  /** Pushes a topic's value to its newest subscription (a feed topic's for the window's feed). */
  const push = async (topic: string, value: unknown): Promise<void> => {
    const found = subscription(topic);
    if (found === undefined) throw new Error(`the picker holds no subscription to ${topic}`);
    connection.push({ type: 'snapshot', id: found.id, value });
    await tick();
  };
  /** The bridge has no value of a topic (between sessions: `session.info`). */
  const noData = async (topic: string): Promise<void> => {
    const found = subscription(topic);
    if (found === undefined) throw new Error(`the picker holds no subscription to ${topic}`);
    connection.push({ type: 'topicStatus', id: found.id, status: 'noData' });
    await tick();
  };
  /** The picker between sessions: no `session.info`, a feed that never had a session, the stored sessions. */
  const between = async (sessions: PlansSessions = STORED): Promise<HTMLElement> => {
    await tick();
    await noData('session.info');
    await push('feed.status', status(false));
    if (subscription('plans.prepared') !== undefined) await push('plans.prepared', NO_ROUND);
    await push('plans.sessions', sessions);
    return screen.getByTestId('basis-picker');
  };
  const holds = (topic: string): boolean => subscription(topic) !== undefined;
  return { send, onClose, answers, push, noData, between, holds };
};

const input = (root: HTMLElement, id: string): HTMLInputElement => {
  const el = root.querySelector(`[data-testid="${id}"]`);
  if (el === null) throw new Error(`no ${id}`);
  return el as HTMLInputElement;
};
const labelOf = (el: Element): string => (el.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim();
const confirm = (root: HTMLElement): HTMLButtonElement => input(root, 'basis-confirm') as unknown as HTMLButtonElement;

describe('the picker between sessions', () => {
  it('the picker lists `17 Nov · Mercedes #64 #2`', async () => {
    const root = await mount().between();
    expect(screen.getByText('Plan a race')).toBeTruthy();
    const qualifying = input(root, `qualifying-${qualifyingKey(TEXAS_Q17, MERCEDES)}`);
    expect(qualifying.type).toBe('radio');
    expect(labelOf(qualifying)).toContain('17 Nov · Mercedes #64 #2');
    expect(qualifying.checked).toBe(true);
    expect(input(root, `track-${TEXAS}`).checked).toBe(true);
    expect(labelOf(input(root, `track-${TEXAS}`))).toContain('Texas');
    expect(input(root, `practice-${keyOf(TEXAS_P17)}`).checked).toBe(true);
    expect(root.querySelector('[data-testid="plan-none"]')).toBeNull();
  });

  it('Confirm sends exactly plans.round.open with the qualifying, its team and the practice', async () => {
    const t = mount();
    const root = await t.between();
    await fireEvent.click(confirm(root));
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0]?.[0]).toStrictEqual({
      kind: 'plans.round.open',
      feedId: FEED,
      qualifying: { sessionUid: '12101553556244014932', weekendId: '548397152' },
      team: 0,
      practice: [{ sessionUid: '4011121896695002375', weekendId: '548397152' }],
    });
  });

  it('a rejection message is shown and the picker stays open', async () => {
    const t = mount();
    const root = await t.between();
    await fireEvent.click(confirm(root));
    await tick();
    t.answers[0]?.({ ok: false, reason: 'invalid', message: 'qualifying 17 Nov has no recording' });
    await vi.waitFor(() => expect(screen.getByTestId('basis-error').textContent).toContain('qualifying 17 Nov has no recording'));
    expect(screen.getByTestId('basis-picker')).toBeTruthy();
    expect(t.onClose).not.toHaveBeenCalled();
  });

  it('with { sessions: [] } it shows the none-stored label and Confirm is disabled', async () => {
    const t = mount();
    const root = await t.between({ sessions: [] });
    expect(root.textContent).toContain('no stored qualifying');
    expect(confirm(root).disabled).toBe(true);
    await fireEvent.click(confirm(root));
    await tick();
    expect(t.send).not.toHaveBeenCalled();
  });

  it('feed.status.betweenSessions also makes it the picker between sessions', async () => {
    const t = mount();
    await tick();
    if (t.holds('session.info')) await t.push('session.info', SESSION);
    await t.push('feed.status', status(true));
    await t.push('plans.sessions', STORED);
    const root = screen.getByTestId('basis-picker');
    expect(input(root, `qualifying-${qualifyingKey(TEXAS_Q17, MERCEDES)}`).checked).toBe(true);
  });
});

describe('in a session', () => {
  it('in a session the SP4.3e picker renders as before', async () => {
    const t = mount();
    await tick();
    // A session runs: its `session.info` has a value (pushed if the picker reads it; SP4.3e's picker does not).
    if (t.holds('session.info')) await t.push('session.info', SESSION);
    await t.push('feed.status', status(false));
    await t.push('basis.active', active());
    await t.push('plans.prepared', CLOSED_ROUND);
    const root = screen.getByTestId('basis-picker');
    expect(screen.getByText('Basis and plan')).toBeTruthy();
    expect(screen.queryByText('Plan a race')).toBeNull();
    expect(root.querySelector('[data-testid^="track-"]')).toBeNull();
    expect(input(root, `qualifying-${sp43eKey(SP43E_Q17)}`).checked).toBe(true);
    expect(input(root, `practice-${sp43eKey(SP43E_P17)}`).checked).toBe(true);
    expect(input(root, 'plan-none')).toBeTruthy();
    await fireEvent.click(confirm(root));
    await tick();
    expect(t.send.mock.calls.map((c) => (c[0] as UiAction).kind)).toEqual(['basis.choose']);
  });
});
