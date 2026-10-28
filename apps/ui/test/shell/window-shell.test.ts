// @vitest-environment jsdom
// WindowShell (spec 7.1-7.3). dockview is not mounted here: `shell/docking/index.ts` is mocked with vi.mock and the
// tests drive its `onChange` (the `mountDock` seam of the brief). Contract the tests assume of WindowShell.svelte:
//  - props: `{ store: TopicStore; host: Host; widgets?: RegisteredWidget[] }` (`widgets` defaults to the generated WIDGETS);
//  - it holds `ui.workbooks` (no feedId), picks its window by `host.windowId()` and waits for the first snapshot;
//  - it calls `mountDock(el, layout, panels, onChange)` with the window's layout and the NORMALISED panels, and
//    `destroy()`s the old handle before mounting again;
//  - `onChange` and host geometry changes are debounced 250 ms into ONE `{ type: 'uiAction', action: { kind: 'workbook.updateWindow', window } }`
//    carrying the whole window (id, geometry, fontPx, layout, panels);
//  - its root element is the first child of the container and carries `--pw-font-px`;
//  - texts: `kit/text.ts` named export `addWidget` (the button's accessible name).
import type { Geometry, Workbook, WorkbookWindow } from '@pitwall/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { carId, type FeedId, feedId } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import * as text from '../../src/kit/text.ts';
import type { Host } from '../../src/shell/host/host.ts';
import { THEMES } from '../../src/theme/index.ts';
import { FakeConnection } from '../connection/fake-connection.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { linkLog } from './fixtures/link-probe/link-log.ts';

type Handle = { addPanel: ReturnType<typeof vi.fn>; updatePanel: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
type PanelViewLike = { render(content: HTMLElement, tab: HTMLElement, spec: WorkbookWindow['panels'][string], id: string): unknown };
type OnChange = (layout: unknown, panels: WorkbookWindow['panels']) => void;
const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

const FULL = { mode: 'a', count: 3, flag: false };
const GEO: Geometry = { screen: 0, x: 10, y: 20, width: 1920, height: 1080 };
const win = (id: string, layout: unknown, extra: Partial<WorkbookWindow> = {}): WorkbookWindow => ({
  id,
  layout,
  panels: { p1: { widget: 'probe', options: FULL, linkGroup: 1 } },
  ...extra,
});
const book = (name = 'race', windows: WorkbookWindow[] = [win('main', { L: 1 }, { fontPx: 16, geometry: GEO }), win('second', { L: 's' })]): Workbook => ({
  name,
  windows,
});

const handles: Handle[] = [];
const mountCalls = () => mocks.mountDock.mock.calls as Array<[HTMLElement, unknown, WorkbookWindow['panels'], OnChange, PanelViewLike]>;
const lastMount = () => mountCalls().at(-1)!;

const fakeHost = (windowId = 'main') => {
  const geometryListeners = new Set<(g: Geometry) => void>();
  const unsubscribed = vi.fn();
  const host: Host = {
    kind: 'browser',
    windowId: () => windowId,
    ensureWindows: vi.fn(),
    onGeometryChange: (cb: (g: Geometry) => void) => {
      geometryListeners.add(cb);
      return () => {
        geometryListeners.delete(cb);
        unsubscribed();
      };
    },
    openPath: vi.fn(),
    focusWindow: vi.fn(),
  };
  return { host, emitGeometry: (g: Geometry) => geometryListeners.forEach((cb) => cb(g)), unsubscribed };
};

const setup = (windowId = 'main') => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  const h = fakeHost(windowId);
  const latestId = (topic: string): string => {
    const found = connection.subscribes().filter((s) => s.topic === topic).at(-1);
    if (found === undefined) throw new Error(`no subscription to ${topic}`);
    return found.id;
  };
  const names = ['race'];
  const workbooks = (active: Workbook, error?: string) => ({ names, active, ...(error === undefined ? {} : { error }) });
  const snapshot = async (active: Workbook, error?: string) => {
    connection.push({ type: 'snapshot', id: latestId('ui.workbooks'), value: workbooks(active, error) });
    await tick();
  };
  const update = async (active: Workbook, error?: string) => {
    connection.push({ type: 'update', id: latestId('ui.workbooks'), value: workbooks(active, error) });
    await tick();
  };
  const updates = () =>
    connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'workbook.updateWindow' ? [m.action.window] : []));
  const mountShell = (extra: { defaultFeed?: FeedId } = {}) => render(WindowShell, { store, host: h.host, widgets: TEST_WIDGETS, ...extra });
  return { connection, store, ...h, latestId, snapshot, update, updates, mountShell };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  handles.length = 0;
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => {
    const handle: Handle = { addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn() };
    handles.push(handle);
    return handle;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width: 600, height: 400 } }]);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {}, matches: false }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WindowShell: reading the workbook', () => {
  it('subscribes to ui.workbooks without a feed and mounts nothing before the first snapshot', () => {
    const { connection, mountShell } = setup();
    mountShell();
    expect(connection.subscribes().find((s) => s.topic === 'ui.workbooks')).toEqual({ type: 'subscribe', id: expect.any(String), topic: 'ui.workbooks', params: {} });
    expect(mocks.mountDock).not.toHaveBeenCalled();
  });

  it('mounts the dock with this window\'s layout and panels', async () => {
    const { snapshot, mountShell } = setup('second');
    mountShell();
    await snapshot(book());
    expect(mocks.mountDock).toHaveBeenCalledTimes(1);
    const [el, layout, panels] = lastMount();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(layout).toEqual({ L: 's' });
    expect(panels).toEqual({ p1: { widget: 'probe', options: FULL, linkGroup: 1 } });
  });

  it('hands the dock the normalised panels: missing options get defaults, an unknown widget stays unchanged', async () => {
    const { snapshot, mountShell } = setup();
    mountShell();
    await snapshot(
      book('race', [
        win('main', 'L', {
          panels: {
            p1: { widget: 'probe', options: { mode: 'b' }, linkGroup: 1 },
            p2: { widget: 'ghost', options: { a: 1 }, linkGroup: 2 },
          },
        }),
      ]),
    );
    expect(lastMount()[2]).toEqual({
      p1: { widget: 'probe', options: { mode: 'b', count: 3, flag: false }, linkGroup: 1 },
      p2: { widget: 'ghost', options: { a: 1 }, linkGroup: 2 },
    });
  });

  it('destroys the dock when the window goes away', async () => {
    const { snapshot, mountShell, unsubscribed } = setup();
    const { unmount } = mountShell();
    await snapshot(book());
    unmount();
    expect(handles[0]!.destroy).toHaveBeenCalled();
    expect(unsubscribed).toHaveBeenCalled();
  });
});

describe('WindowShell: saving changes (debounced 250 ms)', () => {
  it('a dock change sends exactly one updateWindow after 250 ms, with the whole window', async () => {
    const { snapshot, mountShell, updates } = setup();
    mountShell();
    await snapshot(book());
    const onChange = lastMount()[3];
    const panels = { p1: { widget: 'probe', options: FULL, linkGroup: 3 } };
    onChange({ L: 'moved' }, panels);
    await vi.advanceTimersByTimeAsync(249);
    expect(updates()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates()).toEqual([{ id: 'main', geometry: GEO, fontPx: 16, layout: { L: 'moved' }, panels }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(updates()).toHaveLength(1);
  });

  it('several changes inside the window collapse into one update with the last state', async () => {
    const { snapshot, mountShell, updates } = setup();
    mountShell();
    await snapshot(book());
    const onChange = lastMount()[3];
    onChange({ n: 1 }, {});
    await vi.advanceTimersByTimeAsync(100);
    onChange({ n: 2 }, {});
    await vi.advanceTimersByTimeAsync(100);
    onChange({ n: 3 }, {});
    await vi.advanceTimersByTimeAsync(249);
    expect(updates()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.layout).toEqual({ n: 3 });
  });

  it('an unknown-widget panel stays unchanged in what is saved', async () => {
    const { snapshot, mountShell, updates } = setup();
    mountShell();
    const ghost = { widget: 'ghost', options: { a: 1 }, linkGroup: 2 };
    await snapshot(book('race', [win('main', 'L', { panels: { p9: ghost } })]));
    const [, , panels, onChange] = lastMount();
    onChange('L2', panels);
    await vi.advanceTimersByTimeAsync(250);
    expect(updates()[0]!.panels).toEqual({ p9: ghost });
  });

  it('a geometry change from the host is saved the same way, with the current layout and panels', async () => {
    const { snapshot, mountShell, updates, emitGeometry } = setup();
    mountShell();
    await snapshot(book());
    const moved: Geometry = { screen: 1, x: 0, y: 0, width: 1280, height: 720 };
    emitGeometry(moved);
    await vi.advanceTimersByTimeAsync(249);
    expect(updates()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates()).toEqual([{ id: 'main', geometry: moved, fontPx: 16, layout: { L: 1 }, panels: { p1: { widget: 'probe', options: FULL, linkGroup: 1 } } }]);
  });

  it('a dock change and a geometry change inside the window are one update holding both', async () => {
    const { snapshot, mountShell, updates, emitGeometry } = setup();
    mountShell();
    await snapshot(book());
    const moved: Geometry = { screen: 0, x: 5, y: 5, width: 800, height: 600 };
    lastMount()[3]({ L: 'new' }, {});
    emitGeometry(moved);
    await vi.advanceTimersByTimeAsync(250);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]).toMatchObject({ layout: { L: 'new' }, geometry: moved });
  });
});

describe('WindowShell: an unknown window id', () => {
  it('opens empty with an add widget button; picking a widget adds a panel with default options', async () => {
    const { snapshot, mountShell } = setup('ghost');
    mountShell();
    await snapshot(book());
    expect(lastMount()[2]).toEqual({});
    await fireEvent.click(screen.getByRole('button', { name: text.addWidget }));
    for (const title of ['Probe', 'Stale probe', 'Computed probe']) expect(screen.getByText(title)).toBeTruthy();
    await fireEvent.click(screen.getByText('Probe'));
    expect(handles[0]!.addPanel).toHaveBeenCalledWith({ widget: 'probe', options: FULL, linkGroup: expect.any(Number) });
  });

  it('saves the new window under the host\'s id once the dock changes', async () => {
    const { snapshot, mountShell, updates } = setup('ghost');
    mountShell();
    await snapshot(book());
    const panels = { p1: { widget: 'probe', options: FULL, linkGroup: 1 } };
    lastMount()[3]({ L: 'fresh' }, panels);
    await vi.advanceTimersByTimeAsync(250);
    expect(updates()).toEqual([{ id: 'ghost', layout: { L: 'fresh' }, panels }]);
  });
});

describe('WindowShell: bridge errors keep the last good workbook', () => {
  it('shows ui.workbooks.error as one line and does not remount; the line goes when the error does', async () => {
    const { snapshot, update, mountShell } = setup();
    mountShell();
    await snapshot(book());
    await update(book(), 'Unexpected token } in JSON at position 41');
    expect(screen.getAllByText(/Unexpected token } in JSON at position 41/)).toHaveLength(1);
    expect(mocks.mountDock).toHaveBeenCalledTimes(1);
    expect(handles[0]!.destroy).not.toHaveBeenCalled();
    await update(book());
    expect(screen.queryByText(/Unexpected token/)).toBeNull();
  });
});

describe('WindowShell: font size', () => {
  const rootOf = (c: HTMLElement) => c.firstElementChild as HTMLElement;

  it('sets --pw-font-px from the window\'s fontPx', async () => {
    const { snapshot, mountShell } = setup();
    const { container } = mountShell();
    await snapshot(book());
    expect(rootOf(container).style.getPropertyValue('--pw-font-px')).toBe('16px');
  });

  it('falls back to the theme default when the window has none', async () => {
    const { snapshot, mountShell } = setup('second');
    const { container } = mountShell();
    await snapshot(book());
    expect(rootOf(container).style.getPropertyValue('--pw-font-px')).toBe(`${THEMES[0]!.fontPx}px`);
  });

  it('follows a changed fontPx without remounting the dock', async () => {
    const { snapshot, update, mountShell } = setup();
    const { container } = mountShell();
    await snapshot(book());
    await update(book('race', [win('main', { L: 1 }, { fontPx: 20 })]));
    expect(rootOf(container).style.getPropertyValue('--pw-font-px')).toBe('20px');
    expect(mocks.mountDock).toHaveBeenCalledTimes(1);
    expect(handles[0]!.destroy).not.toHaveBeenCalled();
  });
});

describe('WindowShell: ensureWindows (first window of the workbook only)', () => {
  it('the first window announces every window of the workbook, and again when the active workbook changes', async () => {
    const { snapshot, update, mountShell, host } = setup('main');
    mountShell();
    await snapshot(book('race'));
    expect(host.ensureWindows).toHaveBeenCalledTimes(1);
    expect(host.ensureWindows).toHaveBeenLastCalledWith([
      { id: 'main', geometry: GEO },
      { id: 'second', geometry: undefined },
    ]);
    await update(book('quali', [win('main', 'Q', { geometry: GEO }), win('side', 'S')]));
    expect(host.ensureWindows).toHaveBeenCalledTimes(2);
    expect(host.ensureWindows).toHaveBeenLastCalledWith([
      { id: 'main', geometry: GEO },
      { id: 'side', geometry: undefined },
    ]);
  });

  it('an update of the same workbook does not call it again', async () => {
    const { snapshot, update, mountShell, host } = setup('main');
    mountShell();
    await snapshot(book('race'));
    await update(book('race', [win('main', { L: 'edited' }), win('second', 's')]));
    expect(host.ensureWindows).toHaveBeenCalledTimes(1);
  });

  it('also fires when the set of window ids of the same workbook changes (added or removed)', async () => {
    const { snapshot, update, mountShell, host } = setup('main');
    mountShell();
    await snapshot(book('race'));
    await update(book('race', [win('main', { L: 1 }, { geometry: GEO }), win('second', 's'), win('third', 't')]));
    expect(host.ensureWindows).toHaveBeenCalledTimes(2);
    expect(host.ensureWindows).toHaveBeenLastCalledWith([
      { id: 'main', geometry: GEO },
      { id: 'second', geometry: undefined },
      { id: 'third', geometry: undefined },
    ]);
    await update(book('race', [win('main', { L: 1 }, { geometry: GEO })]));
    expect(host.ensureWindows).toHaveBeenCalledTimes(3);
    expect(host.ensureWindows).toHaveBeenLastCalledWith([{ id: 'main', geometry: GEO }]);
  });

  it('another window of the workbook never calls it', async () => {
    const { snapshot, update, mountShell, host } = setup('second');
    mountShell();
    await snapshot(book('race'));
    await update(book('quali', [win('main', 'Q'), win('second', 'S')]));
    expect(host.ensureWindows).not.toHaveBeenCalled();
  });
});

describe('WindowShell: the initial window main always announces (final fix wave A-I4)', () => {
  it('main announces the windows of a workbook that does not start with main (startup)', async () => {
    const { snapshot, mountShell, host } = setup('main');
    mountShell();
    await snapshot(book('race', [win('strategy', 'S'), win('car', 'C')]));
    expect(host.ensureWindows).toHaveBeenCalledTimes(1);
    expect(host.ensureWindows).toHaveBeenLastCalledWith([
      { id: 'strategy', geometry: undefined },
      { id: 'car', geometry: undefined },
    ]);
  });

  it('main announces again when the active workbook switches to one with other window ids (Ctrl+N)', async () => {
    const { snapshot, update, mountShell, host } = setup('main');
    mountShell();
    await snapshot(book('race', [win('main', 'M'), win('side', 'S')]));
    await update(book('quali', [win('strategy', 'S'), win('car', 'C')]));
    expect(host.ensureWindows).toHaveBeenCalledTimes(2);
    expect(host.ensureWindows).toHaveBeenLastCalledWith([
      { id: 'strategy', geometry: undefined },
      { id: 'car', geometry: undefined },
    ]);
  });

  it('after a switch to a workbook that does not contain main, main asks the host to ensure the new windows (with their geometry)', async () => {
    const { snapshot, update, mountShell, host } = setup('main');
    mountShell();
    await snapshot(book('race', [win('main', 'M', { geometry: GEO }), win('side', 'S')]));
    await update(book('quali', [win('strategy', 'S', { geometry: GEO }), win('car', 'C')]));
    expect(host.ensureWindows).toHaveBeenLastCalledWith([
      { id: 'strategy', geometry: GEO },
      { id: 'car', geometry: undefined },
    ]);
  });

  it('after main has closed, a surviving window that is in neither of the next workbooks announces the second switch (reviewer scenario)', async () => {
    const { snapshot, update, mountShell, host } = setup('car');
    mountShell();
    await snapshot(book('one', [win('main', 'M'), win('car', 'C')]));
    await update(book('two', [win('car', 'C'), win('data', 'D')])); // main closes; car is now first
    await update(book('three', [win('x', 'X'), win('y', 'Y')])); // car is not in it, not first, not main
    expect(host.ensureWindows).toHaveBeenLastCalledWith([
      { id: 'x', geometry: undefined },
      { id: 'y', geometry: undefined },
    ]);
  });

  it('a window that is neither main nor first in the workbook still never announces', async () => {
    const { snapshot, update, mountShell, host } = setup('side');
    mountShell();
    await snapshot(book('race', [win('main', 'M'), win('side', 'S')]));
    await update(book('quali', [win('strategy', 'S'), win('side', 'C')]));
    expect(host.ensureWindows).not.toHaveBeenCalled();
  });
});

describe('WindowShell: bridge restart (Review Focus 4)', () => {
  it('after a reconnect the dock is mounted again from the bridge\'s workbook, and the old dock is destroyed', async () => {
    const { connection, snapshot, mountShell } = setup();
    mountShell();
    await snapshot(book());
    expect(lastMount()[1]).toEqual({ L: 1 });

    connection.close();
    connection.reopen();
    await snapshot(book('race', [win('main', { L: 'from-bridge' }, { fontPx: 16 })]));

    expect(handles[0]!.destroy).toHaveBeenCalled();
    expect(mountCalls().length).toBeGreaterThanOrEqual(2);
    expect(lastMount()[1]).toEqual({ L: 'from-bridge' });
  });

  it('a local change still waiting in the debounce is dropped, not sent after the reconnect', async () => {
    const { connection, snapshot, mountShell, updates } = setup();
    mountShell();
    await snapshot(book());
    lastMount()[3]({ L: 'stale-local' }, {});
    await vi.advanceTimersByTimeAsync(100);

    connection.close();
    connection.reopen();
    await snapshot(book('race', [win('main', { L: 'from-bridge' })]));
    await vi.advanceTimersByTimeAsync(1000);

    expect(updates().filter((w) => JSON.stringify(w.layout).includes('stale-local'))).toEqual([]);
  });

  it('a change made while the connection is closed is sent once after the reconnect, even if the bridge copy is unchanged', async () => {
    const { connection, snapshot, mountShell, updates } = setup();
    mountShell();
    await snapshot(book());
    connection.close();
    lastMount()[3]({ L: 'offline' }, { p1: { widget: 'probe', options: FULL, linkGroup: 5 } });
    await vi.advanceTimersByTimeAsync(1000);
    const before = updates().length; // FakeConnection records sends made while closed; the real one drops them
    connection.reopen();
    await snapshot(book()); // identical to the snapshot from before the disconnect
    await vi.advanceTimersByTimeAsync(1000);
    const after = updates().slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: 'main', layout: { L: 'offline' }, panels: { p1: { linkGroup: 5 } } });
  });

  it('subscribes to ui.workbooks again after the reconnect, once', async () => {
    const { connection, snapshot, mountShell } = setup();
    mountShell();
    await snapshot(book());
    connection.close();
    connection.reopen();
    expect(connection.subscribes().filter((s) => s.topic === 'ui.workbooks')).toHaveLength(2);
  });
});

describe('WindowShell: the link a widget gets (supervisor ruling)', () => {
  const FEED = feedId('f1');
  const session = (updatedAt: number, playerCar: number) => ({ feedId: FEED, playerCar: carId(playerCar), session: { updatedAt } });

  // The panel is mounted the way the dock does it: through the `view` the shell hands to `mountDock`.
  const mountPanel = async (ctx: ReturnType<typeof setup>) => {
    ctx.mountShell({ defaultFeed: FEED });
    const linkProbe = { widget: 'link-probe', options: {}, linkGroup: 1 };
    await ctx.snapshot(book('race', [win('main', { L: 1 }, { panels: { lp: linkProbe } })]));
    const view = lastMount()[4];
    view.render(document.createElement('div'), document.createElement('div'), linkProbe, 'lp');
    ctx.connection.push({ type: 'snapshot', id: ctx.latestId('session.info'), value: session(1000, 5) });
    await tick(); // the panel subscribes once its link exists
    ctx.connection.push({ type: 'snapshot', id: ctx.latestId('feed.status'), value: { feedId: FEED, connected: true, stale: false } });
    await vi.waitFor(() => expect(linkLog.length).toBeGreaterThan(0)); // the widget component loads lazily
  };

  it('stays the same object across session.info updates while the resolved values do not change', async () => {
    linkLog.length = 0;
    const ctx = setup();
    await mountPanel(ctx);
    expect(linkLog.length).toBeGreaterThan(0);
    for (const t of [2000, 3000, 4000]) {
      ctx.connection.push({ type: 'update', id: ctx.latestId('session.info'), value: session(t, 5) });
      await tick();
    }
    expect(new Set(linkLog).size).toBe(1);
    expect(linkLog[0]).toMatchObject({ primary: 5, feedId: FEED });
  });

  it('is a new object when a resolved value changes (the player\'s car)', async () => {
    linkLog.length = 0;
    const ctx = setup();
    await mountPanel(ctx);
    ctx.connection.push({ type: 'update', id: ctx.latestId('session.info'), value: session(2000, 9) });
    await tick();
    expect(new Set(linkLog).size).toBe(2);
    expect(linkLog.at(-1)).toMatchObject({ primary: 9 });
  });
});
