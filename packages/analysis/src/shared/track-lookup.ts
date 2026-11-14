import type { BrakingZone, LapFraction, Metres, TrackTurn } from '@pitwall/domain';

/** Wraps a number into [0, 1). */
function wrap01(value: number): number {
  const w = value - Math.floor(value);
  return w >= 1 ? 0 : w;
}

/** Fraction of the lap for a lap distance, wrapped into [0, 1); undefined when the track length is not positive. */
export function fractionOf(lapDistanceM: Metres, trackLengthM: Metres): LapFraction | undefined {
  if (!(trackLengthM > 0) || !Number.isFinite(lapDistanceM)) return undefined;
  return wrap01(lapDistanceM / trackLengthM);
}

/** Distance around the lap, in lap fractions, going forward from one fraction to another. */
function forwardGap(from: LapFraction, to: LapFraction): number {
  return wrap01(to - from);
}

/** Label of the nearest turn apex within snapM of the fraction, measured around the lap; undefined when none. */
export function turnAt(
  turns: readonly TrackTurn[],
  fraction: LapFraction,
  trackLengthM: Metres,
  snapM: Metres,
): string | undefined {
  let best: string | undefined;
  let bestM = Infinity;
  for (const turn of turns) {
    const gap = forwardGap(fraction, turn.apex);
    const metres = Math.min(gap, 1 - gap) * trackLengthM;
    if (metres <= snapM && metres < bestM) {
      best = turn.label;
      bestM = metres;
    }
  }
  return best;
}

/** Sector of a lap distance; a boundary belongs to the later sector. */
export function sectorOfDistance(lapDistanceM: Metres, sector2StartM: Metres, sector3StartM: Metres): 1 | 2 | 3 {
  if (lapDistanceM >= sector3StartM) return 3;
  if (lapDistanceM >= sector2StartM) return 2;
  return 1;
}

/** Whether the car is inside a braking zone, within leadM before one, or clear; zones may wrap the line. */
export function brakingAhead(
  zones: readonly BrakingZone[],
  fraction: LapFraction,
  trackLengthM: Metres,
  leadM: Metres,
): 'inside' | 'ahead' | 'clear' {
  const lead = trackLengthM > 0 ? leadM / trackLengthM : 0;
  let result: 'inside' | 'ahead' | 'clear' = 'clear';
  for (const zone of zones) {
    const length = forwardGap(zone.start, zone.end);
    const intoZone = forwardGap(zone.start, fraction);
    if (intoZone <= length) return 'inside';
    if (forwardGap(fraction, zone.start) <= lead) result = 'ahead';
  }
  return result;
}
