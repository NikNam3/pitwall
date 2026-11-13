// STUB (test phase, SP4.3b2 Task 12): the shape the tests assume of the strategy chart's geometry; every function throws
// `not implemented` until the implement phase writes it.
import type { McRow } from '@pitwall/domain';
import type { Role } from '../../theme/index.ts';

const notImplemented = (): never => {
  throw new Error('not implemented');
};

/** The chart's drawing box in px. */
export type Box = { width: number; height: number };
/** One policy's line: its points (P1 … Pn), role, width, dotted, whether its points are drawn. */
export type Line = { points: [number, number][]; role: Role; widthPx: number; dotted: boolean; dots: boolean };
/** The faint vertical at our place now, and the E[pos] tick of the highlighted row (null without a highlight). */
export type Marks = { now: { x: number; role: Role }; tick: { x: number; role: Role } | null };
export type ChartState = { highlight: number | null };

export const chartLines = (_rows: readonly McRow[], _state: ChartState, _box: Box): Line[] => notImplemented();
export const chartMarks = (_rows: readonly McRow[], _state: ChartState, _box: Box, _currentPosition: number): Marks => notImplemented();
