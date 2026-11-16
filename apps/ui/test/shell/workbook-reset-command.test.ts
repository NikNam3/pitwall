// @vitest-environment jsdom
// SP4.3c Task 24 (spec §5.9, C72, C73): the shell command "Reset workbook to default".
// Contract:
//  - The window's command registry holds `workbook.reset` (group: the workbooks group) with a non-empty title.
//  - Running it sends exactly one `uiAction { kind: 'workbook.reset', name }` with the active workbook's name; the
//    window changes nothing itself: the reset takes effect when the bridge publishes `ui.workbooks` (C73).
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../src/shell/commands/registry.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

beforeEach(() => {
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn() }));
  stubBrowser();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Mounts a window on workbook `race` and returns its store context and command registry. */
const mount = async () => {
  const register = vi.spyOn(CommandRegistry.prototype, 'register');
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['quali', 'race'], active: workbook() });
  await ctx.push('ui.linkGroups', [group1()]);
  await ctx.push('ui.alerts', { acknowledged: [], muted: [] });
  await tick();
  const registry = register.mock.contexts.find((c): c is CommandRegistry => c instanceof CommandRegistry);
  if (registry === undefined) throw new Error('the window registered no command');
  return { ctx, registry };
};
const resets = (ctx: Awaited<ReturnType<typeof mount>>['ctx']) =>
  ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'workbook.reset' ? [m.action] : []));

describe('workbook.reset (Reset workbook to default)', () => {
  it('is a registered command with a title, in the workbooks group', async () => {
    const { registry } = await mount();
    const command = registry.list().find((c) => c.id === 'workbook.reset');
    expect(command).toBeDefined();
    expect(command!.title.length).toBeGreaterThan(0);
    const saveAs = registry.list().find((c) => c.id === 'workbook.saveAs');
    expect(command!.group).toBe(saveAs!.group);
  });

  it('sends one workbook.reset uiAction naming the active workbook', async () => {
    const { ctx, registry } = await mount();
    expect(registry.run('workbook.reset')).toBe(true);
    await tick();
    expect(resets(ctx)).toEqual([{ kind: 'workbook.reset', name: 'race' }]);
  });

  it('sends the name of the workbook the bridge publishes as active now', async () => {
    const { ctx, registry } = await mount();
    await ctx.push('ui.workbooks', { names: ['quali', 'race'], active: { ...workbook(), name: 'quali' } });
    await tick();
    registry.run('workbook.reset');
    await tick();
    expect(resets(ctx)).toEqual([{ kind: 'workbook.reset', name: 'quali' }]);
  });
});
