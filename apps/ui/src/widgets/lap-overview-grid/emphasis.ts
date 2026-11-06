// The lap overview's emphasis (C68): the heat as background, the bests, a heatless lap dim, the status strip's flag.
import type { Known, LapOverviewLap, LapStatus, Ratio } from '@pitwall/domain';
import { role, type Role } from '../../theme/roles.ts';

/** A lap cell's background: `bgBand` at heat 0 (the stint's fastest pace lap) to `textFaint` at heat 1 (its slowest),
 *  mixed in whole percent; none without heat. */
export function heatBackground(heat: Known<Ratio>): string | undefined {
  if (!heat.known) return undefined;
  return `color-mix(in srgb, ${role('textFaint')} ${Math.round(heat.value * 100)}%, ${role('bgBand')})`;
}

/** A lap time's colour: the session best, the car's best, else dim without heat, else the text colour. */
export function lapRole(lap: Pick<LapOverviewLap, 'best' | 'heat'>): Role | undefined {
  if (lap.best === 'session') return 'best';
  if (lap.best === 'personal') return 'personalBest';
  return lap.heat.known ? undefined : 'textDim';
}

/** The status strip's colour: yellow for VSC and SC, red for a red flag, none for green. */
export function statusRole(status: LapStatus): Role | undefined {
  if (status === 'red') return 'flagRed';
  return status === 'green' ? undefined : 'flagYellow';
}
