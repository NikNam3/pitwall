import type { BandReading } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** Critical when the channel was out of band for a full lap; warning when out of band now; otherwise none. */
export function bandRole(reading: BandReading): Role | undefined {
  if (reading.outForFullLap) return 'critical';
  if (reading.state.known && reading.state.value !== 'in') return 'warning';
  return undefined;
}
