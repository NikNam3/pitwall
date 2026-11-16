// @vitest-environment jsdom
// SP4.3d2 Task 12 "supervisor first", plan call 10 (C72, C73): the planning round's controls are commands.
//  - `planningCommands(send)` (shell/commands/default-commands.ts): one command with arguments per id of
//    `WIDGET_COMMAND_IDS` (`plans.prepare.laps`, `.save`, `.accept`, `.remove`, `.activate`, `plan.accept`); its
//    arguments are its uiAction without `kind`; it sends that uiAction and resolves with its outcome;
//  - `CommandRegistry.registerWithArgs` / `invoke(id, args)`: `invoke` of an id without a command resolves `notSupported`;
//    commands with arguments are not in `list()` (the palette and keys run commands without arguments);
//  - `planningSlotCommands(cars, { feedId, invoke })`: per car and slot of `PLAN_SLOTS`,
//    `plans.prepare.activate.<car>.<slot>` and `plans.prepare.remove.<car>.<slot>`, which invoke
//    `plans.prepare.activate` / `.remove` for the feed;
//  - WindowShell registers the six commands with arguments, and the slot commands for our cars.
import type { ActionOutcome, UiAction } from '@pitwall/contracts';
import { PLAN_SLOTS, carId, type Policy } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIDGET_COMMAND_IDS } from '../../src/kit/command-types.ts';
import { planningCommands, planningSlotCommands, plansPrepareSlotId } from '../../src/shell/commands/default-commands.ts';
import { CommandRegistry } from '../../src/shell/commands/registry.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

const POLICY: Policy = { startCompound: 'medium', stops: [{ lap: 20, compound: 'hard' }] };
const CAR = carId(5);

const withSend = (outcome: ActionOutcome = { ok: true }) => {
  const sent: UiAction[] = [];
  const registry = new CommandRegistry();
  for (const c of planningCommands((action) => {
    sent.push(action);
    return Promise.resolve(outcome);
  })) registry.registerWithArgs(c);
  return { sent, registry };
};

describe('the planning commands (call 10, C72)', () => {
  it('there is one per planning control, none in the palette list', () => {
    const { registry } = withSend();
    expect(registry.listWithArgs().map((c) => c.id).sort()).toEqual([...WIDGET_COMMAND_IDS].sort());
    expect(registry.list()).toEqual([]);
  });

  it('each, invoked with its arguments, sends its uiAction', async () => {
    const { sent, registry } = withSend();
    await registry.invoke('plans.prepare.laps', { feedId: FEED, laps: 44 });
    await registry.invoke('plans.prepare.save', { feedId: FEED, carId: CAR, slot: 'A', policy: POLICY });
    await registry.invoke('plans.prepare.accept', { feedId: FEED, carId: CAR, slot: 'B', policy: POLICY });
    await registry.invoke('plans.prepare.remove', { feedId: FEED, carId: CAR, slot: 'A' });
    await registry.invoke('plans.prepare.activate', { feedId: FEED, carId: CAR, slot: 'B' });
    await registry.invoke('plan.accept', { feedId: FEED, carId: CAR, slot: 'A', policy: POLICY });
    expect(sent).toEqual([
      { kind: 'plans.prepare.laps', feedId: FEED, laps: 44 },
      { kind: 'plans.prepare.save', feedId: FEED, carId: CAR, slot: 'A', policy: POLICY },
      { kind: 'plans.prepare.accept', feedId: FEED, carId: CAR, slot: 'B', policy: POLICY },
      { kind: 'plans.prepare.remove', feedId: FEED, carId: CAR, slot: 'A' },
      { kind: 'plans.prepare.activate', feedId: FEED, carId: CAR, slot: 'B' },
      { kind: 'plan.accept', feedId: FEED, carId: CAR, slot: 'A', policy: POLICY },
    ]);
  });

  it('resolves with the uiAction\'s outcome (C73)', async () => {
    const { registry } = withSend({ ok: false, reason: 'invalid', message: 'laps' });
    await expect(registry.invoke('plans.prepare.laps', { feedId: FEED, laps: 0 })).resolves.toEqual({ ok: false, reason: 'invalid', message: 'laps' });
  });

  it('invoking an id without a registered command resolves notSupported and sends nothing', async () => {
    const registry = new CommandRegistry();
    await expect(registry.invoke('plans.prepare.laps', { feedId: FEED, laps: 44 })).resolves.toEqual({ ok: false, reason: 'notSupported' });
  });

  it('a removed command is gone', async () => {
    const registry = new CommandRegistry();
    const [laps] = planningCommands(() => Promise.resolve({ ok: true }));
    const off = registry.registerWithArgs(laps!);
    off();
    expect(registry.listWithArgs()).toEqual([]);
  });

  it('the slot commands invoke activate and remove per car and slot for the feed', () => {
    const invoke = vi.fn(() => Promise.resolve<ActionOutcome>({ ok: true }));
    const commands = planningSlotCommands([carId(5), carId(7)], { feedId: FEED, invoke });
    const ids = commands.map((c) => c.id);
    for (const car of [5, 7]) for (const slot of PLAN_SLOTS) {
      expect(ids).toContain(`plans.prepare.activate.${car}.${slot}`);
      expect(ids).toContain(`plans.prepare.remove.${car}.${slot}`);
    }
    expect(ids).toHaveLength(2 * 2 * PLAN_SLOTS.length);
    const registry = new CommandRegistry();
    commands.forEach((c) => registry.register(c));
    registry.run(plansPrepareSlotId('remove', carId(7), 'B'));
    registry.run(plansPrepareSlotId('activate', carId(5), 'A'));
    expect(invoke.mock.calls).toEqual([
      ['plans.prepare.remove', { feedId: FEED, carId: 7, slot: 'B' }],
      ['plans.prepare.activate', { feedId: FEED, carId: 5, slot: 'A' }],
    ]);
  });
});

describe('WindowShell registers the planning commands (C72)', () => {
  let registering: { mock: { contexts: unknown[] } } | undefined;
  beforeEach(() => {
    mocks.mountDock.mockReset();
    mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn(), setEditing: vi.fn(), focusPanel: vi.fn() }));
    stubBrowser();
    registering = vi.spyOn(CommandRegistry.prototype, 'registerWithArgs');
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('holds the six commands with arguments and, for our cars, the slot commands, which send their uiActions', async () => {
    const ctx = makeStore();
    render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
    await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
    await ctx.push('ui.linkGroups', [group1()]);
    await ctx.push('session.info', { feedId: FEED, playerCar: carId(5), teammateCar: carId(7), session: { updatedAt: 1 } });
    await tick();
    const registry = registering?.mock.contexts[0] as CommandRegistry;
    expect(registry.listWithArgs().map((c) => c.id).sort()).toEqual([...WIDGET_COMMAND_IDS].sort());
    const ids = registry.list().map((c) => c.id);
    for (const car of [5, 7]) for (const slot of PLAN_SLOTS) {
      expect(ids).toContain(`plans.prepare.activate.${car}.${slot}`);
      expect(ids).toContain(`plans.prepare.remove.${car}.${slot}`);
    }
    const actions = () => ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' ? [m.action] : []));
    registry.run(`plans.prepare.remove.7.${PLAN_SLOTS[0]}`);
    void registry.invoke('plans.prepare.laps', { feedId: FEED, laps: 44 });
    await tick();
    expect(actions()).toContainEqual({ kind: 'plans.prepare.remove', feedId: FEED, carId: 7, slot: PLAN_SLOTS[0] });
    expect(actions()).toContainEqual({ kind: 'plans.prepare.laps', feedId: FEED, laps: 44 });
  });
});
