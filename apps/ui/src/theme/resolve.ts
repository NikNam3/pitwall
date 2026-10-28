import { roleVar } from './roles.ts';
import type { Role } from './roles.ts';

/** The computed value of a CSS custom property as seen from `el` (empty string when unset). */
export function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
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
