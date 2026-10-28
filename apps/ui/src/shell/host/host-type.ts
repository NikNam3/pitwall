// The Host type (and the initial window id) alone, so the host implementations and the switch in host.ts do not import each other.
import type { Geometry, WindowId } from '@pitwall/contracts';

/** The window every host shows first, before the workbook names its windows (apps/desktop `FIRST_WINDOW`, a URL without `?window=`). */
export const INITIAL_WINDOW: WindowId = 'main';

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
  /** Brings workbook window `id` to the front; best effort where the host cannot. */
  focusWindow(id: WindowId): void;
};
