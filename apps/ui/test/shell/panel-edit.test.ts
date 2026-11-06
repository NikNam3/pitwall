// @vitest-environment jsdom
// Panel edit mode (pre-4.1 spec section 2; plan Task 2; task fix-c72; C67, C72, C73). dockview is mocked as in
// panel-add.test.ts for the WindowShell tests; the last describe mounts the real dock (`vi.importActual`) for the `+`,
// `targetActiveGroup` and `removePanel`. Buttons invoke commands by id (C72): the tests spy on
// `CommandRegistry.prototype.run` and check the id as well as the visible effect.
// Contract assumed of the shell:
//  - the command `layout.edit.toggle` (title `text.commandTitles.layoutEditToggle` = "Edit layout", default key Ctrl+E)
//    and a top-bar button named `text.editLayout` = "edit layout" flip a window-local edit mode: off at start and after
//    a reload, never sent to the bridge; the button runs `registry.run('layout.edit.toggle')`; each flip calls
//    `dock.setEditing(on)`, and a dock mounted while it is on is told so too; while it is off the shell never calls
//    `setEditing` or `removePanel`;
//  - while it is on, every panel header (the dock's `tab`) holds one button named `text.removePanel` = "remove panel",
//    which runs `panel.remove.<panelId>` (title `text.commandTitles.panelRemove(<widget title>)` = "Remove panel: <title>",
//    group `text.commandGroups.window`, no default key); the command calls `dock.removePanel(id)` and exists only while
//    edit mode is on; the dock's change then reaches the bridge as one debounced `workbook.updateWindow`;
//  - while it is on, the command `layout.edit.addPanel` exists too (title `text.commandTitles.layoutEditAddPanel` =
//    "Add panel to the active group", group `text.commandGroups.window`, no default key; its id is not a `panel.add.*`
//    one); it calls `dock.targetActiveGroup()` and opens the palette filtered to the `panel.add.*` commands, from the
//    palette (Ctrl+K) as from the `+`; Ctrl+K opens the palette whole;
//  - `mountDock`'s 7th argument `onAdd` runs `registry.run('layout.edit.addPanel')`;
//  - the real dock shows, while editing, one button named "add panel" per group (absent from the accessibility tree
//    otherwise: removed or `hidden`); its click makes that group active and calls `onAdd`, and sets no target itself;
//    `targetActiveGroup()` makes the active group the target of the next `addPanel`, `cancelAdd()` forgets it (the next
//    `addPanel` opens a new group); `removePanel(id)` reaches `onChange` like any other change.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { PanelSpec } from '@pitwall/contracts';
import { carId } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import { DEFAULT_KEYS } from '../../src/shell/commands/default-commands.ts';
import { CommandRegistry } from '../../src/shell/commands/registry.ts';
import type * as DockModule from '../../src/shell/docking/index.ts';
import { defaultPanel } from '../../src/shell/workbooks/default-panel.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

type Handle = {
  addPanel: ReturnType<typeof vi.fn>;
  updatePanel: ReturnType<typeof vi.fn>;
  removePanel: ReturnType<typeof vi.fn>;
  setEditing: ReturnType<typeof vi.fn>;
  targetActiveGroup: ReturnType<typeof vi.fn>;
  cancelAdd: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};
type PanelViewLike = { render(content: HTMLElement, tab: HTMLElement, spec: PanelSpec, id: string): unknown; title(spec: PanelSpec): string };
type OnChange = (layout: unknown, panels: Record<string, PanelSpec>) => void;
const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

// The names the tests look for, as the plan fixes them (row 1 pins them to `kit/text.ts`).
const EDIT_LAYOUT = 'edit layout';
const ADD_PANEL = 'add panel';
const REMOVE_PANEL = 'remove panel';
const removeTitle = (title: string): string => `Remove panel: ${title}`;
const ADD_TO_GROUP = 'layout.edit.addPanel';
const ADD_TO_GROUP_TITLE = 'Add panel to the active group';

const handles: Handle[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  handles.length = 0;
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => {
    const handle: Handle = {
      addPanel: vi.fn(),
      updatePanel: vi.fn(),
      removePanel: vi.fn(),
      setEditing: vi.fn(),
      targetActiveGroup: vi.fn(),
      cancelAdd: vi.fn(),
      destroy: vi.fn(),
    };
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

const declOf = (name: string) => TEST_WIDGETS.find((w) => w.decl.name === name)!.decl;
const P1: PanelSpec = workbook().windows[0]!.panels.p1!;
const P2: PanelSpec = defaultPanel(declOf('stale-probe'));
const TWO_PANELS = { p1: P1, p2: P2 };
const TITLES: Record<string, string> = { p1: 'Probe', p2: 'Stale probe' };

const withPanels = (panels: Record<string, PanelSpec>, layout: unknown = {}) => {
  const book = workbook(16);
  return { ...book, windows: [{ ...book.windows[0]!, layout, panels }] };
};

const lastMount = () => mocks.mountDock.mock.calls.at(-1)!;
const onChangeOf = (): OnChange => lastMount()[3] as OnChange;
const onAddOf = (): (() => void) => lastMount()[6] as () => void;

/** Mounts every panel of the last dock the way the dock does it; the tabs are attached so their headers can be queried. */
const renderPanels = (): Map<string, HTMLElement> => {
  const panels = lastMount()[2] as Record<string, PanelSpec>;
  const view = lastMount()[4] as PanelViewLike;
  const tabs = new Map<string, HTMLElement>();
  for (const [id, spec] of Object.entries(panels)) {
    const tab = document.body.appendChild(document.createElement('div'));
    view.render(document.body.appendChild(document.createElement('div')), tab, spec, id);
    tabs.set(id, tab);
  }
  return tabs;
};

const mount = async (opts: { panels?: Record<string, PanelSpec>; keys?: Record<string, string> } = {}) => {
  const ctx = makeStore();
  const book = withPanels(opts.panels ?? TWO_PANELS);
  const pushAll = async () => {
    await ctx.push('ui.workbooks', { names: ['race'], active: book });
    await ctx.push('ui.linkGroups', [group1()]);
    await ctx.push('ui.settings', { realismNextSession: false, keys: opts.keys ?? {} });
    await ctx.push('session.info', { feedId: FEED, playerCar: carId(5), session: { updatedAt: 1 } });
  };
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await pushAll();
  const tabs = renderPanels();
  await tick();
  return { ...ctx, tabs, book, pushAll };
};

const clickEditLayout = async (): Promise<void> => {
  await fireEvent.click(screen.getByRole('button', { name: EDIT_LAYOUT }));
  await tick();
};
const removeButtons = (tab: HTMLElement) => within(tab).queryAllByRole('button', { name: REMOVE_PANEL });
const openPalette = async (query: string): Promise<HTMLElement> => {
  press('k', { ctrl: true });
  await tick();
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: query } });
  return screen.getByTestId('overlay');
};
const closeOverlay = async (): Promise<void> => {
  press('Escape');
  await tick();
};

describe('edit mode: commands and keys', () => {
  it('layout.edit.toggle has the default key Ctrl+E', () => {
    expect(DEFAULT_KEYS['Ctrl+E']).toBe('layout.edit.toggle');
    expect(Object.values(DEFAULT_KEYS).filter((id) => id.startsWith('panel.remove.'))).toEqual([]);
    expect(text.commandTitles.layoutEditToggle).toBe('Edit layout');
    expect(text.commandTitles.panelRemove('Probe')).toBe(removeTitle('Probe'));
    expect(text.editLayout).toBe(EDIT_LAYOUT);
    expect(text.addPanel).toBe(ADD_PANEL);
    expect(text.removePanel).toBe(REMOVE_PANEL);
  });

  it('layout.edit.addPanel has its title, no default key and no panel.add. id', () => {
    // Read through a wider type so the file compiles before the title exists.
    const titles: Record<string, unknown> = text.commandTitles;
    expect(titles['layoutEditAddPanel']).toBe(ADD_TO_GROUP_TITLE);
    expect(Object.values(DEFAULT_KEYS)).not.toContain(ADD_TO_GROUP);
    // The `+` palette lists the `panel.add.*` commands: the command that opens it is not one of them.
    expect(ADD_TO_GROUP.startsWith('panel.add.')).toBe(false);
  });

  it('the "edit layout" button runs layout.edit.toggle by id', async () => {
    await mount();
    const run = vi.spyOn(CommandRegistry.prototype, 'run');
    await clickEditLayout();
    expect(run).toHaveBeenCalledWith('layout.edit.toggle');
    expect(handles[0]!.setEditing).toHaveBeenLastCalledWith(true);

    run.mockClear();
    await clickEditLayout();
    expect(run).toHaveBeenCalledWith('layout.edit.toggle');
    expect(handles[0]!.setEditing).toHaveBeenLastCalledWith(false);
  });

  it('layout.edit.addPanel exists only while edit mode is on, under Window', async () => {
    await mount({ keys: { F8: ADD_TO_GROUP } });
    let overlay = await openPalette(ADD_TO_GROUP_TITLE);
    expect(within(overlay).queryByText(ADD_TO_GROUP_TITLE)).toBeNull();
    await closeOverlay();
    press('F8');
    await tick();
    expect(handles[0]!.targetActiveGroup).not.toHaveBeenCalled();
    expect(screen.queryByTestId('overlay')).toBeNull();

    await clickEditLayout();
    overlay = await openPalette(ADD_TO_GROUP_TITLE);
    expect(within(overlay).getByText(ADD_TO_GROUP_TITLE)).toBeTruthy();
    await closeOverlay();

    // The key overview lists the bound command under the Window heading.
    press('?');
    await tick();
    const row = within(screen.getByTestId('overlay')).getByText(ADD_TO_GROUP_TITLE);
    let heading: Element | null = row.parentElement;
    while (heading !== null && !heading.classList.contains('group')) heading = heading.previousElementSibling;
    expect(heading?.textContent).toBe(text.commandGroups.window);
    await closeOverlay();

    // Switched off again, the keys.json binding runs nothing: the command is not in the registry.
    press('e', { ctrl: true });
    await tick();
    press('F8');
    await tick();
    expect(handles[0]!.targetActiveGroup).not.toHaveBeenCalled();
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('edit mode is off at start; the toggle turns it on and off', async () => {
    const { tabs } = await mount();
    for (const tab of tabs.values()) expect(removeButtons(tab)).toHaveLength(0);
    expect(handles[0]!.setEditing).not.toHaveBeenCalledWith(true);

    await clickEditLayout();
    for (const tab of tabs.values()) expect(removeButtons(tab)).toHaveLength(1);
    expect(handles[0]!.setEditing).toHaveBeenLastCalledWith(true);

    press('e', { ctrl: true });
    await tick();
    for (const tab of tabs.values()) expect(removeButtons(tab)).toHaveLength(0);
    expect(handles[0]!.setEditing).toHaveBeenLastCalledWith(false);
    expect(handles[0]!.removePanel).not.toHaveBeenCalled();
  });

  it('a dock mounted again while edit mode is on is told so', async () => {
    const ctx = await mount();
    await clickEditLayout();
    await ctx.push('ui.workbooks', { names: ['race'], active: withPanels(TWO_PANELS, { L: 'from another window' }) });
    expect(handles).toHaveLength(2);
    expect(handles[1]!.setEditing).toHaveBeenLastCalledWith(true);
  });

  it('panel.remove.<id> exists for each panel only while edit mode is on', async () => {
    await mount({ keys: { F9: 'panel.remove.p2' } });
    let overlay = await openPalette('Remove panel');
    for (const title of Object.values(TITLES)) expect(within(overlay).queryByText(removeTitle(title))).toBeNull();
    await closeOverlay();
    press('F9');
    await tick();
    expect(handles[0]!.removePanel).not.toHaveBeenCalled();

    await clickEditLayout();
    overlay = await openPalette('Remove panel');
    for (const title of Object.values(TITLES)) expect(within(overlay).getByText(removeTitle(title))).toBeTruthy();
    await closeOverlay();
    press('F9');
    await tick();
    expect(handles[0]!.removePanel).toHaveBeenCalledTimes(1);
    expect(handles[0]!.removePanel).toHaveBeenCalledWith('p2');

    // Switched off again, the keys.json binding runs nothing: the command is not in the registry.
    press('e', { ctrl: true });
    await tick();
    press('F9');
    await tick();
    expect(handles[0]!.removePanel).toHaveBeenCalledTimes(1);
  });
});

describe('edit mode: removing and adding panels', () => {
  it('a panel\'s × removes it and the window is saved without it', async () => {
    const ctx = await mount();
    await clickEditLayout();
    await fireEvent.click(within(ctx.tabs.get('p2')!).getByRole('button', { name: REMOVE_PANEL }));
    await tick();
    expect(handles[0]!.removePanel).toHaveBeenCalledTimes(1);
    expect(handles[0]!.removePanel).toHaveBeenCalledWith('p2');

    onChangeOf()({ L: 'removed' }, { p1: P1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]).toMatchObject({ id: 'main', layout: { L: 'removed' } });
    expect(ctx.updates()[0]!.panels).toEqual({ p1: P1 });
  });

  /** The titles the open overlay lists, sorted. */
  const listedTitles = (): (string | undefined)[] =>
    within(screen.getByTestId('overlay'))
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
      .sort();
  const addTitles = (): string[] => TEST_WIDGETS.map((w) => text.commandTitles.panelAdd(w.decl.title)).sort();

  it('the + runs layout.edit.addPanel: the active group becomes the target and the palette lists the add commands only', async () => {
    await mount();
    await clickEditLayout();
    const run = vi.spyOn(CommandRegistry.prototype, 'run');
    onAddOf()();
    await tick();
    expect(run).toHaveBeenCalledWith(ADD_TO_GROUP);
    expect(handles[0]!.targetActiveGroup).toHaveBeenCalledTimes(1);
    const overlay = screen.getByTestId('overlay');
    expect(listedTitles()).toEqual(addTitles());

    await fireEvent.click(within(overlay).getByText(text.commandTitles.panelAdd('Size probe')));
    await tick();
    expect(handles[0]!.addPanel).toHaveBeenCalledTimes(1);
    expect(handles[0]!.addPanel).toHaveBeenCalledWith(defaultPanel(declOf('size-probe')));
    expect(handles[0]!.cancelAdd).not.toHaveBeenCalled();

    // The filter belongs to that one opening: Ctrl+K lists every command again.
    const whole = await openPalette('');
    expect(within(whole).getByText(text.commandTitles.layoutEditToggle)).toBeTruthy();
    expect(within(whole).getByText(removeTitle('Probe'))).toBeTruthy();
  });

  it('run from the palette, layout.edit.addPanel does what the + does', async () => {
    await mount();
    await clickEditLayout();
    const overlay = await openPalette(ADD_TO_GROUP_TITLE);
    await fireEvent.click(within(overlay).getByText(ADD_TO_GROUP_TITLE));
    await tick();
    expect(handles[0]!.targetActiveGroup).toHaveBeenCalledTimes(1);
    expect(listedTitles()).toEqual(addTitles());

    await fireEvent.click(within(screen.getByTestId('overlay')).getByText(text.commandTitles.panelAdd('Probe')));
    await tick();
    expect(handles[0]!.addPanel).toHaveBeenCalledTimes(1);
    expect(handles[0]!.addPanel).toHaveBeenCalledWith(defaultPanel(declOf('probe')));
    expect(handles[0]!.cancelAdd).not.toHaveBeenCalled();
  });

  it('the + palette closed without a pick forgets the target', async () => {
    await mount();
    await clickEditLayout();
    onAddOf()();
    await tick();
    expect(handles[0]!.targetActiveGroup).toHaveBeenCalledTimes(1);
    await closeOverlay();
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(handles[0]!.cancelAdd).toHaveBeenCalledTimes(1);
    expect(handles[0]!.addPanel).not.toHaveBeenCalled();
  });

  it('removing the last panel leaves an empty window', async () => {
    const ctx = await mount({ panels: { p1: P1 } });
    expect(screen.queryByRole('button', { name: text.addWidget })).toBeNull();
    await clickEditLayout();
    await fireEvent.click(within(ctx.tabs.get('p1')!).getByRole('button', { name: REMOVE_PANEL }));
    await tick();
    expect(handles[0]!.removePanel).toHaveBeenCalledWith('p1');

    onChangeOf()({}, {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]).toMatchObject({ id: 'main', panels: {} });
    expect(screen.getByRole('button', { name: text.addWidget })).toBeTruthy();
  });

  it('edit mode is off after a reload', async () => {
    const ctx = await mount();
    await clickEditLayout();
    for (const tab of ctx.tabs.values()) expect(removeButtons(tab)).toHaveLength(1);
    cleanup();
    document.body.innerHTML = '';

    render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
    await ctx.pushAll();
    const tabs = renderPanels();
    await tick();
    for (const tab of tabs.values()) expect(removeButtons(tab)).toHaveLength(0);
    expect(handles.at(-1)!.setEditing).not.toHaveBeenCalledWith(true);
  });
});

describe('the dock in edit mode (real dockview)', () => {
  type RealDock = typeof DockModule;
  type RealHandle = ReturnType<RealDock['mountDock']> & { removePanel(id: string): void; setEditing(on: boolean): void; targetActiveGroup(): void };

  const mountReal = async (panels: Record<string, PanelSpec> = { p1: P1, p2: P2 }) => {
    const { mountDock } = await vi.importActual<RealDock>('../../src/shell/docking/index.ts');
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const el = document.body.appendChild(document.createElement('div'));
    const tabs = new Map<string, HTMLElement>();
    const view = {
      title: () => 'Probe',
      render: (_content: HTMLElement, tab: HTMLElement, _spec: PanelSpec, id: string) => {
        tabs.set(id, tab);
        return { destroy() {} };
      },
    };
    const onChange = vi.fn<OnChange>();
    const onAdd = vi.fn<() => void>();
    const mountWith = mountDock as unknown as (...args: unknown[]) => RealHandle;
    const handle = mountWith(el, {}, panels, onChange, view, 4, onAdd);
    // Precondition: every panel is rendered and its header sits in the dock.
    expect([...tabs.keys()].sort()).toEqual(Object.keys(panels).sort());
    for (const tab of tabs.values()) expect(el.contains(tab)).toBe(true);
    return { el, tabs, handle, onChange, onAdd };
  };
  const addButtons = (el: HTMLElement) => within(el).queryAllByRole('button', { name: ADD_PANEL });
  /** The panels whose headers share a tab strip with `button` (or with the tab of a panel). */
  const beside = (node: HTMLElement, tabs: Map<string, HTMLElement>, except?: string): string[] => {
    for (let n = node.parentElement; n !== null; n = n.parentElement) {
      const inside = [...tabs].filter(([id, tab]) => id !== except && n!.contains(tab)).map(([id]) => id);
      if (inside.length > 0) return inside.sort();
    }
    return [];
  };

  it('shows one + per group only while editing', async () => {
    const { el, handle } = await mountReal();
    expect(addButtons(el)).toHaveLength(0);
    handle.setEditing(true);
    expect(addButtons(el)).toHaveLength(2);
    handle.setEditing(false);
    expect(addButtons(el)).toHaveLength(0);
    handle.destroy();
  });

  /** Clicks the `+` of p1's group, which is not the active one: the panel added last (p2) holds the active group. */
  const clickPlusOfP1 = async (el: HTMLElement, tabs: Map<string, HTMLElement>): Promise<void> => {
    const plus = addButtons(el).find((b) => beside(b, tabs).includes('p1'));
    expect(plus).toBeDefined();
    await fireEvent.click(plus!);
  };
  const addSizeProbe = async (handle: RealHandle, onChange: ReturnType<typeof vi.fn<OnChange>>): Promise<void> => {
    handle.addPanel(defaultPanel(declOf('size-probe')));
    await vi.advanceTimersByTimeAsync(100);
    expect(Object.keys(onChange.mock.calls.at(-1)![1]).sort()).toEqual(['p1', 'p2', 'p3']);
  };

  it('the + of a group that is not active makes it active and calls onAdd, but sets no target', async () => {
    const { el, tabs, handle, onChange, onAdd } = await mountReal();
    handle.setEditing(true);
    await clickPlusOfP1(el, tabs);
    expect(onAdd).toHaveBeenCalledTimes(1);

    // Without `targetActiveGroup` the panel opens a new group, as with no `+` at all.
    await addSizeProbe(handle, onChange);
    expect(beside(tabs.get('p1')!, tabs, 'p1')).toEqual(['p2', 'p3']);
    handle.destroy();
  });

  it('after the + of a group that is not active, targetActiveGroup adds the picked panel to that group', async () => {
    const { el, tabs, handle, onChange, onAdd } = await mountReal();
    handle.setEditing(true);
    await clickPlusOfP1(el, tabs);
    expect(onAdd).toHaveBeenCalledTimes(1);

    handle.targetActiveGroup();
    await addSizeProbe(handle, onChange);
    expect(beside(tabs.get('p1')!, tabs, 'p1')).toEqual(['p3']);
    handle.destroy();
  });

  it('cancelAdd forgets the target: the next addPanel opens a new group', async () => {
    const { el, tabs, handle, onChange } = await mountReal();
    handle.setEditing(true);
    await clickPlusOfP1(el, tabs);
    handle.targetActiveGroup();
    handle.cancelAdd();
    await addSizeProbe(handle, onChange);
    expect(beside(tabs.get('p1')!, tabs, 'p1')).toEqual(['p2', 'p3']);
    handle.destroy();
  });

  it('a target is used once: the addPanel after it opens a new group', async () => {
    const { el, tabs, handle, onChange } = await mountReal();
    handle.setEditing(true);
    await clickPlusOfP1(el, tabs);
    handle.targetActiveGroup();
    await addSizeProbe(handle, onChange);
    handle.addPanel(defaultPanel(declOf('probe')));
    await vi.advanceTimersByTimeAsync(100);
    expect(Object.keys(onChange.mock.calls.at(-1)![1]).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    // p1's group holds p3 only: p4 went elsewhere.
    expect(beside(tabs.get('p1')!, tabs, 'p1')).toEqual(['p3']);
    handle.destroy();
  });

  it('with no active group targetActiveGroup sets no target and addPanel still adds', async () => {
    const { handle, onChange } = await mountReal({});
    handle.targetActiveGroup();
    handle.addPanel(defaultPanel(declOf('size-probe')));
    await vi.advanceTimersByTimeAsync(100);
    expect(Object.keys(onChange.mock.calls.at(-1)![1])).toEqual(['p1']);
    handle.destroy();
  });

  it('removePanel reaches onChange, and a group left without panels goes', async () => {
    const { el, handle, onChange } = await mountReal();
    handle.setEditing(true);
    handle.removePanel('p2');
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange.mock.calls.at(-1)![1]).toEqual({ p1: P1 });
    expect(addButtons(el)).toHaveLength(1);
    handle.destroy();
  });
});
