import { describe, expect, it } from 'vitest';
import { placePopover } from '../../src/shell/commands/placement.ts';

const VIEW = { width: 1000, height: 600 };
const SIZE = { width: 200, height: 150 };
const box = (left: number, top: number) => ({ left, right: left + 20, top, bottom: top + 20 });

describe('placePopover', () => {
  it('opens leftward: its right edge is the control right edge, below the control', () => {
    expect(placePopover(box(500, 100), SIZE, VIEW)).toEqual({ x: 320, y: 120 });
  });
  it('near the right edge it stays inside the window', () => {
    const { x } = placePopover(box(980, 100), SIZE, VIEW);
    expect(x + SIZE.width).toBe(1000);
  });
  it('near the left edge it is clamped to 0', () => {
    expect(placePopover(box(10, 100), SIZE, VIEW).x).toBe(0);
  });
  it('near the bottom it flips above the control', () => {
    expect(placePopover(box(500, 560), SIZE, VIEW).y).toBe(410);
  });
  it('in a short window where neither side fits it is clamped to the window', () => {
    const { y } = placePopover(box(500, 50), SIZE, { width: 1000, height: 120 });
    expect(y).toBe(0);
  });
});
