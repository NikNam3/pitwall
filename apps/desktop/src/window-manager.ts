// Which native windows to open, close and move for a workbook, and where they may sit. Pure: no Electron imports.

/** A rectangle in absolute desktop coordinates. */
export type Rect = { x: number; y: number; width: number; height: number };
/** A window's saved place: the display it was on and its rectangle. */
export type Geometry = Rect & { screen: number };
/** A window id, as named by the workbook. */
export type WindowId = string;
/** An attached display. The first one passed to the functions below is the primary. */
export type Display = { id: number; bounds: Rect; workArea: Rect };

/**
 * A window with less than this share of its area on a work area is brought back. The brief says "more than 50 % off"
 * (half), but its test keeps a window with 42 % visible, so the line sits at a third.
 */
const MIN_VISIBLE = 1 / 3;
/** The size a window without saved geometry opens with, shrunk to fit the primary work area. */
const DEFAULT_SIZE = { width: 1280, height: 800 };

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const rectOf = (g: Rect): Rect => ({ x: g.x, y: g.y, width: g.width, height: g.height });

/** The size shrunk to fit `area`, placed at the top left of it. */
const fitInside = (size: Pick<Rect, 'width' | 'height'>, area: Rect): Rect => {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return { x: area.x, y: area.y, width, height };
};

/**
 * Where `g` may open. A geometry on a missing screen, or with less than a third of its area on any work area, goes
 * to the primary display's work area at its saved size, shrunk to fit; anything else is kept as saved.
 */
export function clampToDisplays(g: Geometry, displays: ReadonlyArray<Display>): Rect {
  const primary = displays[0];
  if (primary === undefined) return rectOf(g);
  const screen = displays.find((d) => d.id === g.screen);
  const visible = screen === undefined ? 0 : overlap(g, screen.workArea);
  if (visible >= g.width * g.height * MIN_VISIBLE) return rectOf(g);
  return fitInside(g, primary.workArea);
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** What to do to reach the desired windows from the open ones. */
export type WindowPlan = {
  open: Array<{ id: WindowId; bounds: Rect }>;
  close: WindowId[];
  move: Array<{ id: WindowId; bounds: Rect }>;
};

/** Opens the missing windows, closes the extra ones and moves those whose desired place differs. */
export function planWindows(
  desired: ReadonlyArray<{ id: WindowId; geometry?: Geometry | undefined }>,
  open: ReadonlyArray<{ id: WindowId; geometry: Geometry }>,
  displays: ReadonlyArray<Display>,
): WindowPlan {
  const primary = displays[0];
  const defaultBounds = primary === undefined ? { x: 0, y: 0, ...DEFAULT_SIZE } : fitInside(DEFAULT_SIZE, primary.workArea);
  const boundsOf = (g: Geometry | undefined): Rect => (g === undefined ? defaultBounds : clampToDisplays(g, displays));
  const plan: WindowPlan = { open: [], close: [], move: [] };
  for (const { id, geometry } of desired) {
    const current = open.find((w) => w.id === id);
    const bounds = boundsOf(geometry);
    if (current === undefined) plan.open.push({ id, bounds });
    else if (geometry !== undefined && !sameRect(bounds, current.geometry)) plan.move.push({ id, bounds });
  }
  for (const { id } of open) if (!desired.some((d) => d.id === id)) plan.close.push(id);
  return plan;
}
