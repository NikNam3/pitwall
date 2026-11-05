// @vitest-environment jsdom
// The "Add panel" commands (Task 14; C67, C70, C72, C73). dockview is mocked as in the other WindowShell tests.
// Contract assumed of the shell: one command `panel.add.<widget name>` per registered widget (the `widgets` prop),
// titled `text.commandTitles.panelAdd(<widget title>)` = "Add panel: <title>", group `text.commandGroups.window`,
// no default key; running it calls `dock.addPanel(defaultPanel(decl))`; the dock's change then reaches the bridge as
// one debounced `workbook.updateWindow`. The tests bind keys through `ui.settings.keys` to run a command by id.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { carId } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import { DEFAULT_KEYS } from '../../src/shell/commands/default-commands.ts';
import { defaultPanel } from '../../src/shell/workbooks/default-panel.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

type Handle = { addPanel: ReturnType<typeof vi.fn>; updatePanel: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

const handles: Handle[] = [];
type OnChange = (layout: unknown, panels: Record<string, unknown>) => void;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  handles.length = 0;
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => {
    const handle: Handle = { addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn() };
    handles.push(handle);
    return handle;
  });
  stubBrowser();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** One function key per test widget, so each `panel.add.<name>` can be run by id through the key listener. */
const KEY_OF = new Map(TEST_WIDGETS.map((w, i) => [w.decl.name, `F${i + 1}`] as const));
const keys = Object.fromEntries(TEST_WIDGETS.map((w) => [KEY_OF.get(w.decl.name)!, `panel.add.${w.decl.name}`]));

const mount = async (withKeys = true) => {
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
  await ctx.push('ui.linkGroups', [group1()]);
  await ctx.push('ui.settings', { realismNextSession: false, keys: withKeys ? keys : {} });
  await ctx.push('session.info', { feedId: FEED, playerCar: carId(5), session: { updatedAt: 1 } });
  return ctx;
};
const onChangeOf = (): OnChange => mocks.mountDock.mock.calls.at(-1)![3] as OnChange;

describe('panel.add.<widget> commands', () => {
  it('the title is "Add panel: <title>" and the group is Window', () => {
    expect(text.commandTitles.panelAdd('Probe')).toBe('Add panel: Probe');
    expect(text.commandGroups.window).toBe('Window');
  });

  it('no add-panel command has a default key', () => {
    expect(Object.values(DEFAULT_KEYS).filter((id) => id.startsWith('panel.add.'))).toEqual([]);
  });

  it('every registered widget has a command: running it adds that widget\'s default panel to the dock', async () => {
    await mount();
    for (const w of TEST_WIDGETS) {
      press(KEY_OF.get(w.decl.name)!);
      await tick();
      expect(handles[0]!.addPanel).toHaveBeenLastCalledWith(defaultPanel(w.decl));
    }
    expect(handles[0]!.addPanel).toHaveBeenCalledTimes(TEST_WIDGETS.length);
  });

  it('the palette lists one "Add panel: <title>" command per widget, and Enter runs the first match', async () => {
    await mount(false);
    press('k', { ctrl: true });
    await tick();
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Add panel' } });
    for (const w of TEST_WIDGETS) expect(screen.getByText(text.commandTitles.panelAdd(w.decl.title))).toBeTruthy();
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Add panel: Size probe' } });
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await tick();
    const size = TEST_WIDGETS.find((w) => w.decl.name === 'size-probe')!;
    expect(handles[0]!.addPanel).toHaveBeenCalledTimes(1);
    expect(handles[0]!.addPanel).toHaveBeenCalledWith(defaultPanel(size.decl));
  });

  it('a command bound in keys.json is listed under Window in the key overview', async () => {
    await mount();
    press('?');
    await tick();
    const row = screen.getByText(text.commandTitles.panelAdd('Probe'));
    let heading: Element | null = row.parentElement;
    while (heading !== null && !heading.classList.contains('group')) heading = heading.previousElementSibling;
    expect(heading?.textContent).toBe('Window');
  });

  it('the dock change after a command is saved as one workbook.updateWindow holding the new panel', async () => {
    const ctx = await mount();
    press(KEY_OF.get('probe')!);
    await tick();
    const spec = defaultPanel(TEST_WIDGETS.find((w) => w.decl.name === 'probe')!.decl);
    expect(handles[0]!.addPanel).toHaveBeenCalledWith(spec);
    const panels = { p1: workbook().windows[0]!.panels.p1!, p2: spec };
    onChangeOf()({ L: 'added' }, panels);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]).toMatchObject({ id: 'main', layout: { L: 'added' }, panels });
  });
});
