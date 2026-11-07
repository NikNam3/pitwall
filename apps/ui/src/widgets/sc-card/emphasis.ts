// The sc-card's emphasis (C68): the condition that is out is named in the warning role; its row is white (bold in the
// display). Nothing else takes a role.
import type { Role } from '../../theme/roles.ts';

/** The role of the condition that is out, named in the header. */
export function stateRole(): Role {
  return 'warning';
}

/** The row of the condition that is out is white; every other row keeps the inherited colour. */
export function rowRole(active: boolean): Role | undefined {
  return active ? 'text' : undefined;
}
