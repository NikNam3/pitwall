// The Host type alone, so the host implementations and the switch in host.ts do not import each other.
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
