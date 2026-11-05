import type { Placed, TrackScene } from './types.ts';

/**
 * Fits the outline into the box with a margin, keeping its aspect; places each label outside the bend at its point,
 * each side bar on the first free side (right, left, above, below) of its dot, each marker label beside its triangle.
 */
export function layoutTrack(
  scene: TrackScene,
  box: { width: number; height: number },
  textWidth: (s: string) => number,
  lineHeight: number,
): Placed {
  void scene;
  void box;
  void textWidth;
  void lineHeight;
  throw new Error('not implemented');
}
