// The `track-positions` calculator (spec 6.1): the track map's geometry and every competing car on it, from the view's
// track file (C39), the live session, timing and identity, and the open spans of four sub-machines (C20). A quick unit
// (C31): both parts are rebuilt on every frame, nothing is kept between frames.
import { carCode, known, unknown, zoneFlagsSpans, type MapCar, type MapPoint, type MapZone, type TrackData, type ZoneFlagDetail } from '@pitwall/domain';
import { openSpansOf, type DeepReadonly, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { behaviourByCar } from '../shared/behaviour.ts';
import { ourCars } from '../shared/our-cars.ts';
import { fractionOf, pointAt } from '../shared/track-lookup.ts';
import { TRACK_POSITIONS_CAR_ROWS, TRACK_POSITIONS_ZONE_ROWS, type TrackPositionsEffect } from './behaviour.ts';
import { TRACK_POSITIONS, type TrackPositionsOutput } from './index.ts';

type Outline = readonly DeepReadonly<MapPoint>[];

const NOT_APPLICABLE: TrackPositionsOutput = { geometry: unknown('notApplicable'), cars: unknown('notApplicable') };

/** The geometry: the outline, every turn's label at its apex, the line and the session's sector starts. */
function geometryOf(view: EngineView, track: DeepReadonly<TrackData>, outline: Outline): TrackPositionsOutput['geometry'] {
  const { trackLengthM, sector2StartM, sector3StartM } = view.live.session;
  const sector2 = fractionOf(sector2StartM, trackLengthM);
  const sector3 = fractionOf(sector3StartM, trackLengthM);
  if (sector2 === undefined || sector3 === undefined) return unknown('notReceived');
  const turns = track.turns.known ? track.turns.value : [];
  return known(
    {
      outline: outline.map((p) => ({ x: p.x, y: p.y })),
      turns: turns.map((t) => ({ label: t.label, point: pointAt(outline, t.apex) })),
      sectorStarts: [pointAt(outline, 0), pointAt(outline, sector2), pointAt(outline, sector3)],
    },
    view.live.sessionTime,
  );
}

/** A car's marker from its rows: drawn only when a row says so and none says otherwise (C17). */
function markerOf(rows: readonly TrackPositionsEffect[]): { drawn: boolean; inPit: boolean; blueFlag: boolean } {
  return {
    drawn: rows.some((r) => r.drawn === true) && !rows.some((r) => r.drawn === false),
    inPit: rows.some((r) => r.inPit === true),
    blueFlag: rows.some((r) => r.blueFlag === true),
  };
}

/** Every drawn car at its lap distance; none while the session's lap length is unknown. */
function carsOf(view: EngineView, outline: Outline): MapCar[] {
  const rowsOf = behaviourByCar(TRACK_POSITIONS_CAR_ROWS, view);
  const ours = new Set(ourCars(view.live));
  const lengthM = view.live.session.trackLengthM;
  const cars: MapCar[] = [];
  for (const car of view.live.cars) {
    const marker = markerOf(rowsOf(car.id));
    if (!marker.drawn) continue;
    const fraction = fractionOf(car.timing.lapDistanceM, lengthM);
    if (fraction === undefined) continue;
    cars.push({
      carId: car.id,
      code: carCode(car.identity),
      teamId: car.identity.teamId,
      raceNumber: car.identity.raceNumber,
      ours: ours.has(car.id),
      point: pointAt(outline, fraction),
      inPit: marker.inPit,
      blueFlag: marker.blueFlag,
    });
  }
  return cars;
}

/** One zone per open zone-flags span, in lap order, from its start to the next one's; the last wraps past the line. */
function zonesOf(view: EngineView): MapZone[] {
  const open = openSpansOf(view, zoneFlagsSpans.machine).map((span) => {
    const flag = Object.hasOwn(TRACK_POSITIONS_ZONE_ROWS, span.kind) ? TRACK_POSITIONS_ZONE_ROWS[span.kind]?.zoneFlag : undefined;
    if (flag === undefined) throw new Error(`behaviour table: no row for zone-flags ${span.kind}`);
    return { start: (span.detail as DeepReadonly<ZoneFlagDetail>).startFraction, flag };
  });
  const sorted = open.sort((a, b) => a.start - b.start);
  const first = sorted[0];
  if (first === undefined) return [];
  return sorted.map((zone, i) => ({ ...zone, end: sorted[i + 1]?.start ?? first.start + 1 }));
}

/** The track map's geometry and cars, from the view's track file, live timing and the open spans (C20). */
export const trackPositionsCalculator: QuickCalculator<TrackPositionsOutput> = {
  id: TRACK_POSITIONS,
  kind: 'quick',
  reads: ['session', 'timing', 'identity', 'spans:car-status', 'spans:car-location', 'spans:car-flags', 'spans:zone-flags'],
  cadence: 'frame',
  compute(view: EngineView): TrackPositionsOutput {
    if (!view.track.known) return NOT_APPLICABLE;
    const track = view.track.value;
    if (!track.outline.known || track.outline.value.length === 0) return NOT_APPLICABLE;
    const outline = track.outline.value;
    return {
      geometry: geometryOf(view, track, outline),
      cars: known({ cars: carsOf(view, outline), zones: zonesOf(view) }, view.live.sessionTime),
    };
  },
};
