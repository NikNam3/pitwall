// `pit-window` (SP4.2 spec 3.4): publishes `pitWindow.car`: the fitted set's latest stop lap and each compound's window.
import type { CarId, Known, PitWindow } from '@pitwall/domain';

export type { PitWindow, PitWindowSet, PitWindowState } from '@pitwall/domain';
export { PIT_WINDOW_BEHAVIOUR, type PitWindowEffect } from './behaviour.ts';
export * from './config.ts';

/** The analysis id. */
export const PIT_WINDOW = 'pit-window';

/** The output: per our car its `pitWindow.car` value; a rival is absent (`notApplicable` through the binding). */
export type PitWindowOutput = Record<CarId, Known<PitWindow>>;
