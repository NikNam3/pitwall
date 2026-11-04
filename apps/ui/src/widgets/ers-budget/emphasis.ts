import type { Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';
import { presentation } from './presentation.ts';

/** Store, flow and "attack ready" in the current moment's row emphasis (`presentation.ts`); nothing without a moment. */
export function ersRole(moment: Known<RaceMoment> | undefined): Role | undefined {
  return moment?.known === true ? presentation.moments[moment.value.moment].emphasis : undefined;
}
