// @vitest-environment jsdom
// SP4.3d1 Task 11 review F1 (C72, R34): WindowShell registers the plan commands for our cars: `plan.clear.<car>`,
// `plan.activate.<car>.<slot>` and `plan.remove.<car>.<slot>`; no `plan.commit` or `plan.save` (they need a row's policy),
// no `plan.edit` (no shell seam opens a widget's draft).
import { PLAN_SLOTS, carId } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../src/shell/commands/registry.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

let registering: { mock: { contexts: unknown[] } } | undefined;

describe('the shell registers the plan commands for our cars (C72)', () => {
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

  it('holds clear, activate and remove for the player and the teammate, and no save, commit or edit', async () => {
    const ctx = makeStore();
    render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
    await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
    await ctx.push('ui.linkGroups', [group1()]);
    await ctx.push('session.info', { feedId: FEED, playerCar: carId(5), teammateCar: carId(7), session: { updatedAt: 1 } });
    await tick();
    const registry = registering?.mock.contexts[0] as CommandRegistry;
    const ids = registry.list().map((c) => c.id);
    for (const car of [5, 7]) {
      expect(ids).toContain(`plan.clear.${car}`);
      for (const slot of PLAN_SLOTS) {
        expect(ids).toContain(`plan.activate.${car}.${slot}`);
        expect(ids).toContain(`plan.remove.${car}.${slot}`);
      }
    }
    expect(ids.filter((id) => /^plan\.(save|commit|edit)\./.test(id))).toEqual([]);
    registry.run('plan.activate.5.' + PLAN_SLOTS[0]);
    await tick();
    expect(ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' ? [m.action] : []))).toContainEqual({
      kind: 'plan.activate',
      feedId: FEED,
      carId: 5,
      slot: PLAN_SLOTS[0],
    });
  });
});
