// @vitest-environment jsdom
// The dev inspector (spec 8.2). Contract the tests assume of shell/inspector/Inspector.svelte:
//  - props: `{ store: TopicStore; catalogue: Catalogue; widget: string; link: ResolvedLink; host: Pick<Host, 'openPath'> }`;
//    `widget` is the widget name of the clicked panel; `catalogue` is the plain data of catalogue.generated.json;
//  - dev builds only: it reads `import.meta.env.DEV` when rendered and renders nothing otherwise;
//  - the root has `data-testid="inspector"`; each of the widget's topics is a row `data-testid="inspector-topic-<topic>"`
//    showing the live `EntryState` status word (`waiting`, `ok`, `noData`, `errored`); it acquires the topics from the
//    store itself (the panel's params are functions, so it uses `{}` params and `link.feedId`: the test topics take none);
//  - below the topics: the binding (calculator id), the feature, its calculators with their `dev.calcStats` times
//    (acquired as the global topic `dev.calcStats`), and every file path as a button that calls `host.openPath(path)`.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { carId, feedId } from '@pitwall/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import type { ResolvedLink } from '../../src/kit/types.ts';
import Inspector from '../../src/shell/inspector/Inspector.svelte';
import { FakeConnection } from '../connection/fake-connection.ts';

const FEED = feedId('f1');
const link: ResolvedLink = { group: 1, feedId: FEED, primary: carId(5), compare: [], window: { kind: 'live' } };
const catalogue = {
  widgets: [
    {
      name: 'feed-status',
      folder: 'apps/ui/src/widgets/feed-status',
      topics: [
        { topic: 'feed.status', kind: 'state', optional: false },
        { topic: 'session.info', kind: 'state', optional: true },
      ],
      options: [],
      sizes: ['compact'],
    },
  ],
  topics: [
    { name: 'feed.status', owner: 'core', mode: 'state', scope: 'feed', maxHz: 2, file: 'packages/contracts/src/topics/feed.status.ts', binding: { kind: 'calculator', source: 'feed.status', feature: 'feed-status' }, readers: ['feed-status'] },
    { name: 'session.info', owner: 'core', mode: 'state', scope: 'feed', maxHz: 2, file: 'packages/contracts/src/topics/session.info.ts', binding: { kind: 'calculator', source: 'session.info', feature: 'session-info' }, readers: ['feed-status'] },
  ],
  features: [
    { name: 'feed-status', folder: 'apps/bridge/src/features/feed-status', private: true, calculators: [{ id: 'feed.status', reads: ['feed'], cadence: 'frame' }], jobs: [], config: [] },
    { name: 'session-info', folder: 'apps/bridge/src/features/session-info', private: false, calculators: [{ id: 'session.info', reads: ['session'], cadence: 'frame' }], jobs: [], config: [] },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const setup = () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  const host = { openPath: vi.fn() };
  const idOf = (topic: string): string => {
    const found = connection.subscribes().find((s) => s.topic === topic);
    if (found === undefined) throw new Error(`no subscription to ${topic}`);
    return found.id;
  };
  const view = render(Inspector, { store, catalogue, widget: 'feed-status', link, host });
  return { connection, host, idOf, ...view };
};
const row = (topic: string) => screen.getByTestId(`inspector-topic-${topic}`);

describe('Inspector', () => {
  it('lists the panel\'s topics, each waiting before data arrives', () => {
    setup();
    expect(row('feed.status').textContent).toContain('waiting');
    expect(row('session.info').textContent).toContain('waiting');
  });

  it('shows each topic\'s live status', async () => {
    const { connection, idOf } = setup();
    connection.push({ type: 'snapshot', id: idOf('feed.status'), value: { feedId: FEED, connected: true, stale: false } });
    connection.push({ type: 'topicStatus', id: idOf('session.info'), status: 'noData' });
    await vi.waitFor(() => expect(row('feed.status').textContent).toContain('ok'));
    expect(row('session.info').textContent).toContain('noData');
  });

  it('shows the binding and the feature of a topic', () => {
    setup();
    expect(row('feed.status').textContent).toContain('calculator');
    expect(screen.getByTestId('inspector').textContent).toContain('feed-status');
  });

  it('shows the calculators of the feature with the compute times of dev.calcStats', async () => {
    const { connection, idOf } = setup();
    connection.push({
      type: 'snapshot',
      id: idOf('dev.calcStats'),
      value: [{ id: 'feed.status', lastMs: 0.4, meanMs: 0.3, runs: 5, lastSessionTime: 1000 }],
    });
    await vi.waitFor(() => expect(screen.getByTestId('inspector').textContent).toContain('0.4'));
    expect(screen.getByTestId('inspector').textContent).toContain('0.3');
    expect(screen.getByTestId('inspector').textContent).toContain('frame');
  });

  it.each([
    'apps/ui/src/widgets/feed-status',
    'packages/contracts/src/topics/feed.status.ts',
    'apps/bridge/src/features/feed-status',
  ])('clicking the path %s opens it through host.openPath', async (path) => {
    const { host } = setup();
    await fireEvent.click(within(screen.getByTestId('inspector')).getAllByText(path)[0]!);
    expect(host.openPath).toHaveBeenCalledWith(path);
  });

  it('releases its subscriptions when it goes away', () => {
    const { connection, unmount } = setup();
    expect(connection.subscribes().length).toBeGreaterThan(0);
    unmount();
    expect(connection.unsubscribes().length).toBe(connection.subscribes().length);
  });

  it('renders nothing outside dev builds', () => {
    vi.stubEnv('DEV', false);
    setup();
    expect(screen.queryByTestId('inspector')).toBeNull();
  });
});
