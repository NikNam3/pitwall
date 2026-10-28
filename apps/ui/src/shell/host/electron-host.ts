// The Electron host (spec 7.1): forwards to the `window.pitwallHost` API that apps/desktop/src/preload.ts exposes.
import type { Geometry, WindowId } from '@pitwall/contracts';
import type { Host } from './host-type.ts';

/** The API the desktop preload script exposes; kept in step with apps/desktop/src/preload.ts (the UI imports no desktop code). */
export type PitwallHostApi = {
  windowId: WindowId;
  ensureWindows(windows: Array<{ id: WindowId; geometry?: Geometry | undefined }>): void;
  onGeometry(cb: (g: Geometry) => void): () => void;
  openPath(path: string): void;
};

/** Wraps the preload API as a `Host`. */
export const electronHost = (api: PitwallHostApi): Host => ({
  kind: 'electron',
  windowId: () => api.windowId,
  ensureWindows: (windows) => api.ensureWindows(windows),
  onGeometryChange: (cb) => api.onGeometry(cb),
  openPath: (path) => api.openPath(path),
});
