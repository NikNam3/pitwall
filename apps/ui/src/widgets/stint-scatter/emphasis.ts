// The stint scatter's emphasis (C68): state to theme role.
import type { EstimateSource, LapUse } from '@pitwall/domain';
import type { Role } from '../../theme/index.ts';

/** The current stint in the own-car role, an earlier one dim (the approved mockup). */
export const stintRole = (current: boolean): Role => (current ? 'ownCar' : 'textDim');

/** An excluded lap is faint whatever its stint; a used or down-weighted lap takes its stint's role. */
export const lapRole = (use: LapUse, stint: Role): Role => (typeof use === 'object' ? 'textFaint' : stint);

/** A compound whose prior is a default is muted; session and calibration rows stay plain. */
export const compoundRole = (kind: EstimateSource['kind']): Role | undefined => (kind === 'default' ? 'textDim' : undefined);
