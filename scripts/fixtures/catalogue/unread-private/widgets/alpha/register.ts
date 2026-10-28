export default {
  decl: { name: 'alpha', title: 'alpha', data: { status: { topic: 'feed.status', kind: 'state', params: undefined, fold: undefined } }, options: {}, sizes: { compact: { minCols: 10, minRows: 2 } } },
  component: () => Promise.reject(new Error('fixture')),
};
