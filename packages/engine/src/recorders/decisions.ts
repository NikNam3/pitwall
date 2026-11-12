// The decision recorder (contract C10, C22, C26, C76; spec 3.4): a decision the user committed enters the engine with the
// frame it was committed at (`RecorderInput.decisions`), and the recorder appends it as a `decisions` fact describing
// that frame. It reads nothing else and keeps no open state. A flashback voids a decision like any fact (C27a); the
// runner gives a kept frame's decisions again when a rewind replays it.
import type { Recorder } from '../step/types.ts';

export const decisionsRecorder: Recorder<Record<string, never>> = {
  id: 'decisions',
  init: () => ({}),
  apply(input, own, log, out) {
    for (const decision of input.decisions ?? []) {
      // SP4.3b Task 17: the recorder appends planCommitted and planCleared.
      if (decision.kind !== 'calibrationChosen') throw new Error('not implemented');
      log.append('decisions', { ...decision, frame: input.frameNumber });
      out.changed.add('decisions');
    }
    return own;
  },
};
