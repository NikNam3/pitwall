// Wording of the crossover-chart display; text shared with the kit lives in kit/text.ts.
import type { TyreType } from '@pitwall/domain';
import type { AxisLabel } from '../../kit/chart/labels.ts';

/** A tyre type's word: its line's label and the first faster car's type. */
export const typeNames = { slick: 'slick', inter: 'inter', wet: 'wet' } as const satisfies Record<TyreType, string>;
/** The 110 % line's label. */
export const line110Label = '110%';
/** The dry reference line's label. */
export const dryRefLabel = 'dry ref';

/** The labels of the three numbers and the words between their parts. */
export const us = 'US';
export const ofDryRef = 'of dry ref';
export const payback = 'PAYBACK';
export const firstFaster = 'FIRST FASTER';
export const on = 'on';
export const inSector = 'in';

/** The axis label forms, longest first. */
export const xLabel: AxisLabel = ['lap'];
export const yLabel: AxisLabel = ['median lap', 'median'];
