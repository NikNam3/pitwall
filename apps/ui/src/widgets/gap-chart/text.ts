import type { CarId, GapperLines, GapperReferenceKind, UnknownReason } from '@pitwall/domain';
import type { CarCodeCell } from '../../kit/car/car-label.ts';
import { formatLapTime } from '../../kit/values/format.ts';

export const xLabel = 'lap';
export const yLabel = 'behind reference, s';

/** The words of the reference line. */
export const reference = { prefix: 'ref', leaderAverage: 'leader avg', carAverage: 'car avg', fixed: 'fixed', average: 'avg' } as const;

/** The reference line as text and, when a part of it is unknown, the reason for the hover. */
export type ReferenceLine = { text: string; reason?: UnknownReason };

/** Who the reference is: the leader average, a car average named by its code, or a fixed lap. */
function referenceName(kind: GapperReferenceKind, car: CarCodeCell | undefined): string {
  if (kind === 'leaderAverage') return reference.leaderAverage;
  if (kind === 'fixed') return reference.fixed;
  return car === undefined || car.text === '' ? reference.carAverage : `${car.text} ${reference.average}`;
}

/**
 * The header naming the reference the gapper used, e.g. `ref leader avg 1:45.123`. An unknown lap time is left out
 * and its reason goes to the hover, as is the reason of a car code the field lacks.
 */
export function referenceText(gapper: Pick<GapperLines, 'reference' | 'referenceLapMs'>, codeOf: (id: CarId) => CarCodeCell): ReferenceLine {
  const { reference: ref, referenceLapMs } = gapper;
  const car = ref.kind === 'carAverage' && ref.carId.known ? codeOf(ref.carId.value) : undefined;
  const parts = [reference.prefix, referenceName(ref.kind, car), referenceLapMs.known ? formatLapTime(referenceLapMs.value) : ''];
  const reason = referenceLapMs.known ? car?.reason : referenceLapMs.reason;
  const text = parts.filter((p) => p !== '').join(' ');
  return reason === undefined ? { text } : { text, reason };
}
