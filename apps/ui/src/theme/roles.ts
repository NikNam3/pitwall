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

/** The colour of an optional role: the `fallback` role's, or `undefined` (no inline colour, the inherited one) when there is none. */
export function roleOrUndefined(r: Role | undefined): string | undefined;
export function roleOrUndefined(r: Role | undefined, fallback: Role): string;
export function roleOrUndefined(r: Role | undefined, fallback?: Role): string | undefined {
  const chosen = r ?? fallback;
  return chosen === undefined ? undefined : role(chosen);
}
