// @vitest-environment jsdom
// SP4.3f Task 10 (spec §4.4 "Saving in the panel"; C64, C72, C73, C74): the shell command "Save plan…" and its overlay,
// driven through the whole WindowShell (mocked dock, as basis-picker.test.ts). Contract assumed:
//  - seam `planSavePickCommand(ctx)` in `src/shell/commands/default-commands.ts`, `ctx: Pick<CommandContext, 'open'>`
//    (as `basisPickCommand`), gives the command `plans.save.pick`, titled `Save plan…` (a `kit/text.ts`
//    `commandTitles` entry, C68), in the group `commandGroups.session`; running it opens the overlay
//    `{ kind: 'planSave' }` and sends nothing;
//  - WindowShell registers it only while the default feed's `plans.prepared` is open (C72); running it shows
//    `[data-testid="plan-save-picker"]` (`shell/plans/PlanSavePicker.svelte`), which closes on Escape like every
//    shell overlay;
//  - the plan board's `save` invokes it through its panel (C74): the shell registry's `invoke('plans.save.pick', {})`
//    opens the same overlay.
// Fails until the command, the overlay and its mount exist (implementation).
import type { PlanningRoundState, UiAction } from '@pitwall/contracts';
import { carId, unknown } from '@pitwall/domain';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import * as defaults from '../../src/shell/commands/default-commands.ts';
import { CommandRegistry, type Command } from '../../src/shell/commands/registry.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

/** The seam this task adds; read through the module so the file compiles before it exists. */
type SaveSeam = { planSavePickCommand: (ctx: { open: (overlay: { kind: string }) => void }) => Command };
const { planSavePickCommand } = defaults as unknown as SaveSeam;

const SAVED: PlanningRoundState['saved'] = [{ id: 'a', name: 'Texas 18 Nov 09:40', savedAt: '2026-11-18T08:40:00Z' }];
const CLOSED: PlanningRoundState = { open: false, saved: SAVED };
const OPEN: PlanningRoundState = {
  open: true,
  qualifying: { sessionUid: '12101553556244014932', weekendId: '548397152' },
  practice: [],
  race: { laps: 56, sets: 'fresh', conditions: { kind: 'imported' } },
  team: 0,
  trackId: 15,
  playerCar: carId(0),
  teammateCar: carId(1),
  forecast: { source: { ref: { sessionUid: '12101553556244014932', weekendId: '548397152' }, startedAt: '2026-11-17T19:10:00.000Z' }, rows: unknown('notReceived') },
  rebuilding: false,
  cars: {},
  running: false,
  saved: SAVED,
};

describe('planSavePickCommand (C72)', () => {
  it('plans.save.pick, titled "Save plan…" in the session group, opens { kind: "planSave" } and sends nothing', () => {
    const open = vi.fn();
    const command = planSavePickCommand({ open });
    expect(command.id).toBe('plans.save.pick');
    expect(command.title).toBe('Save plan…');
    expect(Object.values(text.commandTitles)).toContain(command.title);
    expect(command.group).toBe(text.commandGroups.session);
    expect(open).not.toHaveBeenCalled();
    const registry = new CommandRegistry();
    registry.register(command);
    expect(registry.run('plans.save.pick')).toBe(true);
    expect(open.mock.calls).toEqual([[{ kind: 'planSave' }]]);
  });
});

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

const mount = async () => {
  const ctx = makeStore();
  ctx.connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x', team: 0 }] });
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['plan'], active: workbook(16) });
  await ctx.push('ui.linkGroups', [group1()]);
  await tick();
  /** Pushes `plans.prepared` to every subscription of the window's feed (the shell's, the top bar's, the overlay's). */
  const prepared = async (value: PlanningRoundState): Promise<void> => {
    const found = ctx.connection.subscribes().filter((s) => s.topic === 'plans.prepared' && s.feedId === FEED);
    if (found.length === 0) throw new Error('no subscription to plans.prepared for the feed');
    for (const s of found) ctx.connection.push({ type: 'snapshot', id: s.id, value });
    await tick();
    await tick();
  };
  const ids = (): string[] => shellRegistry().list().map((c) => c.id);
  const saves = (): UiAction[] => ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'plans.save' ? [m.action] : []));
  return { ...ctx, prepared, ids, saves };
};

describe('WindowShell: "Save plan…" while the round is open (C72)', () => {
  it('plans.save.pick is registered only while the default feed\'s plans.prepared is open', async () => {
    const t = await mount();
    expect(t.ids()).not.toContain('plans.save.pick');
    await t.prepared(CLOSED);
    expect(t.ids()).not.toContain('plans.save.pick');
    await t.prepared(OPEN);
    expect(t.ids()).toContain('plans.save.pick');
    expect(shellRegistry().list().find((c) => c.id === 'plans.save.pick')?.title).toBe('Save plan…');
    await t.prepared(CLOSED);
    expect(t.ids()).not.toContain('plans.save.pick');
  });

  it('running it opens the save overlay, which sends nothing and closes on Escape', async () => {
    const t = await mount();
    await t.prepared(OPEN);
    expect(screen.queryByTestId('plan-save-picker')).toBeNull();
    expect(shellRegistry().run('plans.save.pick')).toBe(true);
    await tick();
    await t.prepared(OPEN);
    expect(screen.getByTestId('plan-save-picker')).toBeTruthy();
    expect(t.saves()).toEqual([]);
    press('Escape');
    await tick();
    expect(screen.queryByTestId('plan-save-picker')).toBeNull();
    expect(t.saves()).toEqual([]);
  });

  it('the board\'s path: invoking plans.save.pick through the registry (the panel\'s invoke, C74) opens the overlay', async () => {
    const t = await mount();
    await t.prepared(OPEN);
    const invoke = shellRegistry().invoke.bind(shellRegistry()) as unknown as (id: string, args: object) => Promise<unknown>;
    await expect(invoke('plans.save.pick', {})).resolves.toEqual({ ok: true });
    await tick();
    expect(screen.getByTestId('plan-save-picker')).toBeTruthy();
    expect(t.saves()).toEqual([]);
  });
});
