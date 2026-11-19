// @vitest-environment jsdom
// SP4.3e Task 7c-2 (spec §4.2, §4.3; C64, C67, C72, C73): the shell command "Basis and plan…" and its picker overlay,
// driven through the whole WindowShell (mocked dock, as session-end-command.test.ts). Contract assumed:
//  - `basis.pick`, titled `kit/text.ts` `commandTitles.basisPick` = `Basis and plan…`, in a group of `commandGroups`,
//    is registered while the window has a feed (`defaultFeed`); running it opens the picker overlay
//    `[data-testid="basis-picker"]`, which closes on Escape like every shell overlay;
//  - the picker reads the window's feed's `basis.active` and `plans.prepared` (and `feed.status` for "between
//    sessions") through the store (C64); its candidates are `basis.active.sessions` per kind, newest first, each option's
//    label holding its day (`kit/values/format.ts` `formatDay`, C68), and the team's saved plans (`plans.prepared.saved`,
//    also while no round is open); each kind has "none";
//  - practice is a multi-select: `<input type="checkbox" data-testid="practice-<sessionUid>@<weekendId>">` and
//    `practice-none` (checked while no practice is chosen; checking it clears the practice); qualifying and plan are one
//    each: `<input type="radio" data-testid="qualifying-<key>">`, `qualifying-none`, `plan-<id>`, `plan-none`;
//  - the draft starts at the basis in use (`basis.active.basis`) and its plan, is window-local (C73) and sends nothing
//    until `<button data-testid="basis-confirm">`; Confirm sends exactly one uiAction: in a session `basis.choose
//    { feedId, basis, plan }` (plan an id or `null` for none); between sessions the picker reads `plans.sessions`
//    instead (SP4.3f Task 6: `src/shell/basis/BasisPicker.planning.test.ts`);
//  - an ok outcome closes the picker; a rejection keeps it open with the bridge's message in `[data-testid="basis-error"]`;
//  - while `basis.active.rebuilding` is set, `[data-testid="basis-progress"]` reads `rebuilding 1 / 3`;
//  - an option the team's last confirmed choice names (`basis.active.lastChoice`) carries the mark `last choice`;
//  - the top bar's basis segment (`segment-basis`) is a button that runs `basis.pick`.
// Fails until the command, the overlay and the segment exist (implementation).
import type { BasisActive, FeedStatus, UiAction } from '@pitwall/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import { formatDay } from '../../src/kit/values/format.ts';
import { CommandRegistry } from '../../src/shell/commands/registry.ts';
import { CLOSED_ROUND, OLD_PLAN_ID, P16, P17, PLAN_ID, Q04, Q17, SESSIONS, active, keyOf } from './basis-fixtures.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

const titles = text.commandTitles as unknown as Record<string, unknown>;

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
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

const mount = async (feed = true) => {
  const ctx = makeStore();
  ctx.connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x', team: 5 }] });
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, ...(feed && { defaultFeed: FEED }) });
  await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
  await ctx.push('ui.linkGroups', [group1()]);
  await tick();
  /** Pushes a feed topic's value to its newest subscription for the window's feed. */
  const pushFeed = async (topic: string, value: unknown): Promise<void> => {
    const found = ctx.connection.subscribes().filter((s) => s.topic === topic && s.feedId === FEED).at(-1);
    if (found === undefined) throw new Error(`no subscription to ${topic} for the feed`);
    ctx.connection.push({ type: 'snapshot', id: found.id, value });
    await tick();
  };
  /** The basis and plan uiActions sent so far, with their message ids. */
  const sent = (): { id: string; action: UiAction }[] =>
    ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' && (m.action.kind === 'basis.choose' || m.action.kind === 'plans.round.open') ? [{ id: m.id, action: m.action }] : []));
  /** Opens the picker and gives it the feed's values. */
  const open = async (basis: BasisActive = active(), between = false): Promise<HTMLElement> => {
    expect(shellRegistry().run('basis.pick')).toBe(true);
    await tick();
    await pushFeed('basis.active', basis);
    await pushFeed('plans.prepared', CLOSED_ROUND);
    await pushFeed('feed.status', status(between));
    return screen.getByTestId('basis-picker');
  };
  const answer = async (id: string, outcome: { ok: true } | { ok: false; message: string }): Promise<void> => {
    ctx.connection.push({ type: 'actionResult', id, ...outcome } as never);
    await tick();
    await tick();
  };
  return { ...ctx, pushFeed, sent, open, answer };
};

const input = (root: HTMLElement, id: string): HTMLInputElement => {
  const el = root.querySelector(`[data-testid="${id}"]`);
  if (el === null) throw new Error(`no ${id}`);
  return el as HTMLInputElement;
};
const labelOf = (el: Element): string => (el.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The option test ids of one kind in document order, "none" left out. */
const optionIds = (root: HTMLElement, kind: 'practice' | 'qualifying' | 'plan'): string[] =>
  [...root.querySelectorAll(`[data-testid^="${kind}-"]`)].map((e) => e.getAttribute('data-testid') ?? '').filter((id) => id !== `${kind}-none`);
const confirm = (root: HTMLElement): HTMLButtonElement => input(root, 'basis-confirm') as unknown as HTMLButtonElement;

describe('the command "Basis and plan…" (C72)', () => {
  it('basis.pick is registered for the window\'s feed, titled "Basis and plan…", and opens the picker', async () => {
    await mount();
    const command = shellRegistry().list().find((c) => c.id === 'basis.pick');
    expect(titles['basisPick']).toBe('Basis and plan…');
    expect(command?.title).toBe(titles['basisPick']);
    expect(Object.values(text.commandGroups)).toContain(command?.group);
    expect(screen.queryByTestId('basis-picker')).toBeNull();
    expect(shellRegistry().run('basis.pick')).toBe(true);
    await tick();
    expect(screen.getByTestId('basis-picker')).toBeTruthy();
  });

  it('a window without a feed has no basis.pick', async () => {
    await mount(false);
    expect(shellRegistry().list().map((c) => c.id)).not.toContain('basis.pick');
  });

  it('Escape closes the picker', async () => {
    const t = await mount();
    await t.open();
    press('Escape');
    await tick();
    expect(screen.queryByTestId('basis-picker')).toBeNull();
  });

  it('the top bar\'s basis segment runs basis.pick', async () => {
    const t = await mount();
    await t.pushFeed('basis.active', active());
    const button = screen.getByTestId('segment-basis').querySelector('button');
    expect(button).not.toBeNull();
    await fireEvent.click(button!);
    await tick();
    expect(screen.getByTestId('basis-picker')).toBeTruthy();
  });
});

describe('the picker\'s candidates', () => {
  it('practice and qualifying: the stored sessions on the track per kind, newest first, dated, with none', async () => {
    const root = await (await mount()).open();
    expect(optionIds(root, 'practice')).toEqual([`practice-${keyOf(P17)}`, `practice-${keyOf(P16)}`]);
    expect(optionIds(root, 'qualifying')).toEqual([`qualifying-${keyOf(Q17)}`, `qualifying-${keyOf(Q04)}`]);
    expect(input(root, `practice-${keyOf(P16)}`).type).toBe('checkbox');
    expect(input(root, `qualifying-${keyOf(Q17)}`).type).toBe('radio');
    for (const ref of [P16, P17, Q17, Q04]) {
      const kind = SESSIONS[keyOf(ref)]!.kind;
      expect(labelOf(input(root, `${kind}-${keyOf(ref)}`))).toContain(formatDay(SESSIONS[keyOf(ref)]!.date));
    }
    expect(input(root, 'practice-none')).toBeTruthy();
    expect(input(root, 'qualifying-none')).toBeTruthy();
  });

  it('plan: the team\'s saved plans by name, also while no round is open, with none', async () => {
    const root = await (await mount()).open();
    expect(optionIds(root, 'plan').sort()).toEqual([`plan-${OLD_PLAN_ID}`, `plan-${PLAN_ID}`].sort());
    expect(labelOf(input(root, `plan-${PLAN_ID}`))).toContain('Texas 18 Nov 09:40');
    expect(labelOf(input(root, `plan-${OLD_PLAN_ID}`))).toContain('Texas 4 Nov');
    expect(input(root, 'plan-none').type).toBe('radio');
  });

  it('the options the team\'s last confirmed choice names carry "last choice"', async () => {
    const root = await (await mount()).open(active({ lastChoice: { basis: { practice: [P16], qualifying: Q04 }, plan: OLD_PLAN_ID } }));
    expect(labelOf(input(root, `practice-${keyOf(P16)}`))).toContain('last choice');
    expect(labelOf(input(root, `qualifying-${keyOf(Q04)}`))).toContain('last choice');
    expect(labelOf(input(root, `plan-${OLD_PLAN_ID}`))).toContain('last choice');
    expect(labelOf(input(root, `practice-${keyOf(P17)}`))).not.toContain('last choice');
    expect(labelOf(input(root, `qualifying-${keyOf(Q17)}`))).not.toContain('last choice');
  });
});

describe('the picker\'s draft (C73)', () => {
  it('starts at the basis in use and its plan; changing it sends nothing', async () => {
    const t = await mount();
    const root = await t.open();
    expect(input(root, `practice-${keyOf(P17)}`).checked).toBe(true);
    expect(input(root, `practice-${keyOf(P16)}`).checked).toBe(false);
    expect(input(root, 'practice-none').checked).toBe(false);
    expect(input(root, `qualifying-${keyOf(Q17)}`).checked).toBe(true);
    expect(input(root, `plan-${PLAN_ID}`).checked).toBe(true);
    await fireEvent.click(input(root, `practice-${keyOf(P16)}`));
    await fireEvent.click(input(root, `qualifying-${keyOf(Q04)}`));
    await fireEvent.click(input(root, 'plan-none'));
    expect(input(root, `practice-${keyOf(P16)}`).checked).toBe(true);
    expect(input(root, `qualifying-${keyOf(Q04)}`).checked).toBe(true);
    expect(t.sent()).toEqual([]);
  });

  it('a basis of none starts with every none checked', async () => {
    const root = await (await mount()).open(active({ basis: { practice: [], qualifying: null }, plan: null }));
    expect(input(root, 'practice-none').checked).toBe(true);
    expect(input(root, 'qualifying-none').checked).toBe(true);
    expect(input(root, 'plan-none').checked).toBe(true);
  });
});

describe('Confirm', () => {
  it('in a session: one basis.choose with the chosen practice, qualifying and plan', async () => {
    const t = await mount();
    const root = await t.open();
    await fireEvent.click(input(root, `practice-${keyOf(P16)}`));
    await fireEvent.click(input(root, `qualifying-${keyOf(Q04)}`));
    await fireEvent.click(input(root, `plan-${OLD_PLAN_ID}`));
    await fireEvent.click(confirm(root));
    await tick();
    const sent = t.sent().map((s) => s.action);
    expect(sent).toHaveLength(1);
    const choose = sent[0] as Extract<UiAction, { kind: 'basis.choose' }>;
    expect(choose.kind).toBe('basis.choose');
    expect(choose.feedId).toBe(FEED);
    expect(choose.basis.qualifying).toEqual(Q04);
    expect([...choose.basis.practice].sort((a, b) => a.sessionUid.localeCompare(b.sessionUid))).toEqual([P16, P17]);
    expect(choose.plan).toBe(OLD_PLAN_ID);
  });

  it('none per kind: practice none clears the practice; basis.choose names no session and no plan', async () => {
    const t = await mount();
    const root = await t.open();
    await fireEvent.click(input(root, 'practice-none'));
    expect(input(root, `practice-${keyOf(P17)}`).checked).toBe(false);
    expect(input(root, 'practice-none').checked).toBe(true);
    await fireEvent.click(input(root, 'qualifying-none'));
    await fireEvent.click(input(root, 'plan-none'));
    await fireEvent.click(confirm(root));
    await tick();
    expect(t.sent().map((s) => s.action)).toEqual([{ kind: 'basis.choose', feedId: FEED, basis: { practice: [], qualifying: null }, plan: null }]);
  });

  it('an ok outcome closes the picker', async () => {
    const t = await mount();
    const root = await t.open();
    await fireEvent.click(confirm(root));
    await tick();
    const [only] = t.sent();
    expect(only).toBeDefined();
    await t.answer(only!.id, { ok: true });
    await vi.waitFor(() => expect(screen.queryByTestId('basis-picker')).toBeNull());
  });

  it('a rejection keeps the picker open with the bridge\'s message', async () => {
    const t = await mount();
    const root = await t.open();
    await fireEvent.click(confirm(root));
    await tick();
    const [only] = t.sent();
    await t.answer(only!.id, { ok: false, message: 'session 9988776655443322110 is not stored' });
    await vi.waitFor(() => expect(screen.getByTestId('basis-error').textContent).toContain('session 9988776655443322110 is not stored'));
    expect(screen.getByTestId('basis-picker')).toBeTruthy();
  });
});

describe('the rebuild progress', () => {
  it('reads "rebuilding 1 / 3" while basis.active.rebuilding is set, nothing once current', async () => {
    const t = await mount();
    await t.open(active({ rebuilding: { done: 1, total: 3 } }));
    expect(screen.getByTestId('basis-progress').textContent?.replace(/\s+/g, ' ').trim()).toBe('rebuilding 1 / 3');
    await t.pushFeed('basis.active', active());
    expect(screen.queryByTestId('basis-progress')).toBeNull();
  });
});
