export default { name: 'feed-status', calculators: [{ id: 'feed.status', kind: 'quick', reads: ['feed'], cadence: 'frame' }], topics: [{ topic: 'feed.status', from: 'feed.status' }] };
