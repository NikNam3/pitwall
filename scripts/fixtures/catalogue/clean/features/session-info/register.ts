export default { name: 'session-info', calculators: [{ id: 'session.info', kind: 'quick', reads: ['session'], cadence: 'frame' }], topics: [{ topic: 'session.info', from: 'session.info' }] };
