import type { Role } from '../theme/roles.ts';

/** The role of the talk window: grey while clear, amber while busy (colour only where it warns). */
export const talkRole = (talk: 'clear' | 'busy'): Role => (talk === 'busy' ? 'warning' : 'textDim');
