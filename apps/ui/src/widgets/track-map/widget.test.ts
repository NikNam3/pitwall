// The track-map declaration (spec 7.2; SP4.3c §5.7, O18): it reads the geometry, the cars, the incident markers and the
// rejoin ghost of the link's primary car from `rejoinGhost.car` (the per-frame ghost, `rejoin-ghost`'s topic), no longer
// from `rejoin.car`.
import { carId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { widget } from './widget.ts';

describe('track-map declaration', () => {
  it('reads the geometry, the cars, the markers and the ghost from rejoinGhost.car', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      geometry: 'trackPositions.geometry',
      cars: 'trackPositions.cars',
      markers: 'incidents.markers',
      ghost: 'rejoinGhost.car',
    });
  });

  it("reads rejoinGhost.car for the link group's primary car, as an optional value", () => {
    const ghost = (widget.data as unknown as Record<string, { optional?: boolean; params: (ctx: { link: { primary: number } }) => unknown }>).ghost;
    expect(ghost?.optional).toBe(true);
    expect(ghost?.params({ link: { primary: carId(4) } })).toEqual({ carId: carId(4) });
  });
});
