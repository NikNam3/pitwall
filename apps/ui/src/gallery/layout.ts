// Sizes of the gallery's own boxes; the cell sizes of the widgets come from their size modes.
import type { WidgetSize } from '../kit/types.ts';

/** Room for the browser's rounding, so a panel measures exactly `cols` x `rows` cells. */
export const SUBPIXEL_PX = 0.5;

/** The size the kit parts are drawn at. */
export const KIT_SIZE: WidgetSize = { mode: 'sample', cols: 40, rows: 8, px: { width: 400, height: 200 }, dpr: 1 };
