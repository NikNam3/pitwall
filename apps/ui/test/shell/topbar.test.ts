// @vitest-environment jsdom
// The top bar (Task 17, spec 7.6, 7.7, 7.9, 8.5; mockup 9-top-bar). Contract the tests assume of shell/topbar/TopBar.svelte:
//  - props: `{ store: TopicStore; feedId: FeedId; send: (a: UiAction) => void; sendReplay: (c: ReplayControl) => void }`;
//    it acquires `session.info`, `feed.status`, `replay.status`, `raceMoment.current` (feed topics), `insights` (with `activeInsights`) and the global
//    `ui.alerts` and `ui.settings` itself; the feed's kind comes from `store.feeds` (the `hello` message);
//  - test ids: root `topbar`; one `segment-<name>` per SegmentName of TOP_BAR (an empty segment may render nothing else);
//    realism: a button `realism` whose text has `text.topBar.realismOn|realismOff` and, when ui.settings.realismNextSession differs,
//    also `text.topBar.realismNext(next)` ("→ on" / "→ off"); a click sends `realism.set { enabled: !realismNextSession }`;
//    transport: `replay-transport` (only for kind 'replay'), a button `replay-pause` (click sends pause while playing, play while
//    paused), a <select> `replay-speed` with options 0.5, 1, 2, 4, 8 (change sends `speed`), a number input `replay-lap`
//    (change sends `jumpToLap`);
//    alerts: at most 3 tier-1 alerts `alert-<key>` showing `formatInsight(insight)`, each with a button `alert-ack-<key>` (sends
//    `alert.ack`); beyond 3 a button `alerts-more` with text `text.topBar.moreAlerts(n)`; a click opens a list with a toggle button
//    `mute-<category>` for every InsightCategory (click sends `alertGroup.mute { category, muted: !currentlyMuted }`).
// New in kit/text.ts: `topBar = { realismOn, realismOff, realismNext(enabled: boolean), moreAlerts(n: number) }`.
import type { ReplayControl, UiAction } from '@pitwall/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { carId, feedId, type Insight, type InsightCategory } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import * as text from '../../src/kit/text.ts';
import { formatInsight } from '../../src/kit/insight/insight-text.ts';
import { TOP_BAR } from '../../src/shell/topbar/layout.ts';
import TopBar from '../../src/shell/topbar/TopBar.svelte';
import { FakeConnection } from '../connection/fake-connection.ts';

const FEED = feedId('f1');
afterEach(cleanup);

const crit = (key: string, at: number, over: Partial<Insight> = {}): Insight => ({
  key,
  severity: 'critical',
  category: 'damage',
  feedId: FEED,
  carId: carId(5),
  kind: 'madeUpKind',
  params: { n: at },
  raisedAt: at,
  ...over,
});
const info = (realism: boolean) => ({
  feedId: FEED,
  sessionUid: '1',
  playerCar: carId(5),
  realism,
  session: { kind: 'race', totalLaps: 62, timeLeftMs: 0, flag: 'green' },
});
const replayStatus = (paused: boolean) => ({ paused, speed: 1, sessionTimeMs: 1000, playerLap: 5, atEnd: false });

const setup = async (kind: 'udp' | 'replay' = 'udp') => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  const actions: UiAction[] = [];
  const controls: ReplayControl[] = [];
  connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind, label: 'x' }] });
  render(TopBar, { store, feedId: FEED, send: (a: UiAction) => actions.push(a), sendReplay: (c: ReplayControl) => controls.push(c) });
  const idOf = (topic: string): string => {
    const found = connection.subscribes().filter((s) => s.topic === topic).at(-1);
    if (found === undefined) throw new Error(`no subscription to ${topic}`);
    return found.id;
  };
  const push = async (topic: string, value: unknown) => {
    connection.push({ type: 'snapshot', id: idOf(topic), value });
    await tick();
  };
  const raise = async (...list: Insight[]) => {
    connection.push({ type: 'snapshot', id: idOf('insights'), entries: list.map((insight) => ({ type: 'raised', insight })) });
    await tick();
  };
  return { connection, actions, controls, push, raise };
};

describe('segments', () => {
  it('renders the root and one segment per name of the layout', async () => {
    await setup();
    expect(screen.getByTestId('topbar')).toBeTruthy();
    for (const name of [...TOP_BAR.left, ...TOP_BAR.right]) expect(screen.getByTestId(`segment-${name}`)).toBeTruthy();
  });
});

describe('moment', () => {
  it('shows the race moment of raceMoment.current by its name, and nothing while it is unknown', async () => {
    const { push } = await setup();
    expect(screen.queryByTestId('moment')).toBeNull();
    await push('raceMoment.current', { known: true, at: 1000, value: { moment: 'battle', since: { known: false, reason: 'notApplicable' },
      cause: { rule: 'battle', params: {} }, active: ['battle', 'carCare'] } });
    expect(screen.getByTestId('moment').textContent).toBe(text.topBar.moment.battle);
    await push('raceMoment.current', { known: false, reason: 'notApplicable' });
    expect(screen.queryByTestId('moment')).toBeNull();
  });
});

describe('realism', () => {
  it('shows the current session value', async () => {
    const t = await setup();
    await t.push('session.info', info(true));
    await t.push('ui.settings', { realismNextSession: true, keys: {} });
    const el = screen.getByTestId('realism');
    expect(el.textContent).toContain(text.topBar.realismOn);
    expect(el.textContent).not.toContain('→');
  });

  it('a pending change shows → on', async () => {
    const t = await setup();
    await t.push('session.info', info(false));
    await t.push('ui.settings', { realismNextSession: true, keys: {} });
    const el = screen.getByTestId('realism');
    expect(el.textContent).toContain(text.topBar.realismOff);
    expect(el.textContent).toContain(text.topBar.realismNext(true));
  });

  it('a pending change to off shows → off', async () => {
    const t = await setup();
    await t.push('session.info', info(true));
    await t.push('ui.settings', { realismNextSession: false, keys: {} });
    expect(screen.getByTestId('realism').textContent).toContain(text.topBar.realismNext(false));
  });

  it('a click sends realism.set with the opposite of the value pending for the next session', async () => {
    const t = await setup();
    await t.push('session.info', info(true));
    await t.push('ui.settings', { realismNextSession: true, keys: {} });
    await fireEvent.click(screen.getByTestId('realism'));
    expect(t.actions).toEqual([{ kind: 'realism.set', enabled: false }]);
  });
});

describe('replay transport', () => {
  it('is hidden for a udp feed', async () => {
    const t = await setup('udp');
    await t.push('session.info', info(false));
    expect(screen.queryByTestId('replay-transport')).toBeNull();
  });

  it('is shown for a replay feed', async () => {
    const t = await setup('replay');
    await t.push('replay.status', replayStatus(false));
    expect(screen.getByTestId('replay-transport')).toBeTruthy();
  });

  it('the pause button sends pause while playing and play while paused', async () => {
    const t = await setup('replay');
    await t.push('replay.status', replayStatus(false));
    await fireEvent.click(screen.getByTestId('replay-pause'));
    await t.push('replay.status', replayStatus(true));
    await fireEvent.click(screen.getByTestId('replay-pause'));
    expect(t.controls).toEqual([{ kind: 'pause' }, { kind: 'play' }]);
  });

  it('the speed control offers 0.5, 1, 2, 4, 8 and sends speed', async () => {
    const t = await setup('replay');
    await t.push('replay.status', replayStatus(false));
    const select = screen.getByTestId('replay-speed') as HTMLSelectElement;
    expect([...select.options].map((o) => Number(o.value))).toEqual([0.5, 1, 2, 4, 8]);
    await fireEvent.change(select, { target: { value: '4' } });
    expect(t.controls).toEqual([{ kind: 'speed', factor: 4 }]);
  });

  it('the lap input shows the player lap and sends jumpToLap', async () => {
    const t = await setup('replay');
    await t.push('replay.status', replayStatus(false));
    const input = screen.getByTestId('replay-lap') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('5');
    await fireEvent.change(input, { target: { value: '12' } });
    expect(t.controls).toEqual([{ kind: 'jumpToLap', lap: 12 }]);
  });
});

describe('tier-1 alerts', () => {
  it('shows an alert with its formatted text and acknowledges it with alert.ack', async () => {
    const t = await setup();
    await t.push('ui.alerts', { acknowledged: [], muted: [] });
    const a = crit('a', 1000);
    await t.raise(a, crit('adv', 500, { severity: 'advisory' }));
    expect(screen.getByTestId('alert-a').textContent).toContain(formatInsight(a));
    expect(screen.queryByTestId('alert-adv')).toBeNull();
    await fireEvent.click(screen.getByTestId('alert-ack-a'));
    // acknowledged per occurrence: `<feedId>:<insightKey>:<raisedAt>`
    expect(t.actions).toEqual([{ kind: 'alert.ack', key: 'f1:a:1000' }]);
  });

  it('hides acknowledged alerts', async () => {
    const t = await setup();
    await t.push('ui.alerts', { acknowledged: ['f1:a:1000'], muted: [] });
    await t.raise(crit('a', 1000), crit('b', 2000));
    expect(screen.queryByTestId('alert-a')).toBeNull();
    expect(screen.getByTestId('alert-b')).toBeTruthy();
  });

  it('a later occurrence of an acknowledged alert (same key, raised again) shows again; a bare key acknowledges nothing', async () => {
    const t = await setup();
    await t.push('ui.alerts', { acknowledged: ['f1:a:1000', 'b'], muted: [] });
    await t.raise(crit('a', 9000), crit('b', 2000));
    expect(screen.getByTestId('alert-a')).toBeTruthy();
    expect(screen.getByTestId('alert-b')).toBeTruthy();
  });

  it('shows at most 3, oldest first, plus +N', async () => {
    const t = await setup();
    await t.push('ui.alerts', { acknowledged: [], muted: [] });
    await t.raise(crit('e', 5000), crit('c', 3000), crit('a', 1000), crit('d', 4000), crit('b', 2000));
    for (const key of ['a', 'b', 'c']) expect(screen.getByTestId(`alert-${key}`)).toBeTruthy();
    for (const key of ['d', 'e']) expect(screen.queryByTestId(`alert-${key}`)).toBeNull();
    expect(screen.getByTestId('alerts-more').textContent).toContain(text.topBar.moreAlerts(2));
  });

  it('has no +N with three or fewer alerts', async () => {
    const t = await setup();
    await t.push('ui.alerts', { acknowledged: [], muted: [] });
    await t.raise(crit('a', 1000), crit('b', 2000), crit('c', 3000));
    expect(screen.queryByTestId('alerts-more')).toBeNull();
  });

  it('a resolved insight leaves the bar', async () => {
    const t = await setup();
    await t.push('ui.alerts', { acknowledged: [], muted: [] });
    await t.raise(crit('a', 1000));
    t.connection.push({ type: 'append', id: t.connection.subscribes().filter((s) => s.topic === 'insights').at(-1)!.id, entries: [{ type: 'resolved', key: 'a', at: 2000 }] });
    await tick();
    expect(screen.queryByTestId('alert-a')).toBeNull();
  });
});

describe('lap input edge cases', () => {
  it('clearing the lap input sends no replayControl', async () => {
    const t = await setup('replay');
    await t.push('replay.status', replayStatus(false));
    await fireEvent.change(screen.getByTestId('replay-lap'), { target: { value: '' } });
    expect(t.controls).toEqual([]);
  });
});

describe('muting', () => {
  const open = async (muted: InsightCategory[] = []) => {
    const t = await setup();
    await t.push('ui.alerts', { acknowledged: [], muted });
    await t.raise(crit('a', 1000), crit('b', 2000), crit('c', 3000), crit('d', 4000, { category: 'tyres' }));
    await fireEvent.click(screen.getByTestId('alerts-more'));
    return t;
  };

  it('the +N list has a mute toggle for every category', async () => {
    await open();
    for (const category of ['strategy', 'tyres', 'energy', 'damage', 'race', 'feed', 'system']) expect(screen.getByTestId(`mute-${category}`)).toBeTruthy();
  });

  it('muting tyres sends alertGroup.mute with muted true', async () => {
    const t = await open();
    await fireEvent.click(screen.getByTestId('mute-tyres'));
    expect(t.actions).toEqual([{ kind: 'alertGroup.mute', category: 'tyres', muted: true }]);
  });

  it('the mute list closes on Escape', async () => {
    await open();
    const toggle = screen.getByTestId('mute-tyres');
    await fireEvent.keyDown(toggle, { key: 'Escape' });
    await tick();
    expect(screen.queryByTestId('mute-tyres')).toBeNull();
  });

  it('each toggle names its category and the action it takes: mute, or unmute once muted', async () => {
    await open(['tyres']);
    expect(screen.getByTestId('mute-tyres').textContent).toContain(`${text.alertGroups.category.tyres}${text.separator}${text.alertGroups.unmute}`);
    expect(screen.getByTestId('mute-energy').textContent).toContain(`${text.alertGroups.category.energy}${text.separator}${text.alertGroups.mute}`);
  });

  it('a muted category toggles back with muted false', async () => {
    const t = await open(['tyres']);
    await fireEvent.click(screen.getByTestId('mute-tyres'));
    expect(t.actions).toEqual([{ kind: 'alertGroup.mute', category: 'tyres', muted: false }]);
  });
});

// Final fix wave (B-I1, spec 7.6, mockup 9): the bar shows the lap `L23/62` and the session clock `1:12:04`.
// Lap source (live and replay alike): the player's `timing.lap` in `cars.overview` (acquired by the top bar's model for the feed).
// Clock: `session.info.session.timeLeftMs` as H:MM:SS via `formatSessionClock` in kit/values/format.ts.
describe('session segment: lap and clock', () => {
  const infoWith = (over: Record<string, unknown>) => ({ ...info(false), session: { ...info(false).session, ...over } });
  const overview = (lap: number) => [
    { id: carId(5), timing: { lap } },
    { id: carId(7), timing: { lap: lap + 1 } },
  ];

  it('shows L<lap>/<total> of the player car and the time left', async () => {
    const t = await setup();
    await t.push('session.info', infoWith({ timeLeftMs: 4_324_000 }));
    await t.push('cars.overview', overview(23));
    const segment = screen.getByTestId('segment-session').textContent ?? '';
    expect(segment).toContain('L23/62');
    expect(segment).toContain('1:12:04');
  });

  it('works on a replay feed too, and follows the lap', async () => {
    const t = await setup('replay');
    await t.push('session.info', infoWith({ timeLeftMs: 471_000 }));
    await t.push('cars.overview', overview(5));
    expect(screen.getByTestId('segment-session').textContent).toContain('L5/62');
    expect(screen.getByTestId('segment-session').textContent).toContain('0:07:51');
    await t.push('cars.overview', overview(6));
    expect(screen.getByTestId('segment-session').textContent).toContain('L6/62');
  });

  it('shows no lap before the overview has the player car (never L0)', async () => {
    const t = await setup();
    await t.push('session.info', infoWith({ timeLeftMs: 4_324_000 }));
    expect(screen.getByTestId('segment-session').textContent).not.toMatch(/L\d/);
  });
});

// Final fix wave (B-I4): the lap input's width comes from NUMBER_INPUT_COLS, inline (no second literal in a stylesheet).
describe('replay lap input width', () => {
  it('is NUMBER_INPUT_COLS characters wide, set from the constant', async () => {
    const { NUMBER_INPUT_COLS } = await import('../../src/shell/commands/overlay-sizes.ts');
    const t = await setup('replay');
    await t.push('replay.status', replayStatus(false));
    expect((screen.getByTestId('replay-lap') as HTMLInputElement).style.width).toBe(`${NUMBER_INPUT_COLS}ch`);
  });
});
