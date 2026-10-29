import type { GapperReference, Known, Ms } from '@pitwall/domain';
import { formatLapTime } from '../../kit/values/format.ts';

export const xLabel = 'lap';
export const yLabel = 'behind reference, s';
export const noLapTime = '--';

/** The header text naming the reference pace, e.g. `ref leader avg 1:45.123`. */
export function referenceText(reference: GapperReference, referenceLapMs: Known<Ms>, codeOf: (id: number) => string): string {
  const lap = reference.kind === 'fixed' ? formatLapTime(reference.lapMs) : referenceLapMs.known ? formatLapTime(referenceLapMs.value) : noLapTime;
  const who = reference.kind === 'leaderAverage' ? 'leader avg' : reference.kind === 'carAverage' ? `${codeOf(reference.carId)} avg` : 'fixed';
  return `ref ${who} ${lap}`;
}

/** A y tick as seconds behind the reference: the plotted value is negated, `-5` -> `+5`, `0` -> `0`. */
export function gapTick(plotted: number): string {
  const behind = Math.round(-plotted * 100) / 100;
  return behind > 0 ? `+${behind}` : String(behind + 0);
}
