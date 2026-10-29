// Where a popover goes: the one placement every popover anchored to a header control uses.

/** The box of the control a popover belongs to, in viewport px. */
export type AnchorBox = { left: number; right: number; top: number; bottom: number };
export type Size = { width: number; height: number };

const clamp = (v: number, max: number): number => Math.max(0, Math.min(v, max));

/**
 * The top left corner of a popover of `size` for a control at `anchor` in a window of `viewport`: right edges aligned
 * (it opens leftward), below the control, or above it when below does not fit; always clamped inside the window.
 */
export function placePopover(anchor: AnchorBox, size: Size, viewport: Size): { x: number; y: number } {
  const x = clamp(anchor.right - size.width, viewport.width - size.width);
  const fitsBelow = anchor.bottom + size.height <= viewport.height;
  const fitsAbove = anchor.top - size.height >= 0;
  const y = fitsBelow || !fitsAbove ? anchor.bottom : anchor.top - size.height;
  return { x, y: clamp(y, viewport.height - size.height) };
}
