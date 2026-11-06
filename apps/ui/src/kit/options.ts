// Constructors of per-panel options (spec 4.2). Plain data; no Svelte or DOM, so Node scripts can import them.
import type { BoolOption, CarOption, CarUnset, ChoiceOption, NumberOption } from './types.ts';

/** An on/off setting. */
export function boolOption(def: boolean, label: string): BoolOption {
  return { kind: 'bool', label, default: def };
}

/** A pick-one setting; `choices` should be `as const` so the value type is the union. */
export function choiceOption<C extends string>(choices: readonly C[], def: C, label: string): ChoiceOption<C> {
  return { kind: 'choice', label, default: def, choices };
}

/** A number setting within `range`. */
export function numberOption(def: number, label: string, range: { min: number; max: number; step: number }): NumberOption {
  return { kind: 'number', label, default: def, range };
}

/** A car setting; unset (`undefined`) follows the panel's link, or, with `unset: 'none'`, is no car. */
export function carOption(label: string, opts?: { unset?: CarUnset }): CarOption {
  return { kind: 'car', label, default: undefined, unset: opts?.unset ?? 'follow' };
}
