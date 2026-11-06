// `pit-losses` (spec 4.3, 4.4, 5): publishes `pitLosses.track`. Every judgement (each condition's blend, source and parts,
// each stop's loss and use) is `pit-loss`'s (C43); this analysis carries its output to the topic as it is.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { PIT_LOSS, type PitLossOutput } from '../pit-loss/index.ts';
import { PIT_LOSSES, type PitLossesOutput } from './index.ts';

export const pitLossesCalculator: QuickCalculator<PitLossesOutput> = {
  id: PIT_LOSSES,
  kind: 'quick',
  reads: [{ calculator: PIT_LOSS }],
  cadence: 'frame',
  compute: (view) => {
    const upstream = view.outputs.get(PIT_LOSS) as PitLossOutput | undefined;
    // The scheduler runs `pit-loss` first and skips this analysis when it failed (C48): a missing output is a bug.
    if (upstream === undefined) throw new Error(`${PIT_LOSSES}: no output of ${PIT_LOSS}`);
    return upstream;
  },
};
