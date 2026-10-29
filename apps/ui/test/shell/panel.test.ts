// @vitest-environment jsdom
// The panel frame (spec 4.3, 7.4). Contract the tests assume of Panel.svelte:
//  - props: `{ store: TopicStore; spec: PanelSpec; widget: RegisteredWidget | undefined; link: ResolvedLink }`;
//    `widget` is undefined when the spec names an unknown widget;
//  - the header band is the `<header>` element: title (the widget's title), states and the gear `<svg>`;
//  - the panel holds the declared topics (params from `link` and `spec.options`, `feedId: link.feedId`) and, per feed,
//    a `feed.status` acquisition with an explicit feedId; it passes `providePanelStale({ cadenceMs })` to the widget (car
//    fields are judged by the car's own newest update, not a session clock: bug B2);
//  - the body is measured with a ResizeObserver (stubbed below to 600 x 400 px);
//  - texts come from `kit/text.ts` as named exports: `noDataYet`, `errored` (string), `stale(seconds)`, `unknownWidget(name)`.
import type { PanelSpec } from '@pitwall/contracts';
import { cleanup, render, screen } from '@testing-library/svelte';
import { carId, feedId } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import * as text from '../../src/kit/text.ts';
import type { ResolvedLink } from '../../src/kit/types.ts';
import Panel from '../../src/shell/panel/Panel.svelte';
import { FakeConnection } from '../connection/fake-connection.ts';
import carCellProbe from './fixtures/car-cell/register.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';

const FEED = feedId('f1');
const link = (primary = 5): ResolvedLink => ({ group: 1, feedId: FEED, primary: carId(primary), compare: [], window: { kind: 'live' } });
const widgetNamed = (name: string) => TEST_WIDGETS.find((w) => w.decl.name === name);
const spec = (widget: string, options: Record<string, unknown> = {}): PanelSpec => ({ widget, options, linkGroup: 1 });

beforeEach(() => {
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
  vi.unstubAllGlobals();
});

const setup = () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  const idOf = (topic: string, nth = 0): string => {
    const found = connection.subscribes().filter((s) => s.topic === topic)[nth];
    if (found === undefined) throw new Error(`no subscription to ${topic}`);
    return found.id;
  };
  const snapshot = (topic: string, value: unknown) => connection.push({ type: 'snapshot', id: idOf(topic), value });
  return { connection, store, idOf, snapshot };
};
const status = { feedId: FEED, connected: true, stale: false };
const header = (c: HTMLElement) => c.querySelector('header') as HTMLElement;

describe('Panel: header states', () => {
  it('waiting: header says no data yet and no component is rendered', () => {
    const { store } = setup();
    const { container } = render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    expect(header(container).textContent).toContain(text.noDataYet);
    expect(screen.queryByTestId('probe')).toBeNull();
  });

  it('the panel names its widget in data-widget, so a test can find the panel of one widget', () => {
    const { store } = setup();
    const { container } = render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    expect(container.querySelector('.panel')?.getAttribute('data-widget')).toBe('probe');
  });

  it('the header shows the widget title and a gear icon', () => {
    const { store } = setup();
    const { container } = render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    expect(header(container).textContent).toContain('Probe');
    expect(header(container).querySelector('svg')).not.toBeNull();
  });

  it('noData from the bridge: still no data yet, no component', () => {
    const { store, connection, idOf } = setup();
    const { container } = render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    connection.push({ type: 'topicStatus', id: idOf('feed.status'), status: 'noData' });
    expect(header(container).textContent).toContain(text.noDataYet);
    expect(screen.queryByTestId('probe')).toBeNull();
  });

  it('errored: one sentence instead of the component, never old values', async () => {
    const { store, connection, idOf, snapshot } = setup();
    const { container } = render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    snapshot('feed.status', status);
    await screen.findByTestId('probe');
    connection.push({ type: 'topicStatus', id: idOf('feed.status'), status: 'errored' });
    await vi.waitFor(() => expect(screen.queryByTestId('probe')).toBeNull());
    expect(header(container).textContent).toContain(text.errored);
    expect(header(container).textContent).not.toContain(text.noDataYet);
  });

  it('stale context of 4 s: header shows stale 4 s and the values stay', async () => {
    const { store, snapshot } = setup();
    const { container } = render(Panel, { store, spec: spec('stale-probe'), widget: widgetNamed('stale-probe'), link: link() });
    snapshot('feed.status', status);
    await screen.findByTestId('stale-probe');
    await vi.waitFor(() => expect(header(container).textContent).toContain(text.stale(4)));
  });

  it('a stale feed dims the widget: its view is marked `dim`, so inline highlight roles give way to the faint body colour', async () => {
    const { store, snapshot } = setup();
    render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    snapshot('feed.status', status);
    const probe = await screen.findByTestId('probe');
    expect(probe.closest('.view')?.classList.contains('dim')).toBe(false);
    snapshot('feed.status', { ...status, stale: true });
    await vi.waitFor(() => expect(probe.closest('.view')?.classList.contains('dim')).toBe(true));
  });

  it('a Computed value shows L<lap> in the header', async () => {
    const { store, snapshot } = setup();
    const { container } = render(Panel, { store, spec: spec('computed-probe'), widget: widgetNamed('computed-probe'), link: link() });
    snapshot('car.detail', { computedFor: { lap: 23, frameId: 7 }, value: { any: 'thing' } });
    await screen.findByTestId('computed-probe');
    expect(header(container).textContent).toContain('L23');
  });
});

// Bug B2: cells of car.detail (30 Hz) were judged against the session clock from session.info (2 Hz). The two topics are
// throttled apart, so a session.info newer than the car snapshot on screen made fresh fields stale for one frame ("stale 0 s"),
// often at replay speed 8 (264 ms of session time between two car.detail updates against a 54 ms telemetry limit).
describe('Panel: car fields are judged by the car snapshot\'s own newest update', () => {
  const car = (updatedAt: Record<string, number>) => ({ updatedAt });
  const cell = (testId: string) => screen.getByTestId(testId).querySelector('.value') as HTMLElement;

  it('a session.info newer than the car snapshot leaves fresh fields fresh', async () => {
    const { store, snapshot } = setup();
    // The window and the top bar hold session.info, so the store's session clock runs ahead of the car snapshot.
    store.acquire({ topic: 'session.info', params: {}, feedId: FEED });
    const { container } = render(Panel, { store, spec: spec('car-cell-probe'), widget: carCellProbe, link: link() });
    snapshot('feed.status', { ...status, cadenceMs: 18 });
    snapshot('car.detail', car({ telemetry: 9_700, lapData: 9_700, damage: 9_650 }));
    await screen.findByTestId('car-cell-probe');
    snapshot('session.info', { session: { updatedAt: 10_000 } });
    await tick();
    expect(store.now(FEED)).toBe(10_000);
    expect(cell('brake').classList.contains('stale')).toBe(false);
    expect(cell('wear').classList.contains('stale')).toBe(false);
    expect(header(container).textContent).not.toContain(text.stale());
  });

  it('a source behind the car\'s newest update is stale, with its age in the header', async () => {
    const { store, snapshot } = setup();
    const { container } = render(Panel, { store, spec: spec('car-cell-probe'), widget: carCellProbe, link: link() });
    snapshot('feed.status', { ...status, cadenceMs: 18 });
    snapshot('car.detail', car({ telemetry: 10_000, lapData: 10_000, damage: 8_000 }));
    await screen.findByTestId('car-cell-probe');
    await vi.waitFor(() => expect(cell('wear').classList.contains('stale')).toBe(true));
    expect(cell('brake').classList.contains('stale')).toBe(false);
    expect(header(container).textContent).toContain(text.stale(2));
  });
});

describe('Panel: data and props', () => {
  it('all required topics ok: the component gets typed data, options, size and link', async () => {
    const { store, snapshot } = setup();
    render(Panel, {
      store,
      spec: spec('probe', { mode: 'b', count: 7, flag: true }),
      widget: widgetNamed('probe'),
      link: link(5),
    });
    snapshot('feed.status', status);
    expect((await screen.findByTestId('status-feed')).textContent).toBe(FEED);
    expect(JSON.parse(screen.getByTestId('options').textContent!)).toEqual({ mode: 'b', count: 7, flag: true });
    expect(screen.getByTestId('size-mode').textContent).toBe('compact');
    expect(screen.getByTestId('link-primary').textContent).toBe('5');
  });

  it('an optional topic without data: the component renders with undefined', async () => {
    const { store, snapshot } = setup();
    render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    snapshot('feed.status', status);
    expect((await screen.findByTestId('detail')).textContent).toBe('undefined');
  });

  it('the optional topic arriving later reaches the component', async () => {
    const { store, snapshot } = setup();
    render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    snapshot('feed.status', status);
    await screen.findByTestId('probe');
    snapshot('car.detail', { some: 'car state' });
    await vi.waitFor(() => expect(screen.getByTestId('detail').textContent).toBe('defined'));
  });

  it('a required topic of its own is still absent: nothing renders even if an optional one is ok', async () => {
    const { store, snapshot } = setup();
    const { container } = render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    snapshot('car.detail', { some: 'car state' });
    await Promise.resolve();
    expect(screen.queryByTestId('probe')).toBeNull();
    expect(header(container).textContent).toContain(text.noDataYet);
  });

  it('subscribes with feedId and params worked out from the link', () => {
    const { store, connection } = setup();
    render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link(5) });
    const subs = connection.subscribes();
    expect(subs.find((s) => s.topic === 'feed.status')).toMatchObject({ params: {}, feedId: FEED });
    expect(subs.find((s) => s.topic === 'car.detail')).toMatchObject({ params: { carId: 5 }, feedId: FEED });
  });

  it('resubscribes when the link changes, and releases the old subscription', async () => {
    const { store, connection } = setup();
    const { rerender } = render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link(5) });
    const oldId = connection.subscribes().find((s) => s.topic === 'car.detail')!.id;
    await rerender({ store, spec: spec('probe'), widget: widgetNamed('probe'), link: link(9) });
    const details = connection.subscribes().filter((s) => s.topic === 'car.detail');
    expect(details.map((s) => s.params)).toEqual([{ carId: 5 }, { carId: 9 }]);
    expect(connection.unsubscribes().map((u) => u.id)).toContain(oldId);
  });

  it('unmounting releases every subscription it held', () => {
    const { store, connection } = setup();
    const { unmount } = render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    const ids = connection.subscribes().map((s) => s.id);
    unmount();
    expect(connection.unsubscribes().map((u) => u.id).sort()).toEqual([...ids].sort());
  });
});

describe('Panel: unknown widget', () => {
  it('renders the sentence and subscribes to nothing for it', () => {
    const { store, connection } = setup();
    const { container } = render(Panel, { store, spec: spec('x', { a: 1 }), widget: undefined, link: link() });
    expect(container.textContent).toContain(text.unknownWidget('x'));
    expect(connection.subscribes()).toEqual([]);
  });
});

describe('Panel: the feed cadence for staleness', () => {
  it('passes feed.status cadenceMs to the widget through the panel context, and holds no session.info for it (bug B2)', async () => {
    const { store, connection, snapshot } = setup();
    render(Panel, { store, spec: spec('probe'), widget: widgetNamed('probe'), link: link() });
    snapshot('feed.status', status);
    await screen.findByTestId('probe');
    expect(screen.getByTestId('cadence').textContent).toBe('none');
    snapshot('feed.status', { ...status, cadenceMs: 18 });
    await vi.waitFor(() => expect(screen.getByTestId('cadence').textContent).toBe('18'));
    expect(connection.subscribes().filter((s) => s.topic === 'session.info')).toEqual([]);
  });
});
