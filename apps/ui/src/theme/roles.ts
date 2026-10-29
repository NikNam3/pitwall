/** Semantic colour roles. Components name a role; only the theme knows the value. */
export type Role =
  | 'text' | 'textDim' | 'textFaint'
  | 'ownCar'
  | 'bg' | 'bgPanel' | 'bgBand' | 'bgRowBand'
  | 'border' | 'grid' | 'dropTarget'
  | 'critical' | 'warning' | 'best' | 'personalBest'
  | 'flagYellow' | 'flagGreen' | 'flagRed' | 'flagBlue'
  | 'compoundSoft' | 'compoundMedium' | 'compoundHard'
  | 'series1' | 'series2' | 'series3' | 'series4' | 'series5' | 'series6';

/** The CSS variable name a role is published under. */
export const roleVar = (r: Role): string => `--pw-${r}`;

/** The CSS reference components use as a colour value. */
export const role = (r: Role): string => `var(${roleVar(r)})`;

/** The colour of an optional role: `undefined` (no inline colour, the inherited one) when there is none. */
export const roleOrUndefined = (r: Role | undefined): string | undefined => (r === undefined ? undefined : role(r));
