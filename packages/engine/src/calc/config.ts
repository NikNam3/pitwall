import type { EngineView } from './types.ts';

/** A value a calculator may be configured with. */
export type ConfigValue = number | string | boolean;

/** The defaults' type with each literal widened to its primitive, so `{ warnAt: 70 }` is `{ warnAt: number }`. */
export type ConfigShape<C extends Record<string, ConfigValue>> = {
  [K in keyof C]: C[K] extends number ? number : C[K] extends string ? string : boolean;
};

/** A section of the calculator config: its key, its defaults, and how a calculator reads the effective values. */
export type ConfigKey<C extends Record<string, ConfigValue>> = {
  key: string;
  defaults: C;
  /** The view's section for `key` over the defaults, field by field; a fresh object on every call. */
  read(view: EngineView): C;
};

/**
 * Declares a config section: a feature lists it in its `config`, the engineer overrides some fields in a file, and a
 * calculator calls `read(view)` for the effective values. The config is read-only for the run.
 */
export function defineConfig<C extends Record<string, ConfigValue>>(key: string, defaults: C): ConfigKey<ConfigShape<C>> {
  const shape = defaults as ConfigShape<C>;
  return { key, defaults: shape, read: (view) => ({ ...shape, ...view.config[key] }) };
}
