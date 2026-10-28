export default {
  decl: { name: 'feed-status', title: 'feed-status', data: { status: { topic: 'feed.status', kind: 'state', params: undefined, fold: undefined }, session: { topic: 'session.info', kind: 'state', params: undefined, fold: undefined, optional: true } }, options: {}, sizes: { compact: { minCols: 10, minRows: 2 } } },
  component: () => Promise.reject(new Error('fixture')),
};
