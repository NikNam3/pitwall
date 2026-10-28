// @vitest-environment jsdom
// The browser host (spec 7.1): window id from `?window=`, geometry from the browser window.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserHost, getHost } from '../../src/shell/host/host.ts';

afterEach(() => vi.unstubAllGlobals());

describe('browserHost', () => {
  it('is the browser kind', () => {
    expect(browserHost.kind).toBe('browser');
  });

  it('takes the window id from ?window=', () => {
    vi.stubGlobal('location', { ...window.location, search: '?window=strategy' });
    expect(browserHost.windowId()).toBe('strategy');
  });

  it('defaults the window id to main', () => {
    vi.stubGlobal('location', { ...window.location, search: '' });
    expect(browserHost.windowId()).toBe('main');
    vi.stubGlobal('location', { ...window.location, search: '?ws=4777' });
    expect(browserHost.windowId()).toBe('main');
  });

  it('getHost returns the browser host for now', () => {
    expect(getHost()).toBe(browserHost);
  });

  it('reports geometry on resize until unsubscribed', () => {
    const cb = vi.fn();
    const off = browserHost.onGeometryChange(cb);
    window.dispatchEvent(new Event('resize'));
    expect(cb).toHaveBeenCalledTimes(1);
    const g = cb.mock.calls[0]![0] as Record<string, unknown>;
    for (const key of ['screen', 'x', 'y', 'width', 'height']) expect(typeof g[key]).toBe('number');
    off();
    window.dispatchEvent(new Event('resize'));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
