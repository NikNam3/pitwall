import type { IncidentEntry, Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';
import { presentation } from './presentation.ts';

/** Minor entries are dim; the major entry the current moment's cause names (`entryId`) takes its row's emphasis (`presentation.ts`). */
export function incidentRole(moment: Known<RaceMoment> | undefined, entry: IncidentEntry): Role | undefined {
  if (entry.severity === 'minor') return 'textDim';
  if (moment?.known === true && moment.value.cause.params['entryId'] === entry.id) return presentation.moments[moment.value.moment].emphasis;
  return undefined;
}
