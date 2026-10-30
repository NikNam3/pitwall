// Gallery declaration of the fuel-gauge display (spec 9.1). Test-phase file: the implementer does not edit it.
import type { FuelState } from '@pitwall/domain';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(100);

const positive: FuelState = {
  kg: known(31.4, at),
  burnKgPerLap: known(1.62, at),
  lapsOfFuel: known(19.4, at),
  lapsLeft: known(17.6, at),
  marginLaps: known(1.8, at),
  saveTargetKgPerLap: unknown('notApplicable'),
  gameRemainingLaps: known(1.6, at),
  mix: known('standard', at),
};

/** Synthetic cases and fit expectations for `fuel-gauge`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceZandvoortLap10.crossing', 'raceSingaporeStart.grid'],
  cases: {
    // Emphasis state: margin below zero (red), the save target shown.
    marginNegative: {
      fuel: {
        ...positive,
        kg: known(26.2, at),
        burnKgPerLap: known(1.71, at),
        lapsOfFuel: known(15.3, at),
        lapsLeft: known(16, at),
        marginLaps: known(-0.7, at),
        saveTargetKgPerLap: known(0.07, at),
        gameRemainingLaps: known(-0.4, at),
      },
    },
    marginPositive: { fuel: positive },
    // Realism hides the fuel figures: every row is an empty cell with the reason on hover.
    realismHidden: {
      fuel: {
        kg: unknown('realism'),
        burnKgPerLap: unknown('realism'),
        lapsOfFuel: unknown('realism'),
        lapsLeft: unknown('realism'),
        marginLaps: unknown('realism'),
        saveTargetKgPerLap: unknown('realism'),
        gameRemainingLaps: unknown('realism'),
        mix: unknown('realism'),
      },
    },
    // Not enough laps yet to know the burn.
    burnUnknown: {
      fuel: {
        ...positive,
        burnKgPerLap: unknown('insufficientData'),
        lapsOfFuel: unknown('insufficientData'),
        marginLaps: unknown('insufficientData'),
      },
    },
  },
  fit: [
    { mode: 'compact', cols: 30, rows: 2 },
    { mode: 'compact', cols: 40, rows: 5 },
    { mode: 'full', cols: 30, rows: 6 },
    { mode: 'full', cols: 44, rows: 10 },
  ],
};

export default gallery;
