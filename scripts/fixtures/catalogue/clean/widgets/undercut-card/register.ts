export default {
  decl: { name: 'undercut-card', title: 'undercut-card', data: { rows: { topic: 'undercutCard.rows', kind: 'state', params: undefined, fold: undefined }, laps: { topic: 'laps', kind: 'folded', params: undefined, fold: undefined }, rejoin: { topic: 'rejoin.projection', kind: 'state', params: undefined, fold: undefined } }, options: {}, sizes: { compact: { minCols: 10, minRows: 2 } } },
  component: () => Promise.reject(new Error('fixture')),
};
