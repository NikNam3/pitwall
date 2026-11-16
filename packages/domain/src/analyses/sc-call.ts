// Value types of the `sc-call` analysis (SP4.3d spec §6.3): per condition SC, VSC and green (the out condition alone while
// one is out), staying out against boxing onto each compound now.
import type { EstimateSource } from '../estimates.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

/** An answer of the SC call: stay out, or box onto a compound (S, M, H, I, W). */
export type ScCallAnswer = 'stay' | 'S' | 'M' | 'H' | 'I' | 'W';

/** One answer's outcome; every `Known` is `unknown('noSet')` where no set is left for it. */
export type ScCallOption = {
  answer: ScCallAnswer;
  ePos: Known<number>;
  se: Known<number>;
  ePosDelta: Known<number>;
  pGain: Known<number>;
  rejoinPosition: Known<number>;
  positionPmf: Known<number[]>;
};

/** One condition's block: its options, the stop's loss with its source, and the laps left. */
export type ScCallBlock = {
  condition: 'sc' | 'vsc' | 'green';
  options: ScCallOption[];
  lossMs: Known<Ms>;
  lossSource: EstimateSource;
  lapsLeft: Known<number>;
};

/** `scCall.car`: three blocks while green running; only the out condition's while one is out. */
export type ScCallBlocks = { carId: CarId; lap: number; out: 'sc' | 'vsc' | null; blocks: ScCallBlock[] };
