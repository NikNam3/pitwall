export default {
  decl: { name: 'feed-status', title: 'feed-status', data: { status: { topic: 'feed.status', kind: 'folded', params: undefined, fold: undefined } }, options: {}, sizes: { compact: { minCols: 10, minRows: 2 } } },
  component: () => Promise.reject(new Error('fixture')),
};
