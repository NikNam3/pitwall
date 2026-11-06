// The track map's scene (spec 7.2, mockup 2-map-views.html without the ghost): `sceneOf` maps the topic values to what
// the kit's track canvas draws, choosing roles and styles only (C65): the outline in textFaint; rivals in their team
// colour and our cars in ownCar (both `carColour`'s, our cars being the cars the topic marks `ours`), ours larger; a car
// in the pit lane hollow; a car shown blue with a flagBlue side bar; a yellow zone's stretch in flagYellow; turn and
// sector labels in the full size only; incident markers amber (warning) with their kind's wording (kit `incidentKinds`).
// No car code labels (supervisor ruling): the labels are the turns' and the sector starts' only.
import { describe, expect, it } from 'vitest';
import { carId, known, unknown, zoneFlagsSpans } from '@pitwall/domain';
import type { Known, MapCar, MapIncident, MapPoint, MapZone, TrackCars, TrackGeometry } from '@pitwall/domain';
import type { TrackDot, TrackScene } from '../../kit/track/types.ts';
import { incidentKinds } from '../../kit/text.ts';
import { carColour, role } from '../../theme/index.ts';
import { sceneOf } from './scene.ts';
import * as text from './text.ts';

const FULL = { mode: 'full' } as const;
const COMPACT = { mode: 'compact' } as const;

const p = (x: number, y: number): MapPoint => ({ x, y });
const k = <T>(v: T): Known<T> => known(v, 0);

/** A square outline of eight points, two turns and the three sector starts. */
const geometry = (over: Partial<TrackGeometry> = {}): TrackGeometry => ({
  outline: [p(0.1, 0.1), p(0.5, 0.1), p(0.9, 0.1), p(0.9, 0.5), p(0.9, 0.9), p(0.5, 0.9), p(0.1, 0.9), p(0.1, 0.5)],
  turns: [{ label: 'T1', point: p(0.9, 0.1) }, { label: 'T2', point: p(0.9, 0.9) }],
  sectorStarts: [p(0.1, 0.1), p(0.9, 0.5), p(0.5, 0.9)],
  ...over,
});

/** A car at its own point; a rival unless `ours`. */
const car = (id: number, teamId: number, raceNumber: number, over: Partial<MapCar> = {}): MapCar => ({
  carId: carId(id), code: `C${id}`, teamId, raceNumber, ours: false, point: p(0.1 + id / 100, 0.1), inPit: false, blueFlag: false, ...over,
});

// our two cars (Williams), two Ferraris (the second dashed in a chart, the same dot here), a Haas in the pit lane, a
// Sauber shown blue
const PLAYER = car(0, 3, 23, { ours: true });
const TEAMMATE = car(1, 3, 2, { ours: true });
const LEC = car(5, 1, 16);
const HAM = car(6, 1, 44);
const OCO = car(7, 7, 31, { inPit: true });
const BOR = car(8, 9, 5, { blueFlag: true });
const FIELD = [PLAYER, TEAMMATE, LEC, HAM, OCO, BOR];

const cars = (list: MapCar[] = FIELD, zoneList: MapZone[] = []): Known<TrackCars> => k({ cars: list, zones: zoneList });
const scene = (over: { cars?: Known<TrackCars>; markers?: Known<MapIncident[]> | undefined; geometry?: TrackGeometry; size?: typeof FULL | typeof COMPACT } = {}): TrackScene =>
  sceneOf(over.geometry ?? geometry(), over.cars ?? cars(), over.markers, over.size ?? FULL);

/** The dot drawn at a car's point (every car of the field has its own). */
const dotOf = (s: TrackScene, c: MapCar): TrackDot | undefined => s.dots.find((d) => d.at.x === c.point.x && d.at.y === c.point.y);

/** `carColour` of a car of the field, our cars in order (player first). */
const colourOf = (c: MapCar, field: MapCar[] = FIELD) =>
  carColour(
    { id: c.carId, teamId: c.teamId, raceNumber: c.raceNumber },
    field.map((o) => ({ id: o.carId, teamId: o.teamId, raceNumber: o.raceNumber })),
    new Set(field.filter((o) => o.ours).map((o) => o.carId)),
  );

const zone = (start: number, end: number, flag: MapZone['flag']): MapZone => ({ start, end, flag });

describe('sceneOf: the outline', () => {
  it('draws the geometry outline as it is, in textFaint', () => {
    const s = scene();
    expect(s.outline).toEqual(geometry().outline);
    expect(s.lineRole).toBe('textFaint');
  });
});

describe('sceneOf: the cars', () => {
  it('draws one dot per car, at its point, each with its own id', () => {
    const s = scene();
    expect(FIELD.map((c) => dotOf(s, c)?.at)).toEqual(FIELD.map((c) => c.point));
    expect(s.dots).toHaveLength(FIELD.length);
    expect(new Set(s.dots.map((d) => d.id)).size).toBe(FIELD.length);
  });

  it('draws a rival solid in its team colour (carColour), not as our car', () => {
    for (const c of [LEC, HAM]) {
      const dot = dotOf(scene(), c);
      expect(dot?.colour.colour, c.code).toBe(colourOf(c).colour);
      expect(dot?.colour.ownCar, c.code).toBe(false);
      expect(dot?.hollow, c.code).toBe(false);
    }
    expect(dotOf(scene(), LEC)?.colour.colour).not.toBe(dotOf(scene(), BOR)?.colour.colour);
  });

  it('draws our cars in ownCar (carColour with our cars), the teammate too', () => {
    for (const c of [PLAYER, TEAMMATE]) {
      const dot = dotOf(scene(), c);
      expect(dot?.colour.colour, c.code).toBe(colourOf(c).colour);
      expect(dot?.colour.colour, c.code).toBe(role('ownCar'));
      expect(dot?.colour.ownCar, c.code).toBe(true);
    }
  });

  it('a rival of our team is not ours: it takes its team colour', () => {
    const rival = car(9, 3, 99);
    const field = [PLAYER, rival];
    const dot = dotOf(scene({ cars: cars(field) }), rival);
    expect(dot?.colour.ownCar).toBe(false);
    expect(dot?.colour.colour).toBe(colourOf(rival, field).colour);
  });

  it('draws our cars larger than every rival; every rival and every car of ours the same size', () => {
    const s = scene();
    const radii = (list: MapCar[]) => [...new Set(list.map((c) => dotOf(s, c)?.radiusPx))];
    const ours = radii([PLAYER, TEAMMATE]);
    const rivals = radii([LEC, HAM, OCO, BOR]);
    expect(ours).toHaveLength(1);
    expect(rivals).toHaveLength(1);
    expect(ours[0]).toBeGreaterThan(rivals[0] ?? Infinity);
  });

  it('draws a car in the pit lane hollow, in its colour and size', () => {
    const s = scene();
    const dot = dotOf(s, OCO);
    expect(dot?.hollow).toBe(true);
    expect(dot?.colour.colour).toBe(colourOf(OCO).colour);
    expect(dot?.radiusPx).toBe(dotOf(s, LEC)?.radiusPx);
    expect(FIELD.filter((c) => dotOf(s, c)?.hollow === true)).toEqual([OCO]);
  });

  it('our car in the pit lane is hollow too, and stays larger', () => {
    const inPit = { ...PLAYER, inPit: true };
    const s = scene({ cars: cars([inPit, LEC]) });
    expect(dotOf(s, inPit)?.hollow).toBe(true);
    expect(dotOf(s, inPit)?.radiusPx).toBeGreaterThan(dotOf(s, LEC)?.radiusPx ?? Infinity);
  });

  it('gives a car shown blue a flagBlue side bar, and no other car a bar', () => {
    const s = scene();
    expect(dotOf(s, BOR)?.bar).toBe('flagBlue');
    expect(FIELD.filter((c) => dotOf(s, c)?.bar !== undefined)).toEqual([BOR]);
  });

  it('gives our car shown blue the bar too', () => {
    const blue = { ...PLAYER, blueFlag: true };
    expect(dotOf(scene({ cars: cars([blue, LEC]) }), blue)?.bar).toBe('flagBlue');
  });

  it('draws the dots and the zones in the compact size too', () => {
    const s = scene({ size: COMPACT, cars: cars(FIELD, [zone(0.2, 0.4, 'yellow')]) });
    expect(s.dots).toHaveLength(FIELD.length);
    expect(dotOf(s, BOR)?.bar).toBe('flagBlue');
    expect(dotOf(s, OCO)?.hollow).toBe(true);
    expect(s.stretches).toEqual([{ start: 0.2, end: 0.4, role: 'flagYellow' }]);
  });

  it('draws no car and no zone while the cars are unknown; the outline and labels stay', () => {
    const s = scene({ cars: unknown('notReceived') });
    expect(s.dots).toEqual([]);
    expect(s.stretches).toEqual([]);
    expect(s.outline).toEqual(geometry().outline);
    expect(s.labels.map((l) => l.text)).toEqual(expect.arrayContaining(['T1', 'T2']));
  });
});

describe('sceneOf: the marshal zones', () => {
  it('redraws a yellow zone from its start to its end in flagYellow, one past the line as it is', () => {
    const zones = [zone(0.1, 0.3, 'yellow'), zone(0.3, 0.6, 'green'), zone(0.6, 0.9, 'noFlag'), zone(0.9, 1.1, 'yellow')];
    expect(scene({ cars: cars(FIELD, zones) }).stretches).toEqual([
      { start: 0.1, end: 0.3, role: 'flagYellow' },
      { start: 0.9, end: 1.1, role: 'flagYellow' },
    ]);
  });

  it('draws no stretch for every other zone flag', () => {
    const others = zoneFlagsSpans.kinds.filter((kind) => kind !== 'yellow');
    expect(others).toEqual(['noFlag', 'green', 'blue', 'unknown']);
    const zones = others.map((flag, i) => zone(i / others.length, (i + 1) / others.length, flag));
    expect(scene({ cars: cars(FIELD, zones) }).stretches).toEqual([]);
  });
});

describe('sceneOf: the labels', () => {
  // Spec 7.2 (supervisor ruling, test fix round): turn labels and sector labels only, no car code labels, no ticks; the
  // compact size drops both, as the mockup does. Labels compared as sets: the kit layout orders them itself.
  const sectorLabels = () => geometry().sectorStarts.map((at, i) => ({ text: text.sectorLabels[i] ?? '', at }));
  const byText = (labels: { text: string; at: MapPoint }[]) => [...labels].sort((a, b) => a.text.localeCompare(b.text));

  it('labels every turn at its point and every sector start in the full size, and nothing else', () => {
    expect(text.sectorLabels).toEqual(['S1', 'S2', 'S3']);
    expect(byText(scene().labels)).toEqual(byText([
      { text: 'T1', at: p(0.9, 0.1) },
      { text: 'T2', at: p(0.9, 0.9) },
      ...sectorLabels(),
    ]));
  });

  it('labels the three sector starts at geometry.sectorStarts with the widget wording', () => {
    const labels = scene().labels.filter((l) => (text.sectorLabels as readonly string[]).includes(l.text));
    expect(labels).toEqual(sectorLabels());
  });

  it('a track without turns keeps the sector labels', () => {
    expect(byText(scene({ geometry: geometry({ turns: [] }) }).labels)).toEqual(byText(sectorLabels()));
  });

  it('draws no car code labels', () => {
    const codes = new Set(FIELD.map((c) => c.code));
    expect(scene().labels.filter((l) => codes.has(l.text))).toEqual([]);
    expect(scene({ size: COMPACT }).labels.filter((l) => codes.has(l.text))).toEqual([]);
  });

  it('drops the turn and sector labels in the compact size: no labels at all', () => {
    expect(scene({ size: COMPACT }).labels).toEqual([]);
  });
});

describe('sceneOf: the incident markers', () => {
  const incidents: MapIncident[] = [{ point: p(0.9, 0.3), kind: 'collision' }, { point: p(0.3, 0.9), kind: 'retirement' }];

  it('marks each incident at its point, amber (warning), labelled with its kind in the kit wording', () => {
    expect(scene({ markers: k(incidents) }).markers).toEqual([
      { at: p(0.9, 0.3), label: incidentKinds.collision, role: 'warning' },
      { at: p(0.3, 0.9), label: incidentKinds.retirement, role: 'warning' },
    ]);
  });

  it('labels every incident kind with its kit wording', () => {
    const kinds = Object.keys(incidentKinds) as MapIncident['kind'][];
    const s = scene({ markers: k(kinds.map((kind, i) => ({ point: p(0.1, i / 10), kind }))) });
    expect(s.markers.map((m) => m.label)).toEqual(kinds.map((kind) => incidentKinds[kind]));
  });

  it('keeps the markers amber at their points in the compact size', () => {
    expect(scene({ size: COMPACT, markers: k(incidents) }).markers.map((m) => ({ at: m.at, role: m.role }))).toEqual([
      { at: p(0.9, 0.3), role: 'warning' },
      { at: p(0.3, 0.9), role: 'warning' },
    ]);
  });

  it('marks nothing before the markers arrive or while they are unknown', () => {
    expect(scene({ markers: undefined }).markers).toEqual([]);
    expect(scene({ markers: unknown('notApplicable') }).markers).toEqual([]);
  });
});
