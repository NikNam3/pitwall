// A lap's tyre type (spec 3.4): what `crossover` groups the field's laps by.
import type { ActualCompound, TyreType } from '@pitwall/domain';

/** `inter` → inter; `wet`, `classicWet`, `f2Wet` → wet; `unknown` → undefined (the lap has no type, C3); every other → slick. */
export function tyreTypeOf(compound: ActualCompound): TyreType | undefined {
  switch (compound) {
    case 'inter':
      return 'inter';
    case 'wet':
    case 'classicWet':
    case 'f2Wet':
      return 'wet';
    case 'unknown':
      return undefined;
    default:
      return 'slick';
  }
}
