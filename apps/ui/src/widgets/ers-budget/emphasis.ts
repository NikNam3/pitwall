import type { Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** White bold (`text`) for store, flow and "attack ready" only while the battle moment is current. */
export function ersRole(moment: Known<RaceMoment> | undefined): Role | undefined {
  return moment?.known && moment.value.moment === 'battle' ? 'text' : undefined;
}
