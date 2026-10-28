// The host switch (spec 7.1): everything host-specific goes through a `Host`; this folder alone touches window.* host calls.
import type { Geometry, WindowId } from '@pitwall/contracts';
import { electronHost } from './electron-host.ts';
import { INITIAL_WINDOW, type Host } from './host-type.ts';
import type { PitwallHostApi } from './electron-host.ts';

export type { Host };
export { INITIAL_WINDOW };

/** Where this window is: a browser cannot tell the screen, so it is always 0. */
const browserGeometry = (): Geometry => ({
  screen: 0,
  x: window.screenX,
  y: window.screenY,
  width: window.outerWidth,
  height: window.outerHeight,
});

/** The window a browser tab shows: `?window=<id>`, else the initial window. */
const browserWindowId = (): WindowId => new URLSearchParams(location.search).get('window') ?? INITIAL_WINDOW;

/**
 * A plain browser tab: windows are tabs opened as `/?window=<id>`. A page cannot open, place or focus other tabs unasked, so
 * `ensureWindows` does nothing, `focusWindow` only focuses its own tab and `openPath` copies the path to the clipboard (spec 8.2); geometry is still reported so the workbook keeps the tab's size.
 */
export const browserHost: Host = {
  kind: 'browser',
  windowId: browserWindowId,
  ensureWindows: () => {},
  onGeometryChange(cb) {
    const onResize = (): void => cb(browserGeometry());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  },
  openPath: (path) => {
    // No clipboard (an insecure page, an old browser) or a refused write: the path is just not copied.
    void navigator.clipboard?.writeText(path).catch(() => {});
  },
  // A page can bring only its own tab to the front.
  focusWindow: (id) => {
    if (id === browserWindowId()) window.focus();
  },
};

/** The host this page runs in: Electron when its preload script exposed `window.pitwallHost`, else the browser. */
export const getHost = (): Host => {
  const api = (window as { pitwallHost?: PitwallHostApi }).pitwallHost;
  return api === undefined ? browserHost : electronHost(api);
};
