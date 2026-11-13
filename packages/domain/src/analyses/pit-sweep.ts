// Value types of the `pit-sweep` analysis (SP4.3b spec §9.2): per compound with a new set and per stop lap L from now,
// "box at L onto the compound, then the DP's best continuation", scored to the flag.
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { NoiseCompound } from './driver-noise.ts';

/** One stop lap's row; `inWindow`: within the tie test of the best row; `pastLife`: the stint exceeds the compound's life. */
export type PitSweepRow = {
  stopLap: number;
  rejoinPosition: Known<number>;
  traffic: Known<number>;
  ePos: number;
  positionPmf: number[];
  pGain: number;
  meanMs: number;
  pastLife: Known<boolean>;
  inWindow: boolean;
};

/** One compound's sweep. */
export type PitSweepTable = { compound: NoiseCompound; rows: PitSweepRow[]; scenarios: number };

/** The job's output per car: the compound `auto` resolves to and one table per compound swept. */
export type PitSweepCar = { carId: CarId; lap: number; position: number; auto: Known<NoiseCompound>; byCompound: Partial<Record<NoiseCompound, Known<PitSweepTable>>> };

/**
 * `pitSweep.car`: the selected table. `compound` is the swept compound; `'auto'` only while `auto` is unknown (then
 * `table` carries auto's reason).
 */
export type PitSweep = { carId: CarId; lap: number; position: number; compound: NoiseCompound | 'auto'; fromAuto: boolean; table: Known<PitSweepTable> };
