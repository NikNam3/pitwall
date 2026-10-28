export default {
  decl: { name: 'laps-view', title: 'laps-view', data: { laps: { topic: 'laps', kind: 'state', params: undefined, fold: undefined } }, options: {}, sizes: { compact: { minCols: 10, minRows: 2 } } },
  component: () => Promise.reject(new Error('fixture')),
};
