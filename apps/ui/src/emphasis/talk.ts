import type { Role } from '../theme/roles.ts';

/** The role of the talk window: grey while clear, amber while busy. */
export const talkRole = (_talk: 'clear' | 'busy'): Role => {
  throw new Error('not implemented');
};
