// @vitest-environment jsdom
// Spec 8.2: in a browser the dev inspector cannot open an editor, so `openPath` copies the path instead.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserHost } from '../../src/shell/host/host.ts';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('browserHost.openPath', () => {
  it('copies the path to the clipboard', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    browserHost.openPath('apps/ui/src/widgets/feed-status');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('apps/ui/src/widgets/feed-status');
  });

  it('does not throw when the clipboard is unavailable', () => {
    expect(() => browserHost.openPath('some/path')).not.toThrow();
  });
});
