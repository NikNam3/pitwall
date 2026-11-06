// A lap's tyre type (spec 3.4). Stub: Task 5 implements it.
import type { ActualCompound, TyreType } from '@pitwall/domain';

/** `inter` → inter; `wet`, `classicWet`, `f2Wet` → wet; `unknown` → undefined (the lap has no type, C3); every other → slick. */
export function tyreTypeOf(_compound: ActualCompound): TyreType | undefined {
  throw new Error('not implemented');
}
