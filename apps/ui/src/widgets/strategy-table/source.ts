// Where the strategy table's rows come from (SP4.3d2 Task 12; plan-workbook.html "Planning round"): `live` the race's
// strategy job (`strategy.car`), `planning` the planning job (`plans.preview`); `auto` planning while the planning round
// is open, live when it is closed or `plans.prepared` has no value. The table reads no sub-machine, so this rule is not
// a presentation table (C66); it maps the bridge's round state, it decides nothing (C43).
import type { PlanningRound } from '@pitwall/contracts';
import type { SOURCES } from './widget.ts';

export type Variant = 'live' | 'planning';

/** A round state to the variant `auto` draws. */
const ROUND: Readonly<Record<'open' | 'closed', Variant>> = { open: 'planning', closed: 'live' };

/** The variant; a source not set (the panel without options) is `auto`, the declaration's default. */
export function variantOf(source: (typeof SOURCES)[number] | undefined, prepared: PlanningRound | undefined): Variant {
  if (source !== undefined && source !== 'auto') return source;
  return ROUND[prepared?.open === true ? 'open' : 'closed'];
}
