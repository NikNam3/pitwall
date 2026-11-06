// The crossover chart's emphasis (C68): tyre types are told apart by colour, the one place colour distinguishes here;
// the 110 % line is dim, the dry reference faint.
import type { TyreType } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

const TYPE_ROLES = { slick: 'textDim', inter: 'series3', wet: 'series1' } as const satisfies Record<TyreType, Role>;

/** A tyre type's colour: its median line and its word. */
export const typeRole = (type: TyreType): Role => TYPE_ROLES[type];

/** The reference lines' colours. */
export const referenceRole = { line110: 'textDim', dryRef: 'textFaint' } as const satisfies { line110: Role; dryRef: Role };
