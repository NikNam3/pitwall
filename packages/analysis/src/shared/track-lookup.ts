import type { BrakingZone, LapFraction, MapPoint, Metres, TrackTurn } from '@pitwall/domain';

export function fractionOf(_lapDistanceM: Metres, _trackLengthM: Metres): LapFraction | undefined {
  throw new Error('not implemented');
}

export function pointAt(_outline: readonly MapPoint[], _fraction: LapFraction): MapPoint {
  throw new Error('not implemented');
}

export function turnAt(
  _turns: readonly TrackTurn[],
  _fraction: LapFraction,
  _trackLengthM: Metres,
  _snapM: Metres,
): string | undefined {
  throw new Error('not implemented');
}

export function sectorOfDistance(_lapDistanceM: Metres, _sector2StartM: Metres, _sector3StartM: Metres): 1 | 2 | 3 {
  throw new Error('not implemented');
}

export function brakingAhead(
  _zones: readonly BrakingZone[],
  _fraction: LapFraction,
  _trackLengthM: Metres,
  _leadM: Metres,
): 'inside' | 'ahead' | 'clear' {
  throw new Error('not implemented');
}
