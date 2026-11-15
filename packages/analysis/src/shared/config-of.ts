// A config section's effective values (C47) from a config alone, as `defineConfig`'s `read` gives them from a view: the
// section's defaults under the config's overrides. For the readers that hold no view: as-of builds, priors and fallback
// contexts, and job inputs.
import type { EngineView } from '@pitwall/engine/readers';

/** The effective values of `section` in `holder`'s config: its defaults under the overrides of its key. */
export const configOf = <C extends object>(section: { key: string; defaults: C }, holder: { readonly config: EngineView['config'] }): C =>
  ({ ...section.defaults, ...holder.config[section.key] }) as C;
