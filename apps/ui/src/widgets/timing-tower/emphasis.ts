import type { IncidentEntry, Known, RaceMoment, SectorStatus } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';
import { sectorStatusRole } from '../../emphasis/index.ts';
import { presentation } from './presentation.ts';

/** The feed entry the incident moment is about (its cause names it, `entryId`); none in any other moment. */
export function momentIncident(moment: Known<RaceMoment> | undefined, incidents: readonly IncidentEntry[] | undefined): IncidentEntry | undefined {
  if (moment?.known !== true || moment.value.moment !== 'incident') return undefined;
  const id = moment.value.cause.params['entryId'];
  return incidents?.find((e) => e.id === id);
}

/** The left bar of a car of the incident the incident moment names: the incident row's emphasis (`presentation.ts`). */
export const incidentRole = (involved: boolean): Role | undefined => (involved ? presentation.moments.incident.emphasis : undefined);

/**
 * The PEN cell is amber while the car has a penalty to serve: a time penalty (`penaltyMs`), or `unserved` drive-throughs
 * or stop-gos (the count the cell shows); warnings alone stay neutral.
 */
export const penaltyRole = (penaltyMs: number, unserved: number): Role | undefined => (penaltyMs > 0 || unserved > 0 ? 'warning' : undefined);

/** A sector's role: an older sector (of an earlier lap) is faint with no best colour; else its status's role. */
export const sectorRole = (status: SectorStatus, older: boolean, ours: boolean): Role | undefined =>
  older ? 'textFaint' : sectorStatusRole(status, { ours });
