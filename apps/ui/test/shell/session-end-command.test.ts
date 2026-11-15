// @vitest-environment jsdom
// SP4.3c Task 10b (C59, C72, C73): the shell command "End session". Seam: `sessionEndCommand(ctx)` in
// `src/shell/commands/default-commands.ts`, `ctx: { send, feedId }`, gives the command `session.end`, titled
// `kit/text.ts` `commandTitles.sessionEnd` (C68), in a group from `commandGroups`; running it sends exactly one uiAction
// `{ kind: 'session.end', feedId }` for the window's feed. The window keeps no copy (C73): the session ends when the
// bridge ends it. WindowShell registers it while it has a feed (`defaultFeed`), as it does the calibration commands.
import type { UiAction } from '@pitwall/contracts';
import { feedId, type FeedId } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import * as defaults from '../../src/shell/commands/default-commands.ts';
import { CommandRegistry, type Command } from '../../src/shell/commands/registry.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

/** The seam this task adds; read through the modules so the file compiles before it exists. */
type EndSeam = { sessionEndCommand: (ctx: { send: (action: UiAction) => void; feedId: FeedId }) => Command };
const { sessionEndCommand } = defaults as unknown as EndSeam;
const titles = text.commandTitles as unknown as Record<string, unknown>;

describe('sessionEndCommand (C72)', () => {
  it('session.end sends exactly one session.end for the window\'s feed', () => {
    const send = vi.fn();
    const window = feedId('udp-20777');
    const command = sessionEndCommand({ send, feedId: window });
    expect(command.id).toBe('session.end');
    expect(titles['sessionEnd']).toEqual(expect.stringMatching(/\S/));
    expect(command.title).toBe(titles['sessionEnd']);
    expect(Object.values(text.commandGroups)).toContain(command.group);
    expect(send).not.toHaveBeenCalled();
    const registry = new CommandRegistry();
    registry.register(command);
    expect(registry.run('session.end')).toBe(true);
    expect(send.mock.calls).toEqual([[{ kind: 'session.end', feedId: window }]]);
  });
});

/** Watches `register` (it still registers); the shell's registry is the `this` of its first call. */
let registering: { mock: { contexts: unknown[] } } | undefined;
const shellRegistry = (): CommandRegistry => {
  const registry = registering?.mock.contexts[0] as CommandRegistry | undefined;
  if (registry === undefined) throw new Error('the shell registered no command');
  return registry;
};

describe('the shell registers "End session" for its feed (C72, C73)', () => {
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

  const mount = async (feed: FeedId | undefined) => {
    const ctx = makeStore();
    render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, ...(feed !== undefined && { defaultFeed: feed }) });
    await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
    await ctx.push('ui.linkGroups', [group1()]);
    await tick();
    const ended = () => ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'session.end' ? [m.action] : []));
    return { ...ctx, ended };
  };

  it('running session.end sends one session.end with the window\'s feed', async () => {
    const t = await mount(FEED);
    const command = shellRegistry().list().find((c) => c.id === 'session.end');
    expect(command?.title).toBe(titles['sessionEnd']);
    expect(t.ended()).toEqual([]);
    expect(shellRegistry().run('session.end')).toBe(true);
    await tick();
    expect(t.ended()).toEqual([{ kind: 'session.end', feedId: FEED }]);
  });

  it('a window without a feed has no session.end', async () => {
    await mount(undefined);
    expect(shellRegistry().list().map((c) => c.id)).not.toContain('session.end');
  });
});
