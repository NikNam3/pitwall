// Constructors of per-panel options (spec 4.2). Plain data; no Svelte or DOM, so Node scripts can import them.
import type { CarRef } from '@pitwall/contracts';
import type { OptionDecl } from './types.ts';

/** An on/off setting. */
export function boolOption(def: boolean, label: string): OptionDecl<boolean> {
  return { kind: 'bool', label, default: def };
}

/** A pick-one setting; `choices` should be `as const` so the value type is the union. */
export function choiceOption<C extends string>(choices: readonly C[], def: C, label: string): OptionDecl<C> {
  return { kind: 'choice', label, default: def, choices };
}

/** A number setting within `range`. */
export function numberOption(def: number, label: string, range: { min: number; max: number; step: number }): OptionDecl<number> {
  return { kind: 'number', label, default: def, range };
}

/** A car setting; `undefined` means "follow the panel's link". */
export function carOption(label: string): OptionDecl<CarRef | undefined> {
  return { kind: 'car', label, default: undefined };
}
