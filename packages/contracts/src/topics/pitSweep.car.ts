// One of our cars' pit sweep for one compound (SP4.3b spec §9.2): per stop lap from now, "box at L onto the compound,
// then the DP's best continuation", to the flag; `auto` is the compound `pit-window` names; a job's result (C51).
import type { CarId, NoiseCompound, PitSweep } from '@pitwall/domain';
import type { Computed } from '../computed.ts';
import { defineTopic } from '../topic-def.ts';

/** Our car and the compound swept (`auto`: the one `pit-sweep` resolves from `pit-window`). */
export type PitSweepParams = { carId: CarId; compound: 'auto' | NoiseCompound };

export default defineTopic<PitSweepParams, Computed<PitSweep>>({
  owner: 'pit-sweep',
  mode: 'state',
  maxHz: 1,
  momentParams: (ids) => ids.map((carId) => ({ carId, compound: 'auto' })),
});
