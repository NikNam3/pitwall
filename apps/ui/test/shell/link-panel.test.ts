// @vitest-environment jsdom
// Link groups in the window (spec 4.5, 7.4, 7.5, Review Focus 5). dockview is mocked as in window-shell.test.ts.
// Contract assumed of the shell (WindowShell.svelte + Panel.svelte + GroupPicker.svelte):
//  - the shell holds `ui.linkGroups` (global topic, no feedId) and the `session.info` of `defaultFeed`, resolves every panel's
//    group with `resolveLink`, and passes the result to Panel as `link` (undefined until both are there);
//  - the panel header (the dock's `tab` element) holds the link marker: a <button> whose text starts with the group id;
//    clicking it opens the GroupPicker, which holds `cars.overview` (feedId of the group) and lists each car as a <button>
//    whose accessible name contains `identity.name`; choosing one sends
//    `{ type: 'uiAction', action: { kind: 'linkGroup.set', group } }` with the whole group and `primary` = that car's id;
//  - nothing happens locally on that choice: the panel follows the next `ui.linkGroups` update from the bridge.
import type { Geometry, LinkGroup, Workbook } from '@pitwall/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { carId, feedId } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import type { Host } from '../../src/shell/host/host.ts';
import { FakeConnection } from '../connection/fake-connection.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';

type PanelViewLike = { render(content: HTMLElement, tab: HTMLElement, spec: { widget: string; options: Record<string, unknown>; linkGroup: number }, id: string): unknown };
type MountCall = [HTMLElement, unknown, unknown, unknown, PanelViewLike];
const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

const FEED = feedId('f1');
const OPTIONS = { mode: 'a', count: 3, flag: false };
const GEO: Geometry = { screen: 0, x: 0, y: 0, width: 1920, height: 1080 };
const workbook: Workbook = {
  name: 'race',
  windows: [{ id: 'main', geometry: GEO, layout: {}, panels: { p1: { widget: 'probe', options: OPTIONS, linkGroup: 1 } } }],
};
const group1 = (extra: Partial<LinkGroup> = {}): LinkGroup => ({ id: 1, primary: 'player', compare: [], window: { kind: 'live' }, ...extra });
const session = (updatedAt: number, playerCar: number) => ({ feedId: FEED, playerCar: carId(playerCar), session: { updatedAt } });
const cars = [
  { id: carId(5), identity: { name: 'Russell' } },
  { id: carId(44), identity: { name: 'Hamilton' } },
];

beforeEach(() => {
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn() }));
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
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const setup = async () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  const host: Host = { kind: 'browser', windowId: () => 'main', ensureWindows: vi.fn(), onGeometryChange: () => () => {}, openPath: vi.fn() };
  const latestId = (topic: string): string => {
    const found = connection.subscribes().filter((s) => s.topic === topic).at(-1);
    if (found === undefined) throw new Error(`no subscription to ${topic}`);
    return found.id;
  };
  const push = async (topic: string, value: unknown, type: 'snapshot' | 'update' = 'snapshot') => {
    connection.push({ type, id: latestId(topic), value });
    await tick();
  };
  render(WindowShell, { store, host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await push('ui.workbooks', { names: ['race'], active: workbook });
  await push('ui.linkGroups', [group1()]);
  // The panel is mounted the way the dock does it; the tab is attached so the header can be queried.
  const view = (mocks.mountDock.mock.calls.at(-1) as unknown as MountCall)[4];
  const tab = document.body.appendChild(document.createElement('div'));
  view.render(document.body.appendChild(document.createElement('div')), tab, { widget: 'probe', options: OPTIONS, linkGroup: 1 }, 'p1');
  await push('session.info', session(1000, 5));
  const carDetails = () => connection.subscribes().filter((s) => s.topic === 'car.detail');
  const linkSets = () => connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'linkGroup.set' ? [m.action.group] : []));
  return { connection, push, tab, carDetails, linkSets, latestId };
};

describe('panels follow their link group', () => {
  it('"player" subscribes car.detail with the player\'s car; the group marker shows the group number', async () => {
    const { carDetails, tab } = await setup();
    expect(carDetails().map((s) => s.params)).toEqual([{ carId: 5 }]);
    expect(carDetails()[0]).toMatchObject({ feedId: FEED });
    // The title comes first, then the marker (approved Task 0 mockup, spec 7.4); the marker is found by its accessible name.
    const marker = within(tab).getByRole('button', { name: `${text.linkMarker} 1` });
    expect(marker.textContent).toMatch(/^\s*1/);
    const title = within(tab).getByText('Probe');
    expect(title.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('changing the group\'s primary through the picker resubscribes car.detail with the new carId', async () => {
    const { connection, push, tab, carDetails, linkSets } = await setup();
    const oldId = carDetails()[0]!.id;
    await fireEvent.click(within(tab).getByRole('button', { name: `${text.linkMarker} 1` })); // the link marker opens the picker
    await push('cars.overview', cars);
    await fireEvent.click(screen.getByRole('button', { name: /Hamilton/ }));
    expect(linkSets()).toHaveLength(1);
    expect(linkSets()[0]).toMatchObject({ id: 1, primary: carId(44) });
    // The panel follows the bridge, which answers with the new group.
    await push('ui.linkGroups', [group1({ primary: carId(44) })], 'update');
    await vi.waitFor(() => expect(carDetails().map((s) => s.params)).toEqual([{ carId: 5 }, { carId: 44 }]));
    expect(connection.unsubscribes().map((u) => u.id)).toContain(oldId);
  });

  it('"player" resolves to the new car id when the player changes between sessions, and the panel resubscribes (Review Focus 5)', async () => {
    const { connection, push, carDetails } = await setup();
    const oldId = carDetails()[0]!.id;
    await push('session.info', session(2000, 9), 'update');
    await vi.waitFor(() => expect(carDetails().map((s) => s.params)).toEqual([{ carId: 5 }, { carId: 9 }]));
    expect(connection.unsubscribes().map((u) => u.id)).toContain(oldId);
  });
});

describe('widgets cannot change the link group (spec 4.5, user decision)', () => {
  it('a click inside the widget body sends no linkGroup.set', async () => {
    const { connection, push, linkSets } = await setup();
    await push('feed.status', { feedId: FEED, connected: true, stale: false });
    const probe = await screen.findByTestId('probe');
    await fireEvent.click(probe);
    await fireEvent.click(screen.getByTestId('link-primary'));
    await fireEvent.dblClick(probe);
    await tick();
    expect(linkSets()).toEqual([]);
    expect(connection.sent.filter((m) => m.type === 'uiAction' && m.action.kind === 'linkGroup.set')).toEqual([]);
  });
});
