// The circle-of-doom's layout (SP4.3d spec §6.5; mockup docs/design/2026-11-16-sp4.3d/circle-of-doom.html, gen.mjs
// `circleSvg`): the sizes the drawing is made of, from the panel's pixels. Where a car or a label sits on the circle is
// the kit's (`kit/circle/`: `polarOf`, `placeCircleLabels`); the layout only gives the radii and widths the kit is
// called with and the drawing's fixed sizes (C65).
import { polarOf, type Point } from '../../kit/circle/index.ts';

/** The ring's radius as a share of the circle's square. */
const RING_SHARE = 0.36;
/** The label rings, outside the ring (px). */
const INNER_LABEL_PX = 22;
const OUTER_LABEL_PX = 40;
/** A label: three monospace characters of the code font, plus a little air (px). */
const CODE_CHARS = 3;
const MONO_ADVANCE = 0.62;
const LABEL_AIR_PX = 4;
/** The current ghost's rejoin place, inside the ring (px). */
const GHOST_TEXT_FULL_PX = 46;
const GHOST_TEXT_COMPACT_PX = 30;
/** Our car's code below its dot (px). */
const OWN_LABEL_PX = 22;
/** The gaps line below the rejoin place (px). */
const GAPS_LINE_PX = 16;

/** The drawing's fixed marks (px): dot radii, the ghost's diamond, stroke widths. */
export const MARKS = {
  ownDot: 6,
  mateRing: 5,
  mateStroke: 2,
  rivalDot: 4,
  ghostHalf: 6,
  ghostStrokeOn: 2,
  ghostStrokeOff: 1,
  /** The ghost's square turned into a diamond. */
  ghostTurnDeg: 45,
} as const;

export type CircleLayout = {
  /** The circle's square: the smaller side of the panel. */
  size: number;
  /** The centre of the square; the field is drawn relative to it. */
  centre: Point;
  radius: number;
  innerRadius: number;
  outerRadius: number;
  codeFontPx: number;
  /** Our code's and the rejoin place's font, one px above the codes'. */
  boldFontPx: number;
  /** The ghost letters' font. */
  ghostFontPx: number;
  labelWidth: number;
  ghostTextRadius: number;
  /** The gaps line's offset below the rejoin place. */
  gapsDy: number;
  /** Car codes drawn (full only). */
  codes: boolean;
  /** The current ghost's gaps drawn (full only). */
  gaps: boolean;
  /** Our car's dot at the top of the ring and its code's point below it. */
  own: { dot: Point; label: Point };
};

/** The layout of a circle in a panel of `px`, in `mode`, at the theme's font size. */
export function circleLayout(px: { width: number; height: number }, mode: string, fontPx: number): CircleLayout {
  const full = mode === 'full';
  const size = Math.min(px.width, px.height);
  const radius = size * RING_SHARE;
  const codeFontPx = full ? fontPx - 2 : fontPx - 4;
  const dot = polarOf(0, 1, radius);
  return {
    size,
    centre: { x: size / 2, y: size / 2 },
    radius,
    innerRadius: radius + INNER_LABEL_PX,
    outerRadius: radius + OUTER_LABEL_PX,
    codeFontPx,
    boldFontPx: codeFontPx + 1,
    ghostFontPx: fontPx - 5,
    labelWidth: CODE_CHARS * codeFontPx * MONO_ADVANCE + LABEL_AIR_PX,
    ghostTextRadius: radius - (full ? GHOST_TEXT_FULL_PX : GHOST_TEXT_COMPACT_PX),
    gapsDy: GAPS_LINE_PX,
    codes: full,
    gaps: full,
    own: { dot, label: { x: dot.x, y: dot.y + OWN_LABEL_PX } },
  };
}
