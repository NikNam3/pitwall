// The theme variant the shell applies until theme switching (spec 5) picks another at runtime.
import { THEMES, type ThemeVariant } from '../theme/index.ts';

const first = THEMES[0];
if (first === undefined) throw new Error('theme/ defines no variant');

/** The first variant of `THEMES`: the approved Task 0 look. */
export const DEFAULT_THEME: ThemeVariant = first;
