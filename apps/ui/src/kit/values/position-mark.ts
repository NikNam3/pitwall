import type { Known } from '@pitwall/domain';
import { knownPart, type CellPart } from '../grid/grid.ts';
import { arrow, positionGained, positionLost, positionUnchanged } from '../text.ts';
import { formatPosition } from './format.ts';

/** Places gained (positive) or lost (negative); a before/after pair is `positionPairParts`. */
export type PositionMarkProps = { change: number };

/** `▲2`, `▼1`, or empty for no change. */
export function positionMarkText(props: PositionMarkProps): string {
  if (props.change === 0) return '';
  return props.change > 0 ? `${positionGained}${props.change}` : `${positionLost}${-props.change}`;
}

/**
 * A before/after pair as cell parts, the kit's one pair rendering: `P7→P9`, `—` when the position held; an unknown
 * side is its mark and the known side still shows (`P7→…`, `…→P9`). The arrow is notation, so it stays when both
 * sides are unknown.
 */
export function positionPairParts(from: Known<number>, to: Known<number>): CellPart[] {
  if (from.known && to.known && from.value === to.value) return [{ text: positionUnchanged }];
  return [knownPart(from, formatPosition), { text: arrow }, knownPart(to, formatPosition)];
}
