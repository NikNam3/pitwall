/** The inspector component, loaded only in dev builds: in production the condition is false and the import is dropped with its chunk. */
export const loadInspector = import.meta.env.DEV ? () => import('./Inspector.svelte') : undefined;
