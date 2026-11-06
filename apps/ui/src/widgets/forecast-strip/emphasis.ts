// The forecast strip's emphasis (C68): only the first rain sample is highlighted; labels faint, the accuracy note dim.
import type { Role } from '../../theme/roles.ts';

/** The first rain sample (the topic's `firstRainIndex`, C43) white bold; every other sample in the text colour. */
export function firstRainRole(firstRain: boolean): Role | undefined {
  return firstRain ? 'ownCar' : undefined;
}

/** The row labels and the minutes row. */
export const labelRole: Role = 'textFaint';

/** The accuracy note. */
export const noteRole: Role = 'textDim';
