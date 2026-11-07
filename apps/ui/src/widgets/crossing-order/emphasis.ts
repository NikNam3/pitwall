// The crossing order's emphasis (C68): the title of the condition that is out is white (with bold); our cars take the
// own-car role, except in the ghost row, which stays in the ghost's role (kit GhostRow).
import { ourCarRole } from '../../emphasis/index.ts';
import type { Role } from '../../theme/roles.ts';

/** A block's title: white while its condition is out; the inherited colour otherwise. */
export function titleRole(active: boolean): Role | undefined {
  return active ? 'text' : undefined;
}

/** An order row: our cars in the own-car role; the ghost row keeps the ghost's role. */
export function rowRole(ours: boolean, ghost: boolean): Role | undefined {
  return ghost ? undefined : ourCarRole(ours);
}
