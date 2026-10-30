import { roleVar } from './roles.ts';
import type { Role } from './roles.ts';

/** The computed value of a CSS custom property as seen from `el` (empty string when unset). */
export function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/**
 * A number token at `el`: a unitless CSS variable (e.g. `--pw-col-gap-cols`) read as a number, for code that counts or
 * draws with it; `fallback` (the default theme's value) when unset or not a number. CSS uses the length variables.
 */
export function cssNumber(el: Element, name: string, fallback: number): number {
  const v = parseFloat(cssVar(el, name));
  return Number.isFinite(v) ? v : fallback;
}

/** The resolved colour of a role at `el`: for places that cannot use `var(...)`, such as canvas and uPlot. */
export function resolveRole(el: Element, r: Role): string {
  return cssVar(el, roleVar(r));
}

/** Resolves a `var(--name)` reference to its value at `el`; any other value is returned as given. */
export function resolveColour(el: Element, value: string): string {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
  const name = m?.[1];
  return name === undefined ? value : cssVar(el, name);
}
