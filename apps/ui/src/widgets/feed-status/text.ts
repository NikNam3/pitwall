// Fixed wording of the feed-status display.
export const connected = 'connected';
export const disconnected = 'disconnected';
export const stale = 'stale';
export const labels = {
  loss: 'loss',
  rate: 'rate',
  latency: 'latency',
  late: 'late',
  decodeErrors: 'decode errors',
  playerCar: 'player car',
  cadence: 'cadence',
  wrongFormat: 'wrong format',
} as const;
export const trackLabel = (trackId: number): string => `track ${trackId}`;
