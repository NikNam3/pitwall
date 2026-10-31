import type { Known } from '@pitwall/domain';
import type { CellPart } from '../grid/grid.ts';
import { arrow } from '../text.ts';
import { formatPosition } from './format.ts';

/** Places gained or lost (`change`), or a before/after pair (`from`, `to`; `to` may be unknown). */
export type PositionMarkProps = { change: number } | { from: number; to: Known<number> };

/** `▲2`, `▼1`, empty for no change, or `P7→P9` (`P7→` while the target is unknown). */
export function positionMarkText(props: PositionMarkProps): string {
  if ('change' in props) {
    if (props.change === 0) return '';
    return props.change > 0 ? `▲${props.change}` : `▼${-props.change}`;
  }
  return `${formatPosition(props.from)}${arrow}${props.to.known ? formatPosition(props.to.value) : ''}`;
}

/** The mark of a position that did not change in an incident. */
export const positionUnchanged = '—';

/** One side of a pair: the position, or the unknown's mark alone in its part. */
const sidePart = (p: Known<number>): CellPart => (p.known ? { text: formatPosition(p.value) } : { text: '', reason: p.reason });

/**
 * A before/after pair of an incident as cell parts: `P7→P9`, `—` when the position held; an unknown side is its mark
 * and the known side still shows (`P7→…`, `…→P9`). The arrow is notation, so it stays when both sides are unknown.
 */
export function positionPairParts(from: Known<number>, to: Known<number>): CellPart[] {
  if (from.known && to.known && from.value === to.value) return [{ text: positionUnchanged }];
  return [sidePart(from), { text: arrow }, sidePart(to)];
}
