import type { QuickCalculator } from '@pitwall/engine/readers';
import { TALK_WINDOW } from './index.ts';
import type { TalkWindowOutput } from './index.ts';

/** Whether each of our cars is in or just before a braking zone (stub: the implement phase fills it). */
export const talkWindowCalculator: QuickCalculator<TalkWindowOutput> = {
  id: TALK_WINDOW,
  kind: 'quick',
  reads: ['timing', 'dynamics', 'session', 'spans:car-location'],
  cadence: 'frame',
  compute: (): TalkWindowOutput => {
    throw new Error('not implemented');
  },
};
