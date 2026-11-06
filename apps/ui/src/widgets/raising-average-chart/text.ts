// Wording of the raising-average-chart display; text shared with the kit lives in kit/text.ts.
import type { AxisLabel } from '../../kit/chart/labels.ts';

/** The panel title. */
export const title = 'Raising average';

/** The label of the option naming the `n`th rival. */
export const rivalLabel = (n: number): string => `Rival ${n}`;

/** The axis labels of the full chart. */
export const xLabel: AxisLabel = ['best n laps'];
export const yLabel: AxisLabel = ['mean lap'];
/** Compact drops the axis titles. */
export const noAxisLabel: AxisLabel = [''];
