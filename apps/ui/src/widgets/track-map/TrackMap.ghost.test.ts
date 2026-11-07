// @vitest-environment jsdom
// The track map draws its rejoin ghosts with the kit's `drawGhostRing` (SP4.2 spec §5, B1): one call per condition whose
// map point is known, at that point placed in the canvas box, with the condition's letter in the full size and none in
// the compact one; an unknown point draws no ring, and no rejoin value draws none.
import { cleanup, render } from '@testing-library/svelte';
import type { MapPoint } from '@pitwall/domain';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { cellBox } from '../../kit/size/size.ts';
import { layoutTrack } from '../../kit/track/layout.ts';
import { DEFAULT_THEME } from '../../theme/index.ts';
import { geometry, markers, onOutline, rejoin, trackCars, zandvoortGeometry } from './fixtures.ts';
import TrackMap from './TrackMap.svelte';

const ring = vi.hoisted(() => ({ calls: [] as { point: { x: number; y: number }; letter: string | undefined }[] }));
vi.mock('../../kit/track/ghost-ring.ts', () => ({
  drawGhostRing: (_ctx: unknown, point: { x: number; y: number }, letter: string | undefined) => {
    ring.calls.push({ point: { x: point.x, y: point.y }, letter });
  },
}));

const BOX = { width: 640, height: 400 };

// The kit's track canvas measures its box with a ResizeObserver: report a 640 x 400 px box when observed.
beforeEach(() => {
  ring.calls.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: BOX }]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FULL = { mode: 'full', cols: 64, rows: 20, px: BOX, dpr: 1 } as const;
const COMPACT = { mode: 'compact', cols: 32, rows: 10, px: BOX, dpr: 1 } as const;

const show = (data: Record<string, unknown>, size: typeof FULL | typeof COMPACT = FULL) =>
  render(InPanel, {
    component: TrackMap as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: {}, size, link: {} },
  }).container;

/** Where the canvas puts a map point: the outline's fit into the box (the kit's layout, at the theme's line height). */
function toPx(point: MapPoint): { x: number; y: number } {
  const line = cellBox(DEFAULT_THEME.fontPx, DEFAULT_THEME.density.lineHeight).height;
  const outlineOnly = { outline: zandvoortGeometry().outline, lineRole: 'textFaint', stretches: [], labels: [], dots: [], markers: [], ghosts: [] } as const;
  return layoutTrack({ ...outlineOnly, stretches: [], labels: [], dots: [], markers: [], ghosts: [] }, BOX, (s) => s.length * 8, line).toPx(point);
}

const data = (over: Record<string, unknown> = {}) => ({ geometry: geometry(), cars: trackCars(), markers: markers(['collision', 0.74]), rejoin: rejoin(), ...over });

/** The mockup's ghost points (fixtures: green 0.235, VSC 0.335, SC 0.38 of the lap). */
const POINTS = { green: onOutline(0.235), vsc: onOutline(0.335), sc: onOutline(0.38) };

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('TrackMap: the ghost rings', () => {
  it('draws one ring per condition at its map point, lettered G, VSC, SC in the full size', () => {
    show(data());
    expect(ring.calls.map((c) => c.letter)).toEqual(['G', 'VSC', 'SC']);
    near(ring.calls[0]!.point, toPx(POINTS.green));
    near(ring.calls[1]!.point, toPx(POINTS.vsc));
    near(ring.calls[2]!.point, toPx(POINTS.sc));
  });

  it('draws the rings without letters in the compact size', () => {
    show(data(), COMPACT);
    expect(ring.calls.map((c) => c.letter)).toEqual([undefined, undefined, undefined]);
    near(ring.calls[0]!.point, toPx(POINTS.green));
  });

  it('draws no ring for a condition whose map point is unknown', () => {
    show(data({ rejoin: rejoin(['vsc']) }));
    expect(ring.calls.map((c) => c.letter)).toEqual(['G', 'SC']);
    near(ring.calls[1]!.point, toPx(POINTS.sc));
  });

  it('draws no ring without a rejoin value', () => {
    show(data({ rejoin: undefined }));
    expect(ring.calls).toEqual([]);
  });
});
