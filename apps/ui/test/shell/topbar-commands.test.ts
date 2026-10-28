// @vitest-environment jsdom
// Commands of Task 17 (spec 7.7, 8.2, 8.5).
// Contract:
//  - `CommandContext` gains `inspection: Inspection` (shell/inspector/inspection.svelte.ts). `defaultCommands(ctx)` includes
//    `dev.inspect` (key Ctrl+I in DEFAULT_KEYS) only when `import.meta.env.DEV` is true at the call; it runs `ctx.inspection.toggle()`.
//  - WindowShell mounts the top bar for its default feed; `alerts.ackAll` (Ctrl+Enter) sends `uiAction alert.ackAll` with
//    exactly the keys of the tier-1 alerts the bar shows (at most 3, oldest first; acknowledged and muted ones are not shown).
import { cleanup, render } from '@testing-library/svelte';
import { feedId, type Insight } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYS, defaultCommands, type CommandContext } from '../../src/shell/commands/default-commands.ts';
import { Inspection } from '../../src/shell/inspector/inspection.svelte.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const context = (over: Partial<CommandContext> = {}): CommandContext => ({
  send: vi.fn(),
  sendReplay: vi.fn(),
  open: vi.fn(),
  workbookNames: () => [],
  groups: () => [],
  settings: () => undefined,
  fontPx: () => 14,
  setFontPx: vi.fn(),
  defaultFontPx: () => 14,
  setTheme: vi.fn(),
  focusWindow: vi.fn(),
  alertKeys: () => [],
  inspection: new Inspection(),
  ...over,
});

describe('dev.inspect', () => {
  it('is bound to Ctrl+I', () => {
    expect(DEFAULT_KEYS['Ctrl+I']).toBe('dev.inspect');
  });

  it('in a dev build it is registered and toggles the inspection on and off', () => {
    vi.stubEnv('DEV', true);
    const inspection = new Inspection();
    const command = defaultCommands(context({ inspection })).find((c) => c.id === 'dev.inspect');
    expect(command).toBeDefined();
    command!.run();
    expect(inspection.on).toBe(true);
    command!.run();
    expect(inspection.on).toBe(false);
  });

  it('in a non-dev build it is not registered', () => {
    vi.stubEnv('DEV', false);
    expect(defaultCommands(context()).some((c) => c.id === 'dev.inspect')).toBe(false);
  });
});

const crit = (key: string, at: number, over: Partial<Insight> = {}): Insight => ({
  key,
  severity: 'critical',
  category: 'damage',
  feedId: feedId('f1'),
  kind: 'k',
  params: {},
  raisedAt: at,
  ...over,
});

const mount = async (insights: Insight[], alerts = { acknowledged: [] as string[], muted: [] as string[] }) => {
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
  await ctx.push('ui.linkGroups', [group1()]);
  await ctx.push('ui.alerts', alerts);
  ctx.connection.push({ type: 'snapshot', id: ctx.latestId('insights'), entries: insights.map((insight) => ({ type: 'raised', insight })) });
  await tick();
  return ctx;
};
const ackAlls = (ctx: Awaited<ReturnType<typeof mount>>) =>
  ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'alert.ackAll' ? [m.action.keys] : []));

describe('alerts.ackAll (Ctrl+Enter)', () => {
  it('sends exactly the keys shown: at most 3, oldest first, without advisory, acknowledged or muted ones', async () => {
    const ctx = await mount(
      [
        crit('d', 4000),
        crit('a', 1000),
        crit('adv', 500, { severity: 'advisory' }),
        crit('acked', 600),
        crit('muted', 700, { category: 'tyres' }),
        crit('c', 3000),
        crit('b', 2000),
      ],
      { acknowledged: ['f1:acked:600'], muted: ['tyres'] },
    );
    press('Enter', { ctrl: true });
    await tick();
    // the keys are occurrence tokens `<feedId>:<insightKey>:<raisedAt>`
    expect(ackAlls(ctx)).toEqual([['f1:a:1000', 'f1:b:2000', 'f1:c:3000']]);
  });

  it('sends nothing when no alert is shown', async () => {
    const ctx = await mount([crit('adv', 500, { severity: 'advisory' })]);
    press('Enter', { ctrl: true });
    await tick();
    expect(ackAlls(ctx)).toEqual([]);
  });
});
