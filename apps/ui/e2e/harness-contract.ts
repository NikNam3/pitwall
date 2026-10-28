// The contract between the Task 22 specs and the harness (`./harness.ts`, written by the implementation agent).
// Types only: the specs import these shapes, the harness must satisfy them.
import type { Page } from '@playwright/test';

/** The gallery (`/gallery` of a build made with `VITE_PITWALL_GALLERY=1`, moments generated) open in an Electron window. */
export type GalleryHandle = { page: Page; close(): Promise<void> };

export type StartBridgeOptions = {
  /** A fixture name from `fixtures/index.json`, replayed with `pitwall replay <fixture> --paused`. */
  recording: string;
  /** `PITWALL_DATA_DIR` of the bridge; it keeps the workbooks under `<dir>/ui/workbooks`. */
  dataDir: string;
  /** Test-only hook (inert unless set): with `PITWALL_E2E_INSIGHT=<key>` the bridge raises one critical insight
   *  (category `system`, severity `critical`) with exactly this key, as soon as the feed exists, and keeps it active. */
  insight?: string | undefined;
};

export type BridgeHandle = {
  /** The free `PITWALL_WS_PORT` chosen at the first start; a restart uses the same one. */
  wsPort: number;
  /** Stops the bridge process (SIGTERM, resolves when the port is free). */
  stop(): Promise<void>;
  /** Starts it again on the same port, data dir, recording and options; `log()` starts empty again. */
  restart(): Promise<void>;
  /** The bridge's stdout lines since the last (re)start, one pino JSON object per line, unparsed. */
  log(): string[];
};

export type LaunchPitwallOptions = {
  wsPort: number;
  /** The same `PITWALL_DATA_DIR`; the harness passes it on so the app and bridge agree. */
  dataDir: string;
};

export type PitwallApp = {
  /** Resolves once the window with this workbook window id (`?window=<id>` in its URL) has loaded; waits for it to open. */
  window(id: string): Promise<Page>;
  close(): Promise<void>;
};
