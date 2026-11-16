// A compound's tyre type (slick, inter, wet): the one table every reader groups compounds by.
import type { TyreType } from './analyses/crossover.ts';
import type { NoiseCompound } from './analyses/driver-noise.ts';
import type { ActualCompound, VisualCompound } from './compounds.ts';

/** `inter` → inter; `wet`, `classicWet`, `f2Wet` → wet; `unknown` → undefined (no type, C3); every other → slick. */
export function tyreTypeOf(compound: NoiseCompound): TyreType;
export function tyreTypeOf(compound: ActualCompound | VisualCompound | NoiseCompound): TyreType | undefined;
export function tyreTypeOf(compound: ActualCompound | VisualCompound | NoiseCompound): TyreType | undefined {
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
