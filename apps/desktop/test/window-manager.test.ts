import { describe, expect, it } from 'vitest';
import { clampToDisplays, planWindows } from '../src/window-manager.ts';

// Shapes are local: apps/desktop imports no workspace package.
type Rect = { x: number; y: number; width: number; height: number };
type Geometry = { screen: number; x: number; y: number; width: number; height: number };

const screen0 = { id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 30, width: 1920, height: 1050 } };
const screen1 = { id: 1, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };

const inside = (r: Rect, area: Rect): boolean =>
  r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height;

const geo = (screen: number, x: number, y: number, width: number, height: number): Geometry => ({ screen, x, y, width, height });
const rect = (g: Geometry): Rect => ({ x: g.x, y: g.y, width: g.width, height: g.height });

describe('clampToDisplays', () => {
  it('leaves a window fully inside its work area unchanged', () => {
    const g = geo(0, 100, 100, 800, 600);
    expect(clampToDisplays(g, [screen0])).toEqual(rect(g));
  });

  it('moves a window saved on a missing screen into the primary work area (14" monitor unplugged)', () => {
    const g = geo(1, 2000, 100, 800, 600);
    const r = clampToDisplays(g, [screen0]);
    expect(inside(r, screen0.workArea)).toBe(true);
    expect({ width: r.width, height: r.height }).toEqual({ width: 800, height: 600 });
  });

  it('shrinks a window larger than the primary work area to fit it', () => {
    const r = clampToDisplays(geo(1, 2000, 0, 3000, 2000), [screen0]);
    expect(r).toEqual(screen0.workArea);
  });

  it('moves a window that is 70 % off every work area inside, keeping its size', () => {
    const g = geo(0, 1620, 100, 1000, 600); // 300 of 1000 px visible
    const r = clampToDisplays(g, [screen0]);
    expect(inside(r, screen0.workArea)).toBe(true);
    expect({ width: r.width, height: r.height }).toEqual({ width: 1000, height: 600 });
  });

  it('keeps a window that is less than 50 % off-screen where it is', () => {
    const g = geo(0, 1500, 100, 1000, 600); // 420 of 1000 px visible
    expect(clampToDisplays(g, [screen0])).toEqual(rect(g));
  });

  it('keeps a window on an attached second screen', () => {
    const g = geo(1, 2000, 100, 800, 600);
    expect(clampToDisplays(g, [screen0, screen1])).toEqual(rect(g));
  });
});

describe('planWindows', () => {
  const g = geo(0, 0, 30, 960, 1050);

  it('opens the missing windows with their clamped bounds', () => {
    const plan = planWindows([{ id: 'strategy', geometry: g }], [], [screen0]);
    expect(plan.open).toEqual([{ id: 'strategy', bounds: rect(g) }]);
    expect(plan.close).toEqual([]);
    expect(plan.move).toEqual([]);
  });

  it('opens a window without saved geometry inside the primary work area', () => {
    const plan = planWindows([{ id: 'car' }], [], [screen0]);
    expect(plan.open).toHaveLength(1);
    expect(plan.open[0]?.id).toBe('car');
    expect(inside(plan.open[0]!.bounds, screen0.workArea)).toBe(true);
  });

  it('closes open windows that are no longer desired', () => {
    const plan = planWindows([], [{ id: 'old', geometry: g }], [screen0]);
    expect(plan).toEqual({ open: [], close: ['old'], move: [] });
  });

  it('keeps matching windows untouched', () => {
    const plan = planWindows([{ id: 'strategy', geometry: g }], [{ id: 'strategy', geometry: g }], [screen0]);
    expect(plan).toEqual({ open: [], close: [], move: [] });
  });

  it('moves a matching window whose desired geometry differs', () => {
    const moved = geo(0, 100, 100, 800, 600);
    const plan = planWindows([{ id: 'strategy', geometry: moved }], [{ id: 'strategy', geometry: g }], [screen0]);
    expect(plan.move).toEqual([{ id: 'strategy', bounds: rect(moved) }]);
    expect(plan.open).toEqual([]);
    expect(plan.close).toEqual([]);
  });

  it('does all three at once', () => {
    const plan = planWindows(
      [{ id: 'a', geometry: g }, { id: 'b', geometry: g }],
      [{ id: 'b', geometry: g }, { id: 'c', geometry: g }],
      [screen0],
    );
    expect(plan.open.map((w) => w.id)).toEqual(['a']);
    expect(plan.close).toEqual(['c']);
    expect(plan.move).toEqual([]);
  });

  it('clamps the bounds of a window saved on a missing screen', () => {
    const plan = planWindows([{ id: 'x', geometry: geo(1, 2000, 0, 800, 600) }], [], [screen0]);
    expect(inside(plan.open[0]!.bounds, screen0.workArea)).toBe(true);
  });
});
