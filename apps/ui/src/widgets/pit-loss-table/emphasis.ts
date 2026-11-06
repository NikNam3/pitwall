// The pit-loss table's emphasis (C68): a condition resting on a default is muted; a stop that does not count is faint.
import type { EstimateSource, PitLossStop } from '@pitwall/domain';
import { ourCarRole } from '../../emphasis/index.ts';
import type { Role } from '../../theme/roles.ts';

/** A condition whose loss is the track file's default is dim; a measured or calibrated one keeps the text colour. */
export function conditionRole(kind: EstimateSource['kind']): Role | undefined {
  return kind === 'default' ? 'textDim' : undefined;
}

/** A stop that does not count (no clean reference laps, a penalty served) is faint. */
export function stopRole(use: PitLossStop['use']): Role | undefined {
  return use === 'used' ? undefined : 'textFaint';
}

/** A stop's driver code: our cars take the own-car role, except on a stop that does not count, which stays faint. */
export function stopCodeRole(ours: boolean, use: PitLossStop['use']): Role | undefined {
  return use === 'used' ? ourCarRole(ours) : undefined;
}
