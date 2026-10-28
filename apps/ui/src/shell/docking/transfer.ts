// Panels dragged between windows (spec 7.1). Each window has its own dock, so dockview's in-page drag data does not
// cross; the panel's spec rides along in the native drag data instead.
import type { PanelSpec } from '@pitwall/contracts';

/** The drag data type that carries a panel spec. */
export const PANEL_TYPE = 'application/x-pitwall-panel';

/** Puts `spec` on an outgoing drag. */
export function writePanel(dt: DataTransfer, spec: PanelSpec): void {
  dt.setData(PANEL_TYPE, JSON.stringify(spec));
  dt.effectAllowed = 'move';
}

/** True when a drag carries a panel; readable during `dragover`, when the data itself is still hidden. */
export const carriesPanel = (dt: DataTransfer | null): boolean => dt !== null && Array.from(dt.types).includes(PANEL_TYPE);

/** The panel spec of a drop, or undefined when the drop carries none or a malformed one. */
export function readPanel(dt: DataTransfer | null): PanelSpec | undefined {
  const raw = dt?.getData(PANEL_TYPE);
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Not ours after all: a foreign page used the same type.
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { widget, options, linkGroup } = value as Record<string, unknown>;
  if (typeof widget !== 'string' || typeof options !== 'object' || options === null || typeof linkGroup !== 'number') return undefined;
  return { widget, options: options as Record<string, unknown>, linkGroup };
}
