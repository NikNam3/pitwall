// The code map the gallery's inspector cell shows: `feed-status` as the catalogue describes it, fixed here so the
// baseline does not change whenever another unit adds a file. The real one is `catalogue.generated.json` (spec 8.1).
import type { TopicValue } from '@pitwall/contracts';

export const INSPECTOR_WIDGET = 'feed-status';

export const INSPECTOR_CATALOGUE: TopicValue<'dev.catalogue'> = {
  widgets: [
    {
      name: 'feed-status',
      folder: 'apps/ui/src/widgets/feed-status',
      topics: [
        { topic: 'feed.status', kind: 'state', optional: false },
        { topic: 'session.info', kind: 'state', optional: true },
      ],
      options: ['details'],
      sizes: ['compact', 'full'],
    },
  ],
  topics: [
    {
      name: 'feed.status',
      owner: 'core',
      mode: 'state',
      scope: 'feed',
      maxHz: 2,
      file: 'packages/contracts/src/topics/feed.status.ts',
      binding: { kind: 'calculator', source: 'feed.status', feature: 'feed-status' },
      readers: ['feed-status'],
    },
    {
      name: 'session.info',
      owner: 'core',
      mode: 'state',
      scope: 'feed',
      maxHz: 2,
      file: 'packages/contracts/src/topics/session.info.ts',
      binding: { kind: 'calculator', source: 'session.info', feature: 'session-info' },
      readers: ['feed-status'],
    },
  ],
  features: [
    {
      name: 'feed-status',
      folder: 'apps/bridge/src/features/feed-status',
      private: true,
      calculators: [{ id: 'feed.status', reads: ['feed'], cadence: 'frame' }],
      jobs: [],
      config: [],
    },
    {
      name: 'session-info',
      folder: 'apps/bridge/src/features/session-info',
      private: true,
      calculators: [{ id: 'session.info', reads: ['session'], cadence: 'frame' }],
      jobs: [],
      config: [],
    },
  ],
};
