// `gaps` (spec 6.1): every gap from the mini-sector crossings; publishes `gaps.intervals`, `gaps.toCar`, `gaps.gapper`, `gaps.neighbourhood`.
export type { GapperLines, GapperReference, GapToCar, Interval, Neighbourhood } from '@pitwall/domain';
export * from './config.ts';
export { GAPS_BEHAVIOUR, type GapsRow } from './behaviour.ts';
export type { GapsOutput } from './output.ts';
export { gapperLines } from '../shared/gapper-lines.ts';

/** The calculator id. */
export const GAPS = 'gaps';
