// Defaults of `crossover` (spec 3.4, 8).
import { defineConfig } from '@pitwall/engine/readers';

export const CROSSOVER_CONFIG = defineConfig('crossover', {
  /** The crossover line as a ratio of the dry reference. Source: Pirelli crossover rule (V19). */
  line110: 1.1,
  /** Laps of a type on a lap number needed for its median. Source: pitwall estimate: the first car on a type is the signal. */
  minCars: 1,
});
