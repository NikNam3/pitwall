import type { IncidentEntry, Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** Minor entries are dim; in the incident moment the entry its cause names (`entryId`) is amber (warning). */
export function incidentRole(moment: Known<RaceMoment> | undefined, entry: IncidentEntry): Role | undefined {
  if (entry.severity === 'minor') return 'textDim';
  if (moment?.known === true && moment.value.moment === 'incident' && moment.value.cause.params['entryId'] === entry.id) return 'warning';
  return undefined;
}
