// The host switch (spec 7.1): everything host-specific goes through a `Host`; this folder alone touches window.* host calls.
import type { Geometry, WindowId } from '@pitwall/contracts';
import { electronHost } from './electron-host.ts';
import type { Host } from './host-type.ts';
import type { PitwallHostApi } from './electron-host.ts';

export type { Host };

/** The window id when the URL names none. */
const DEFAULT_WINDOW: WindowId = 'main';

/** Where this window is: a browser cannot tell the screen, so it is always 0. */
const browserGeometry = (): Geometry => ({
  screen: 0,
  x: window.screenX,
  y: window.screenY,
  width: window.outerWidth,
  height: window.outerHeight,
});

/**
 * A plain browser tab: windows are tabs opened as `/?window=<id>`. A page cannot open or place tabs unasked, so
 * `ensureWindows` and `openPath` do nothing; geometry is still reported so the workbook keeps the tab's size.
 */
export const browserHost: Host = {
  kind: 'browser',
  windowId: () => new URLSearchParams(location.search).get('window') ?? DEFAULT_WINDOW,
  ensureWindows: () => {},
  onGeometryChange(cb) {
    const onResize = (): void => cb(browserGeometry());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  },
  openPath: () => {},
};

/** The host this page runs in: Electron when its preload script exposed `window.pitwallHost`, else the browser. */
export const getHost = (): Host => {
  const api = (window as { pitwallHost?: PitwallHostApi }).pitwallHost;
  return api === undefined ? browserHost : electronHost(api);
};
