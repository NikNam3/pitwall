// Wording of the stint-scatter display; text shared with the kit lives in kit/text.ts.
import type { StintFit } from '@pitwall/domain';
import type { AxisLabel } from '../../kit/chart/labels.ts';
import { formatLapNumber } from '../../kit/values/format.ts';

/** The x axis' label forms, longest first. */
export const xLabel: AxisLabel = ['tyre age, laps', 'tyre age'];
/** The y axis' label forms: fuel-corrected lap times, or the raw ones of a stint fitted without the correction. */
export const yLabel = (fuelCorrected: boolean): AxisLabel => (fuelCorrected ? ['fuel-corrected lap', 'corrected lap'] : ['lap time', 'lap']);
/** Compact drops the axis titles (mockup README). */
export const noAxisLabel: AxisLabel = [''];

/** The line naming what the current stint's fit runs on. */
export const basis = { wear: 'basis wear', age: 'basis age' } as const satisfies Record<StintFit['basis'], string>;
/** Before the mark of a fit that is not known. */
export const fitUnknown = 'fit';

/** Headers of the compounds table by column key. */
export const compoundHeaders = { cmp: 'CMP', toSoft: 'TO SOFT', degPerLap: 'DEG/LAP', sd: 'SD', source: 'SOURCE' } as const;

/**
 * A stint's fit label: the compound letter, the first lap as `L01`, an en dash and the last lap in two digits for a closed
 * stint, nothing for the current one (`S L01–15`, `M L16–`).
 */
export const stintLabel = (letter: string, firstLap: number, lastLap: number | undefined): string =>
  `${letter} ${formatLapNumber(firstLap, 2)}–${lastLap === undefined ? '' : formatLapNumber(lastLap, 2).slice(1)}`;
