// Shared by the Task 16 shell tests that drive the whole WindowShell with a mocked dock (see link-panel.test.ts for the
// mocking pattern; `vi.mock` must stay in each test file because it is hoisted per file).
import type { Geometry, LinkGroup, Workbook } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { tick } from 'svelte';
import { vi } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import type { Host } from '../../src/shell/host/host.ts';
import { FakeConnection } from '../connection/fake-connection.ts';

export const FEED = feedId('f1');
export const OPTIONS = { mode: 'a', count: 3, flag: false };
export const GEO: Geometry = { screen: 0, x: 0, y: 0, width: 1920, height: 1080 };
export const workbook = (fontPx?: number): Workbook => ({
  name: 'race',
  windows: [{ id: 'main', geometry: GEO, ...(fontPx === undefined ? {} : { fontPx }), layout: {}, panels: { p1: { widget: 'probe', options: OPTIONS, linkGroup: 1 } } }],
});
export const group1 = (extra: Partial<LinkGroup> = {}): LinkGroup => ({ id: 1, primary: 'player', compare: [], window: { kind: 'live' }, ...extra });

/** Stubs the browser APIs the panels need. Call from beforeEach. */
export const stubBrowser = (): void => {
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
};

export const makeStore = () => {
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
  const updates = () => connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'workbook.updateWindow' ? [m.action.window] : []));
  const linkSets = () => connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'linkGroup.set' ? [m.action.group] : []));
  return { connection, store, host, latestId, push, updates, linkSets };
};

export const press = (key: string, mods: { ctrl?: boolean } = {}, target: EventTarget = window): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: mods.ctrl === true, bubbles: true, cancelable: true }));
};
