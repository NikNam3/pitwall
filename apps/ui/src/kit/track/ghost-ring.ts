// The ghost on the track map (SP4.2 spec §5, B1): a hollow ring in the ghost role beside the map's car dots, with the
// condition's letter beside it. Never filled, so it never reads as a car.
import type { Role } from '../../theme/index.ts';
import { GHOST_ROLE } from '../ghost/ghost.ts';
import { TRACK_PX } from './layout.ts';

/** The ring's radius (px). */
export const RING_RADIUS = TRACK_PX.ghostRadius;
/** The gap between the ring's edge and its letter (px). */
export const LETTER_GAP = TRACK_PX.ghostLetterGap;

/** Strokes the ghost ring centred at `point` (CSS px) and writes `letter` right of it; `roles` resolves a role. */
export function drawGhostRing(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  letter: string | undefined,
  roles: (r: Role) => string,
): void {
  const colour = roles(GHOST_ROLE);
  ctx.lineWidth = TRACK_PX.ring;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.arc(point.x, point.y, RING_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  if (letter === undefined) return;
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, point.x + RING_RADIUS + LETTER_GAP, point.y);
}
