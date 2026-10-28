export default { name: 'alpha', calculators: [{ id: 'alpha.rows', kind: 'quick', reads: ['feed'], cadence: 'frame' }], topics: [{ topic: 'alpha.rows', from: 'alpha.rows' }] };
