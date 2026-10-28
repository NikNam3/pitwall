// Unit names (spec 3.1): kebab-case; their topics are prefixed with the camelCase form.

/** The topic prefix of a unit: `undercut-card` becomes `undercutCard`. */
export function topicPrefix(unit: string): string {
  return unit.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}
