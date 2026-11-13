// The decision recorder (contract C10, C22, C26, C76; spec 3.4): a decision the user committed enters the engine with the
// frame it was committed at (`RecorderInput.decisions`), and the recorder appends it as a `decisions` fact describing
// that frame. It reads nothing else and keeps no open state. A flashback voids a decision like any fact (C27a); the
// runner gives a kept frame's decisions again when a rewind replays it.
import type { DecisionRecord } from '@pitwall/domain';
import type { Recorder } from '../step/types.ts';

export const decisionsRecorder: Recorder<Record<string, never>> = {
  id: 'decisions',
  init: () => ({}),
  apply(input, own, log, out) {
    for (const decision of input.decisions ?? []) {
      // calibrationChosen, planCommitted (its policy whole, SP4.3b spec §8.2) and planCleared alike. The input is
      // read-only; the log keeps the fact read-only too (C24), so the copy is the decision as given.
      log.append('decisions', { ...decision, frame: input.frameNumber } as DecisionRecord);
      out.changed.add('decisions');
    }
    return own;
  },
};
