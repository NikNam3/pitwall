import { describe, expect, it } from 'vitest';
import type { FeedStatus } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { connectionRole } from './emphasis.ts';

const healthy: FeedStatus = {
  feedId: feedId('test'),
  connected: true,
  stale: false,
  lossPercent: 0,
  latePackets: 0,
  decodeErrors: 0,
  packetsPerSecond: 60,
};

describe('connectionRole', () => {
  it('is undefined for a healthy feed', () => {
    expect(connectionRole(healthy)).toBeUndefined();
  });

  it('is critical when not connected', () => {
    expect(connectionRole({ ...healthy, connected: false })).toBe('critical');
  });

  it('is critical when not connected, even if stale, lossy or the wrong format', () => {
    expect(connectionRole({ ...healthy, connected: false, stale: true, lossPercent: 50, wrongFormat: 3 })).toBe('critical');
  });

  it('is warning when stale', () => {
    expect(connectionRole({ ...healthy, stale: true })).toBe('warning');
  });

  it('is undefined for loss just below 5 %', () => {
    expect(connectionRole({ ...healthy, lossPercent: 4.99 })).toBeUndefined();
  });

  it('is warning for loss of exactly 5 %', () => {
    expect(connectionRole({ ...healthy, lossPercent: 5 })).toBe('warning');
  });

  it('is warning for loss above 5 %', () => {
    expect(connectionRole({ ...healthy, lossPercent: 12 })).toBe('warning');
  });

  it('is warning when packets of the wrong format arrived', () => {
    expect(connectionRole({ ...healthy, wrongFormat: 1 })).toBe('warning');
  });

  it('is undefined when the wrong-format count is 0 or absent', () => {
    expect(connectionRole({ ...healthy, wrongFormat: 0 })).toBeUndefined();
    expect(connectionRole(healthy)).toBeUndefined();
  });

  it('ignores late packets, decode errors, latency and cadence', () => {
    expect(connectionRole({ ...healthy, latePackets: 99, decodeErrors: 99, latencyMs: 900, cadenceMs: 500 })).toBeUndefined();
  });
});
