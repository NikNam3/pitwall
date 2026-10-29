import type { IncidentEntry, Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** The feed entry the incident moment is about (its cause names it, `entryId`); none in any other moment. */
export function momentIncident(moment: Known<RaceMoment> | undefined, incidents: readonly IncidentEntry[] | undefined): IncidentEntry | undefined {
  if (moment?.known !== true || moment.value.moment !== 'incident') return undefined;
  const id = moment.value.cause.params['entryId'];
  return incidents?.find((e) => e.id === id);
}

/** The amber left bar: a car of the incident the incident moment names. */
export const incidentRole = (involved: boolean): Role | undefined => (involved ? 'warning' : undefined);
