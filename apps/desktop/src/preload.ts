// Runs sandboxed in each window and exposes the small host API as `window.pitwallHost` (read by shell/host/electron-host.ts).
import { contextBridge, ipcRenderer } from 'electron';

/** The window id main.ts passed in `additionalArguments`. */
const ID_ARGUMENT = '--pitwall-window=';
const windowId = process.argv.find((a) => a.startsWith(ID_ARGUMENT))?.slice(ID_ARGUMENT.length) ?? 'main';

contextBridge.exposeInMainWorld('pitwallHost', {
  windowId,
  ensureWindows: (windows: unknown): void => ipcRenderer.send('ensureWindows', windows),
  onGeometry: (cb: (geometry: unknown) => void): (() => void) => {
    const listener = (_event: unknown, geometry: unknown): void => cb(geometry);
    ipcRenderer.on('geometry', listener);
    return () => ipcRenderer.removeListener('geometry', listener);
  },
  openPath: (path: string): void => ipcRenderer.send('openPath', path),
});
