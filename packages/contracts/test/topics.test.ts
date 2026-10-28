import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, TOPICS } from '../src/index.ts';

describe('TOPICS', () => {
  it('matches spec 8.4 exactly', () => {
    const table = Object.entries(TOPICS).map(([k, d]) => [k, d.name, d.mode, d.maxHz]);
    expect(table).toEqual([
      ['feed.status', 'feed.status', 'state', 2], ['session.info', 'session.info', 'state', 2],
      ['cars.overview', 'cars.overview', 'state', 10], ['car.detail', 'car.detail', 'state', 30],
      ['car.telemetry', 'car.telemetry', 'state', 60], ['laps', 'laps', 'append', Infinity],
      ['stints', 'stints', 'append', Infinity], ['pitStops', 'pitStops', 'append', Infinity],
      ['flagPhases', 'flagPhases', 'append', Infinity], ['events', 'events', 'append', Infinity],
      ['insights', 'insights', 'append', Infinity],
    ]);
  });
  it('exports the contract version', () => { expect(CONTRACT_VERSION).toBe(1); });
});
