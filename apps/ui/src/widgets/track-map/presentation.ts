// The track map's presentation table (contract C66): every zone-flag kind (the `flag` of a `trackPositions.cars` zone)
// to the stretch it redraws over the outline, and every car state to its dot style (spec 7.2, mockup 2-map-views.html).
import type { zoneFlagsSpans } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import type { Role } from '../../theme/roles.ts';

type ZoneFlagKind = (typeof zoneFlagsSpans)['kinds'][number];

/** A zone flag's row: the role its zone's stretch is redrawn in; `undefined` draws no stretch. */
export type ZoneRow = { readonly stretch: Role | undefined };

export const presentation: PresentationTable & { situations: { 'zone-flags': Readonly<Record<ZoneFlagKind, ZoneRow>> } } = {
  situations: {
    'zone-flags': {
      noFlag: { stretch: undefined },
      green: { stretch: undefined },
      blue: { stretch: undefined },
      yellow: { stretch: 'flagYellow' },
      unknown: { stretch: undefined },
    },
  },
};

/** The roles of the map's parts: the outline, and an incident marker (amber). */
export const parts = { outline: 'textFaint', marker: 'warning' } as const satisfies Readonly<Record<string, Role>>;

/**
 * Every car state to its dot style: our cars larger than a rival (mockup: 5.5 px against 4 px); a car in the pit lane
 * hollow; a car shown blue with a side bar in `flagBlue`.
 */
export const dots = {
  ours: { radiusPx: 5.5 },
  rival: { radiusPx: 4 },
  inPit: { hollow: true },
  onTrack: { hollow: false },
  blueFlag: { bar: 'flagBlue' },
} as const satisfies {
  ours: { radiusPx: number };
  rival: { radiusPx: number };
  inPit: { hollow: boolean };
  onTrack: { hollow: boolean };
  blueFlag: { bar: Role };
};
