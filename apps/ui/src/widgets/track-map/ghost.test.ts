// The track map's rejoin ghost (SP4.2 spec §5, B1; mockup 2-map-views.html): `sceneOf` adds, per condition in the order
// green, VSC, SC whose `mapPoint` is known, one ghost at that point, lettered with the kit's `ghostLetter` in the full
// size and unlettered in the compact one; a condition whose point is unknown gets no ghost, and no rejoin value (not
// arrived) none at all. The kit's layout keeps the map's labels (turns, sectors, incident labels) clear of every ring and
// its letter (the map's existing label rules), so a ring never covers a label.
import { describe, expect, it } from 'vitest';
import { carId, known, unknown } from '@pitwall/domain';
import type { Known, MapCar, MapIncident, MapPoint, PitCondition, Rejoin, RejoinAt, TrackCars, TrackGeometry } from '@pitwall/domain';
import { ghostLetter } from '../../kit/text.ts';
import { TRACK_PX, layoutTrack } from '../../kit/track/layout.ts';
import type { TrackScene } from '../../kit/track/types.ts';
import { sceneOf } from './scene.ts';

const FULL = { mode: 'full' } as const;
const COMPACT = { mode: 'compact' } as const;

const p = (x: number, y: number): MapPoint => ({ x, y });
const k = <T>(v: T): Known<T> => known(v, 0);

/** A square outline of eight points, two turns and the three sector starts. */
const geometry = (): TrackGeometry => ({
  outline: [p(0.1, 0.1), p(0.5, 0.1), p(0.9, 0.1), p(0.9, 0.5), p(0.9, 0.9), p(0.5, 0.9), p(0.1, 0.9), p(0.1, 0.5)],
  turns: [{ label: 'T1', point: p(0.9, 0.1) }, { label: 'T2', point: p(0.9, 0.9) }],
  sectorStarts: [p(0.1, 0.1), p(0.9, 0.5), p(0.5, 0.9)],
});

const PLAYER: MapCar = { carId: carId(0), code: 'KUH', teamId: 3, raceNumber: 7, ours: true, point: p(0.5, 0.1), inPit: false, blueFlag: false };
const cars = (): Known<TrackCars> => k({ cars: [PLAYER], zones: [] });

const GREEN = p(0.1, 0.5);
const VSC = p(0.1, 0.7);
const SC = p(0.1, 0.8);

/** `rejoin.car` of our car with a map point per condition; `undefined` makes that condition's point unknown. */
function rejoin(points: Readonly<Record<PitCondition, MapPoint | undefined>> = { green: GREEN, vsc: VSC, sc: SC }): Rejoin {
  const at = (c: PitCondition): RejoinAt => {
    const point = points[c];
    return {
      condition: c,
      lossMs: k(20_000),
      lossSource: { kind: 'session', sessionShare: 1, parts: 'stops' },
      rejoinPosition: k(8),
      order: unknown('notApplicable'),
      mapPoint: point === undefined ? unknown('notApplicable') : k(point),
    };
  };
  return { carId: carId(0), position: 6, conditions: { green: at('green'), vsc: at('vsc'), sc: at('sc') } };
}

const scene = (
  over: { rejoin?: Rejoin | undefined; size?: typeof FULL | typeof COMPACT; geometry?: TrackGeometry; markers?: Known<MapIncident[]> } = {},
): TrackScene => sceneOf(over.geometry ?? geometry(), cars(), over.markers, over.size ?? FULL, 'rejoin' in over ? over.rejoin : rejoin());

describe('sceneOf: the ghost', () => {
  it('draws one ghost per condition at its known map point, green, VSC, SC, lettered in the full size', () => {
    expect(scene().ghosts).toEqual([
      { at: GREEN, letter: ghostLetter('green') },
      { at: VSC, letter: ghostLetter('vsc') },
      { at: SC, letter: ghostLetter('sc') },
    ]);
  });

  it('letters the ghosts G, VSC and SC', () => {
    expect(scene().ghosts.map((g) => g.letter)).toEqual(['G', 'VSC', 'SC']);
  });

  it('draws the same ghosts without letters in the compact size', () => {
    expect(scene({ size: COMPACT }).ghosts).toEqual([
      { at: GREEN, letter: undefined },
      { at: VSC, letter: undefined },
      { at: SC, letter: undefined },
    ]);
  });

  it('draws no ghost for a condition whose map point is unknown', () => {
    expect(scene({ rejoin: rejoin({ green: GREEN, vsc: undefined, sc: SC }) }).ghosts).toEqual([
      { at: GREEN, letter: 'G' },
      { at: SC, letter: 'SC' },
    ]);
  });

  it('draws no ghost when every map point is unknown (no track file)', () => {
    expect(scene({ rejoin: rejoin({ green: undefined, vsc: undefined, sc: undefined }) }).ghosts).toEqual([]);
  });

  it('draws no ghost before the rejoin value arrives', () => {
    expect(scene({ rejoin: undefined }).ghosts).toEqual([]);
  });

  it('leaves the car dots as they are: the ghost is no dot', () => {
    expect(scene().dots).toEqual(scene({ rejoin: undefined }).dots);
  });
});

describe('the kit layout: no label under a ghost ring', () => {
  type Rect = { x: number; y: number; w: number; h: number };
  const BOX = { width: 640, height: 400 };
  const LINE = 16;
  const textWidth = (s: string) => s.length * 8;
  /** The ring's radius in `drawGhostRing` (5 px) plus half its stroke. */
  const RING = 5 + TRACK_PX.ring / 2;

  const circleHitsRect = (c: { x: number; y: number }, r: number, b: Rect) => {
    const nx = Math.max(b.x, Math.min(c.x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(c.y, b.y + b.h));
    return (c.x - nx) ** 2 + (c.y - ny) ** 2 < r ** 2;
  };
  const rectsHit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // the ghosts sit on the turn and sector labels' points, where the labels would go without them
  const crowded = rejoin({ green: p(0.9, 0.1), vsc: p(0.9, 0.5), sc: p(0.9, 0.9) });
  const incident = k<MapIncident[]>([{ point: p(0.5, 0.9), kind: 'collision' }]);

  for (const size of [FULL, COMPACT]) {
    it(`keeps every turn, sector and incident label clear of every ring (${size.mode})`, () => {
      const s = scene({ rejoin: crowded, size, markers: incident });
      expect(s.ghosts).toHaveLength(3);
      const placed = layoutTrack(s, BOX, textWidth, LINE);
      const boxes = [...placed.labels, ...placed.markerLabels].map((l) => ({ x: l.x, y: l.y, w: textWidth(l.text), h: LINE }));
      for (const g of s.ghosts) {
        const c = placed.toPx(g.at);
        for (const b of boxes) expect(circleHitsRect(c, RING, b)).toBe(false);
      }
    });
  }

  it('keeps every label clear of each ring letter (drawn right of its ring, 3 px from its edge)', () => {
    const s = scene({ rejoin: crowded, markers: incident });
    const placed = layoutTrack(s, BOX, textWidth, LINE);
    const boxes = [...placed.labels, ...placed.markerLabels].map((l) => ({ x: l.x, y: l.y, w: textWidth(l.text), h: LINE }));
    for (const g of s.ghosts) {
      if (g.letter === undefined) continue;
      const c = placed.toPx(g.at);
      const letter = { x: c.x + 5 + 3, y: c.y - LINE / 2, w: textWidth(g.letter), h: LINE };
      for (const b of boxes) expect(rectsHit(letter, b)).toBe(false);
    }
  });

  it('still places the labels it placed without ghosts where they stay free', () => {
    const without = layoutTrack(scene({ rejoin: undefined }), BOX, textWidth, LINE);
    const far = rejoin({ green: p(0.5, 0.5), vsc: p(0.45, 0.5), sc: p(0.55, 0.5) });
    const withFar = layoutTrack(scene({ rejoin: far }), BOX, textWidth, LINE);
    expect(withFar.labels).toEqual(without.labels);
  });
});
