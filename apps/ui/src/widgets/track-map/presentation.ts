// The track map's presentation table (contract C66): every zone-flag kind to the stretch it draws over the outline.
// Test-phase stub: the implement phase fills the rows.
import type { zoneFlagsSpans } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import type { Role } from '../../theme/roles.ts';

type ZoneFlagKind = (typeof zoneFlagsSpans)['kinds'][number];

/** A zone flag's row: the role its zone's stretch is redrawn in; `undefined` draws no stretch. */
export type ZoneRow = { readonly stretch: Role | undefined };

export const presentation: PresentationTable & { situations: { 'zone-flags': Readonly<Record<ZoneFlagKind, ZoneRow>> } } = {
  situations: { 'zone-flags': {} as Readonly<Record<ZoneFlagKind, ZoneRow>> },
};
