import type { CarId, GapperLines, UnknownReason } from '@pitwall/domain';
import type { CarCodeCell } from '../../kit/car/car-label.ts';
import { formatLapTime } from '../../kit/values/format.ts';

export const xLabel = 'lap';
export const yLabel = 'behind reference, s';

/** The words of the reference line. */
export const reference = { prefix: 'ref', leaderAverage: 'leader avg', fixed: 'fixed', average: 'avg' } as const;

/** A part of the reference line: known text, or an unknown value the display shows as its mark, the reason on hover. */
export type ReferencePart = { text: string } | { reason: UnknownReason };

/** The reference car's code, or a mark where it is unknown (a car the field lacks). */
function carPart(carId: GapperLines['reference']['carId'], codeOf: (id: CarId) => CarCodeCell): ReferencePart {
  if (!carId.known) return { reason: carId.reason };
  const code = codeOf(carId.value);
  return code.text === '' ? { reason: code.reason ?? 'notReceived' } : { text: code.text };
}

/** Who the reference is: the leader average, a car average named by its code, or a fixed lap. */
function referenceName(ref: GapperLines['reference'], codeOf: (id: CarId) => CarCodeCell): ReferencePart[] {
  if (ref.kind === 'leaderAverage') return [{ text: reference.leaderAverage }];
  if (ref.kind === 'fixed') return [{ text: reference.fixed }];
  return [carPart(ref.carId, codeOf), { text: reference.average }];
}

/**
 * The header naming the reference the gapper used, in parts, e.g. `ref`, `leader avg`, `1:45.123`; the display joins
 * them with a space. An unknown lap time, or the code of a car the field lacks, is a `{ reason }` part at its place.
 */
export function referenceText(gapper: Pick<GapperLines, 'reference' | 'referenceLapMs'>, codeOf: (id: CarId) => CarCodeCell): ReferencePart[] {
  const { reference: ref, referenceLapMs } = gapper;
  const lap: ReferencePart = referenceLapMs.known ? { text: formatLapTime(referenceLapMs.value) } : { reason: referenceLapMs.reason };
  return [{ text: reference.prefix }, ...referenceName(ref, codeOf), lap];
}
