export default {
  decl: { name: 'alpha', title: 'alpha', data: { rows: { topic: 'alpha.rows', kind: 'state', params: undefined, fold: undefined } }, options: {}, sizes: { compact: { minCols: 10, minRows: 2 } } },
  component: () => Promise.reject(new Error('fixture')),
};
