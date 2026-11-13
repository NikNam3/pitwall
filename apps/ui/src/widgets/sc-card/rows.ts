// The sc-card's rows (SP4.2 spec 4; C65): the topic's values formatted, nothing computed. The loss's source is the
// calculator's (C43); the gain rests on the same loss and takes the same badge. SP4.3b2 Task 2b (mechanical port, until
// Task 15): the gain column shows `ePosDelta` where it showed the 4.2 `gainMs`.
import type { EstimateSource, Ms, ScCall, ScCallRow } from '@pitwall/domain';
import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatPosition, formatSeconds, formatSignedSeconds } from '../../kit/values/format.ts';

export type Condition = ScCallRow['condition'];

export type ScRow = {
  condition: Condition;
  /** The row of the condition that is out. */
  active: boolean;
  rejoin: CellPart;
  loss: CellPart;
  gain: CellPart;
  source: EstimateSource;
};

/** One row per topic row, in its order (SC, VSC); `active` the condition that is out, if any. */
export function buildRows(call: ScCall, active: Condition | undefined): ScRow[] {
  return call.rows.map((r) => ({
    condition: r.condition,
    active: r.condition === active,
    rejoin: knownPart(r.rejoinPosition, formatPosition),
    loss: knownPart(r.lossMs, (ms: Ms) => formatSeconds(ms, 1)),
    gain: knownPart(r.ePosDelta, (x: number) => formatSignedSeconds(x, 1)),
    source: r.lossSource,
  }));
}
