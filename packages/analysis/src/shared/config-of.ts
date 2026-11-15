// A config section's effective values (C47) from a config alone, as `defineConfig`'s `read` gives them from a view: the
// section's defaults under the config's overrides. For the readers that hold no view (as-of builds, priors and fallback
// contexts, job inputs) and for the per-frame readers that resolve a section many times a run.
import type { EngineView } from '@pitwall/engine/readers';

type Config = EngineView['config'];
type Section = { key: string; defaults: object };

/**
 * Each section's effective values per config object. A run's config is fixed and read-only (C47), so they are one
 * read-only object for the run: a pure function of the config and the section, nothing derived from the log (C32).
 */
const resolved = new WeakMap<Config, Map<Section, object>>();

/** The effective values of `section` in `holder`'s config: its defaults under the overrides of its key (read-only). */
export const configOf = <C extends object>(section: { key: string; defaults: C }, holder: { readonly config: Config }): C => {
  let bySection = resolved.get(holder.config);
  if (bySection === undefined) {
    bySection = new Map();
    resolved.set(holder.config, bySection);
  }
  let values = bySection.get(section);
  if (values === undefined) {
    values = Object.freeze({ ...section.defaults, ...holder.config[section.key] });
    bySection.set(section, values);
  }
  return values as C;
};
