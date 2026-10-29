// Gallery declaration of the tyre-life-bar display (spec 9.1). Test-phase file: the implementer does not edit it.
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { CarState, TyreWear } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(100);
const corner = (wearPct: number, rate: number, laps: number) => ({
  wearPct: known(wearPct, at),
  ratePctPerLap: known(rate, at),
  lapsToLimit: known(laps, at),
});

const wear = (fl: ReturnType<typeof corner>, fr: ReturnType<typeof corner>, rl: ReturnType<typeof corner>, rr: ReturnType<typeof corner>): TyreWear => ({
  corners: { fl, fr, rl, rr },
  limitPct: 70,
  gameLifeSpanLaps: known(22, at),
});

// Only the tyres matter to this widget (compound and age in the header).
const carWith = (visualCompound: 'soft' | 'medium' | 'hard', age: number): CarState =>
  ({ id: carId(1), tyres: { actualCompound: 'C3', visualCompound, age, corners: {}, sets: unknown('notReceived') } }) as unknown as CarState;

const hiddenCorner = { wearPct: unknown('realism'), ratePctPerLap: unknown('realism'), lapsToLimit: unknown('realism') } as const;
const noRateCorner = { wearPct: known(18, at), ratePctPerLap: unknown('insufficientData'), lapsToLimit: unknown('insufficientData') } as const;

/** Synthetic cases and fit expectations for `tyre-life-bar`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceSingaporeEnd.chequered'],
  cases: {
    // Mockup: early stint, nothing lights up.
    earlyStint: {
      wear: wear(corner(18, 1.4, 37), corner(21, 1.7, 29), corner(15, 1.2, 46), corner(17, 1.3, 41)),
      car: carWith('medium', 12),
    },
    // Mockup: late stint, FR at 2 laps to the limit lights up (below the alarm threshold of 3).
    lateStint: {
      wear: wear(corner(61, 1.9, 4), corner(66, 2, 2), corner(57, 1.6, 8), corner(60, 1.7, 5)),
      car: carWith('medium', 31),
    },
    // Exactly at the threshold: not below it, nothing lights up.
    atThreshold: {
      wear: wear(corner(61, 1.9, 3), corner(66, 2, 3), corner(57, 1.6, 8), corner(60, 1.7, 5)),
      car: carWith('hard', 20),
    },
    // Rate unknown (too few laps): empty bar tail, no marker, empty rate and laps cells with the reason on hover.
    rateUnknown: {
      wear: wear(noRateCorner, noRateCorner, noRateCorner, noRateCorner),
      car: carWith('soft', 2),
    },
    // Realism mode withholds the wear: every cell empty, reason on hover.
    realismHidden: {
      wear: wear(hiddenCorner, hiddenCorner, hiddenCorner, hiddenCorner),
      car: carWith('medium', 12),
    },
    // Wear known, tyres of the car not received yet: the header shows no compound.
    noCar: {
      wear: wear(corner(18, 1.4, 37), corner(21, 1.7, 29), corner(15, 1.2, 46), corner(17, 1.3, 41)),
      car: undefined,
    },
  },
  // Compact shrinks the bar only; the columns stay.
  fit: [
    { mode: 'compact', cols: 36, rows: 5 },
    { mode: 'compact', cols: 44, rows: 6 },
    { mode: 'full', cols: 47, rows: 5 },
    { mode: 'full', cols: 60, rows: 8 },
  ],
};

export default gallery;
