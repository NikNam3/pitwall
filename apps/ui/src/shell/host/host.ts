// The host switch (spec 7.1): everything host-specific goes through a `Host`; this folder alone touches window.* host calls.
import type { Geometry, WindowId } from '@pitwall/contracts';

/** What the shell needs from the program that shows its windows. */
export type Host = {
  kind: 'electron' | 'browser';
  /** The workbook window this page shows. */
  windowId(): WindowId;
  /** Opens, closes and places the workbook's windows; best effort where the host cannot. */
  ensureWindows(windows: Array<{ id: WindowId; geometry?: Geometry | undefined }>): void;
  /** Calls `cb` when this window moves or resizes; returns the unsubscribe. */
  onGeometryChange(cb: (g: Geometry) => void): () => void;
  /** Opens a file in the developer's editor (dev inspector). */
  openPath(path: string): void;
};

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
 * `ensureWindows` does nothing and `openPath` copies the path to the clipboard (spec 8.2); geometry is still reported so the workbook keeps the tab's size.
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
  openPath: (path) => {
    // No clipboard (an insecure page, an old browser) or a refused write: the path is just not copied.
    void navigator.clipboard?.writeText(path).catch(() => {});
  },
};

/** The host this page runs in. */
export const getHost = (): Host => browserHost;
