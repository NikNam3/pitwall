// The track map's scene (spec 7.2): a pure mapping from the topic values to what the kit's track canvas draws. It
// chooses roles and styles only (C65, from `presentation.ts`, C66); the canvas places everything. Colours only as
// theme roles or `carColour` (C68).
import type { Known, MapCar, MapIncident, PitCondition, Rejoin, TrackCars, TrackGeometry } from '@pitwall/domain';
import { ghostLetter, incidentKinds } from '../../kit/text.ts';
import type { TrackDot, TrackGhost, TrackLabel, TrackScene, TrackStretch } from '../../kit/track/types.ts';
import type { WidgetSize } from '../../kit/types.ts';
import { carColour } from '../../theme/index.ts';
import { dots, parts, presentation } from './presentation.ts';
import { sectorLabels } from './text.ts';

const keyOf = (c: MapCar) => ({ id: c.carId, teamId: c.teamId, raceNumber: c.raceNumber });

/** One dot per car: its `carColour` (our cars being the cars the topic marks `ours`), our cars larger. */
function dotsOf(field: readonly MapCar[]): TrackDot[] {
  const keys = field.map(keyOf);
  const ours = new Set(field.filter((c) => c.ours).map((c) => c.carId));
  return field.map((c) => {
    const { colour, ownCar } = carColour(keyOf(c), keys, ours);
    const dot: TrackDot = {
      id: String(c.carId),
      at: c.point,
      colour: { colour, ownCar },
      radiusPx: (c.ours ? dots.ours : dots.rival).radiusPx,
      hollow: (c.inPit ? dots.inPit : dots.onTrack).hollow,
    };
    return c.blueFlag ? { ...dot, bar: dots.blueFlag.bar } : dot;
  });
}

/** The zones whose flag's row redraws a stretch, as they are. */
function stretchesOf(cars: TrackCars): TrackStretch[] {
  return cars.zones.flatMap((z) => {
    const role = presentation.situations['zone-flags'][z.flag].stretch;
    return role === undefined ? [] : [{ start: z.start, end: z.end, role }];
  });
}

/** The turn labels and the sector labels (full size only). */
function labelsOf(geometry: TrackGeometry): TrackLabel[] {
  const turns = geometry.turns.map((t) => ({ text: t.label, at: t.point }));
  const sectors = geometry.sectorStarts.map((at, i) => ({ text: sectorLabels[i] ?? '', at }));
  return [...turns, ...sectors];
}

/** The ghost's conditions in drawing order. */
const CONDITIONS = ['green', 'vsc', 'sc'] as const satisfies readonly PitCondition[];

/** One ghost per condition whose map point is known, lettered in the full size only; none before the value arrives. */
function ghostsOf(rejoin: Rejoin | undefined, full: boolean): TrackGhost[] {
  if (rejoin === undefined) return [];
  return CONDITIONS.flatMap((c) => {
    const point = rejoin.conditions[c].mapPoint;
    return point.known ? [{ at: point.value, letter: full ? ghostLetter(c) : undefined }] : [];
  });
}

/** The scene of the geometry, the cars, the markers and the rejoin ghost at the panel's size. */
export function sceneOf(
  geometry: TrackGeometry,
  cars: Known<TrackCars>,
  markers: Known<MapIncident[]> | undefined,
  size: Pick<WidgetSize, 'mode'>,
  rejoin?: Rejoin,
): TrackScene {
  const full = size.mode === 'full';
  return {
    outline: geometry.outline,
    lineRole: parts.outline,
    stretches: cars.known ? stretchesOf(cars.value) : [],
    labels: full ? labelsOf(geometry) : [],
    dots: cars.known ? dotsOf(cars.value.cars) : [],
    // the compact size draws the triangle only, as the mockup does
    markers: markers?.known === true ? markers.value.map((m) => ({ at: m.point, label: full ? incidentKinds[m.kind] : '', role: parts.marker })) : [],
    ghosts: ghostsOf(rejoin, full),
  };
}
