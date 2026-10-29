// The words of an insight (spec 8.3): the bridge sends a kind and params, the UI formats them.
import type { Insight } from '@pitwall/domain';

/** Known kinds; the entries come with the features that raise them. */
const KINDS: Record<string, (params: Insight['params']) => string> = {};

/** The text of an insight; a kind without an entry is shown as `kind: key value, key value`. */
export function formatInsight(i: Insight): string {
  const known = KINDS[i.kind];
  if (known !== undefined) return known(i.params);
  const params = Object.entries(i.params).map(([k, v]) => `${k} ${v}`);
  return params.length === 0 ? i.kind : `${i.kind}: ${params.join(', ')}`;
}
