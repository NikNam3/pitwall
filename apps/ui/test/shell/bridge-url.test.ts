// bridgeUrl (spec 6.1). `?ws=` wins. Without it the build-time default applies; `bridgeUrl` must not throw when
// Vite's `define` is absent (as under Vitest) and then falls back to 4777.
import { describe, expect, it } from 'vitest';
import { bridgeUrl } from '../../src/shell/bridge-url.ts';

describe('bridgeUrl', () => {
  it('takes the port from ?ws=', () => {
    expect(bridgeUrl('?ws=4999')).toBe('ws://127.0.0.1:4999');
    expect(bridgeUrl('?window=x&ws=1234')).toBe('ws://127.0.0.1:1234');
  });

  it('without ?ws= it does not throw and falls back to port 4777 when no define is set', () => {
    expect(() => bridgeUrl('')).not.toThrow();
    expect(bridgeUrl('')).toBe('ws://127.0.0.1:4777');
    expect(bridgeUrl('?window=strategy')).toBe('ws://127.0.0.1:4777');
  });
});
