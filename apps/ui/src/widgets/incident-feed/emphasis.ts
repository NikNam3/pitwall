import type { IncidentEntry, Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** Minor entries are dim; in the incident moment the newest major entry is amber (warning). */
export function incidentRole(moment: Known<RaceMoment> | undefined, entry: IncidentEntry, newestMajorId: string | undefined): Role | undefined {
  if (entry.severity === 'minor') return 'textDim';
  if (moment?.known && moment.value.moment === 'incident' && entry.id === newestMajorId) return 'warning';
  return undefined;
}
