export default { name: 'rejoin', calculators: [{ id: 'wrong.rows', kind: 'quick', reads: ['feed'], cadence: 'frame' }], topics: [{ topic: 'wrong.rows', from: 'wrong.rows' }] };
