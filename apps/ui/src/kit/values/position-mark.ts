import type { Known } from '@pitwall/domain';

/** Places gained or lost (`change`), or a before/after pair (`from`, `to`; `to` may be unknown). */
export type PositionMarkProps = { change: number } | { from: number; to: Known<number> };

/** `▲2`, `▼1`, empty for no change, or `P7→P9` (`P7→` while the target is unknown). */
export function positionMarkText(props: PositionMarkProps): string {
  if ('change' in props) {
    if (props.change === 0) return '';
    return props.change > 0 ? `▲${props.change}` : `▼${-props.change}`;
  }
  return `P${props.from}→${props.to.known ? `P${props.to.value}` : ''}`;
}

/** The mark of a position that did not change in an incident. */
export const positionUnchanged = '—';

/** A before/after pair of an incident: `P7→P9`, `P7→` while unknown, `—` when the position held. */
export const positionPairText = (from: number, to: Known<number>): string =>
  to.known && to.value === from ? positionUnchanged : positionMarkText({ from, to });
