// Wording and glyphs of the lap-overview-grid display; text shared with the kit lives in kit/text.ts.
import type { LapOverviewLap, LapStatus } from '@pitwall/domain';

/** A stint's title, `1`, `S` -> `STINT 1 · S`. */
export const stintTitle = (stint: number, letter: string): string => `STINT ${stint} · ${letter}`;
/** The mark after a lap time: in-lap, out-lap, none. */
export const lapMark = { in: 'i', out: 'o', normal: '' } as const satisfies Record<LapOverviewLap['kind'], string>;
/** The status strip's text under a lap; nothing for green. */
export const statusStrip = { green: '', vsc: 'VSC', sc: 'SC', red: 'red' } as const satisfies Record<LapStatus, string>;
/** The compact strip's glyph under a lap that is not green. */
export const compactStrip = '━';
/** The compact blocks, lowest heat first. */
export const heatBlocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
/** The compact cell of a lap without heat. */
export const noHeatBlock = '·';
/** Between the compact label's compound letter and its lap range. */
export const compactLabelGap = '  ';
