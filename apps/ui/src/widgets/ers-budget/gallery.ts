// Gallery declaration of the ers-budget display (spec 9.1). Test-phase file: the implementer does not edit it.
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { ErsState, RaceMoment } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(900);
const MJ = 1_000_000;

/** Below the attack level (2.5 MJ of 4.0), rising, harvesting now: "attack in 2 laps". */
const base: ErsState = {
  storeJ: known(1.9 * MJ, at),
  capacityJ: 4 * MJ,
  deployedThisLapJ: known(2.1 * MJ, at),
  deployLimitJ: 4 * MJ,
  harvestedThisLapJ: known(1.3 * MJ, at),
  storeTrendJPerLap: known(0.4 * MJ, at),
  attackLevelJ: 2.5 * MJ,
  attack: known({ ready: false, inLaps: 2 }, at),
  mode: known('medium', at),
  flow: known('harvesting', at),
};

const battle: RaceMoment = {
  moment: 'battle', since: unknown('notApplicable'), cause: { rule: 'battleLaps', params: {} }, active: ['battle'],
};
const carCare: RaceMoment = { ...battle, moment: 'carCare', active: ['carCare'] };

/** Above the attack level, falling, deploying now: "attack ready". */
const attackReady: ErsState = {
  ...base,
  storeJ: known(2.9 * MJ, at),
  storeTrendJPerLap: known(-0.3 * MJ, at),
  attack: known({ ready: true }, at),
  flow: known('deploying', at),
};

/** Synthetic cases and fit expectations for `ers-budget`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceSingaporeStart.grid', 'raceZandvoortLap10.crossing'],
  cases: {
    // Battle moment: store, flow and "attack ready" white bold.
    battleMoment: { ers: attackReady, moment: known(battle, at) },
    belowLevelRising: { ers: base, moment: undefined },
    attackReadyDeploying: { ers: attackReady, moment: known(carCare, at) },
    // Falling below the level: the attack text is empty.
    fallingBelowLevel: { ers: { ...base, storeTrendJPerLap: known(-0.2 * MJ, at), attack: unknown('notApplicable'), flow: known('idle', at) }, moment: undefined },
    // Without raceMoment.current nothing lights up.
    noMoment: { ers: attackReady, moment: undefined },
    // Realism hides a rival's ERS (the car's values are restricted); the cells are empty with the reason on hover.
    realismHidden: {
      ers: {
        ...base,
        storeJ: unknown('realism'),
        deployedThisLapJ: unknown('realism'),
        harvestedThisLapJ: unknown('realism'),
        storeTrendJPerLap: unknown('realism'),
        attack: unknown('realism'),
        mode: unknown('realism'),
        flow: unknown('realism'),
      },
      moment: known(battle, at),
    },
  },
  fit: [
    { mode: 'compact', cols: 32, rows: 2 },
    { mode: 'compact', cols: 49, rows: 3 },
    { mode: 'full', cols: 50, rows: 4 },
    { mode: 'full', cols: 64, rows: 6 },
  ],
};

export default gallery;
