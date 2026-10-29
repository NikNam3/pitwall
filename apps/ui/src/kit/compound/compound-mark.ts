// The letter and role of a compound; the one source for the mark and for text that names a compound.
import type { VisualCompound } from '@pitwall/domain';
import type { Role } from '../../theme/index.ts';

/** The letter and colour role of each compound. */
export const COMPOUND_MARK: Record<VisualCompound, { letter: string; role: Role }> = {
  soft: { letter: 'S', role: 'compoundSoft' },
  medium: { letter: 'M', role: 'compoundMedium' },
  hard: { letter: 'H', role: 'compoundHard' },
  superSoft: { letter: 'SS', role: 'textFaint' },
  inter: { letter: 'I', role: 'textFaint' },
  wet: { letter: 'W', role: 'textFaint' },
  unknown: { letter: '?', role: 'textFaint' },
};

/** Compound letter then age, `medium`, `12` -> `M12`. */
export const compoundText = (compound: VisualCompound, age: number): string => `${COMPOUND_MARK[compound].letter}${age}`;
