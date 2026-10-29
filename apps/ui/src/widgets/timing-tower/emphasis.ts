import type { Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** The amber left bar: a car of the newest major incident, only while the incident moment is the current one. */
export function incidentRole(moment: Known<RaceMoment> | undefined, involved: boolean): Role | undefined {
  return involved && moment?.known === true && moment.value.moment === 'incident' ? 'warning' : undefined;
}
