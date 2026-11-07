import type { CarId, EstimateSource, GapperLines, PitCondition, Rejoin } from '@pitwall/domain';
import type { AxisLabel } from '../../kit/chart/labels.ts';
import { knownPart, unknownPart, type CellPart } from '../../kit/grid/grid.ts';
import { ghostLetter } from '../../kit/text.ts';
import { formatLapTime, formatSeconds } from '../../kit/values/format.ts';

/** The axis labels in their forms; the chart draws the longest that fits (the compact chart has room for a short one). */
export const xLabel: AxisLabel = ['lap'];
export const yLabel: AxisLabel = ['behind reference, s', 'behind ref, s', 's'];

/** The words of the reference line. */
export const reference = { prefix: 'ref', leaderAverage: 'leader avg', fixed: 'fixed', average: 'avg' } as const;

/** Who the reference is: the leader average, a car average named by its code (unknown for a car the field lacks), or a fixed lap. */
function referenceName(ref: GapperLines['reference'], codeOf: (id: CarId) => CellPart): CellPart[] {
  if (ref.kind === 'leaderAverage') return [{ text: reference.leaderAverage }];
  if (ref.kind === 'fixed') return [{ text: reference.fixed }];
  const car = ref.carId.known ? codeOf(ref.carId.value) : unknownPart(ref.carId.reason);
  return [car, { text: reference.average }];
}

/**
 * The header naming the reference the gapper used, in kit cell parts, e.g. `ref`, `leader avg`, `1:45.123`; the display
 * draws them a space apart. An unknown lap time, or the code of a car the field lacks, is an unknown part at its place.
 */
export function referenceText(gapper: Pick<GapperLines, 'reference' | 'referenceLapMs'>, codeOf: (id: CarId) => CellPart): CellPart[] {
  return [{ text: reference.prefix }, ...referenceName(gapper.reference, codeOf), knownPart(gapper.referenceLapMs, formatLapTime)];
}

/** The header's word before the ghost losses. */
export const pit = 'pit';

/** One condition's loss in the header: its letter, the loss in seconds to tenths and the loss's source for the badge. */
export type GhostLoss = { condition: PitCondition; letter: string; loss: CellPart; source: EstimateSource };

const LOSS_ORDER = ['green', 'vsc', 'sc'] as const;

/** `rejoin.car`'s losses per condition, green, VSC, SC (e.g. `G 20.3`, `VSC 13.1ᶜ`); none without `rejoin.car`. */
export function ghostLosses(rejoin: Rejoin | undefined): GhostLoss[] {
  if (rejoin === undefined) return [];
  return LOSS_ORDER.map((condition) => {
    const at = rejoin.conditions[condition];
    return { condition, letter: ghostLetter(condition), loss: knownPart(at.lossMs, (ms) => formatSeconds(ms, 1)), source: at.lossSource };
  });
}
