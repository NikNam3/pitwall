import type { BandReading, BandState, Known } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

const out = (state: Known<BandState>): boolean => state.known && state.value !== 'in';

/**
 * Critical when the channel was out of band for a full lap; warning when out of band now or on the judged lap
 * (`lapState`, the band advisory's judgement); otherwise none.
 */
export function bandRole(reading: BandReading): Role | undefined {
  if (reading.outForFullLap) return 'critical';
  if (out(reading.state) || out(reading.lapState)) return 'warning';
  return undefined;
}
