import type { GapperLines } from '@pitwall/domain';
import { formatLapTime } from '../../kit/values/format.ts';

export const xLabel = 'lap';
export const yLabel = 'behind reference, s';
export const noLapTime = '--';

/** The header text naming the reference the gapper used, e.g. `ref leader avg 1:45.123`. */
export function referenceText(gapper: Pick<GapperLines, 'reference' | 'referenceLapMs'>, codeOf: (id: number) => string): string {
  const { reference, referenceLapMs } = gapper;
  const lap = referenceLapMs.known ? formatLapTime(referenceLapMs.value) : noLapTime;
  const who =
    reference.kind === 'leaderAverage' ? 'leader avg' : reference.kind === 'carAverage' && reference.carId.known ? `${codeOf(reference.carId.value)} avg` : reference.kind === 'carAverage' ? 'car avg' : 'fixed';
  return `ref ${who} ${lap}`;
}
