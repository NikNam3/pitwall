// A compound's tyre type, one table (SP4.3c Task 1, spec §5.3): `tyreTypeOf` moves to `domain/src/tyre-type.ts`;
// `analysis/src/crossover/tyre-type.ts`, `lap-model/index.ts`'s `TYRE_TYPE` and `race-monte-carlo/rivals.ts`'s
// `TYPE_OF` are deleted. Its readers pass a noise compound (lap-model, race-monte-carlo), a visual compound, or a
// lap's or stint's actual compound (crossover, driver-noise): the case table of `crossover.test.ts` is ported here.
// `unknown` has no type (C3). Belongs in `packages/domain/test/tyre-type.test.ts` (this worker's hooks could not
// write `packages/domain/test`).
import { describe, expect, it } from 'vitest';
import { tyreTypeOf, type ActualCompound, type NoiseCompound, type TyreType, type VisualCompound } from '@pitwall/domain';

describe('tyreTypeOf', () => {
  it('a noise compound: soft, medium, hard → slick; inter → inter; wet → wet', () => {
    const cases: Record<NoiseCompound, TyreType> = { soft: 'slick', medium: 'slick', hard: 'slick', inter: 'inter', wet: 'wet' };
    for (const [compound, type] of Object.entries(cases)) expect([compound, tyreTypeOf(compound as NoiseCompound)]).toEqual([compound, type]);
  });

  it('a visual compound: every slick (soft, medium, hard, superSoft) → slick; inter → inter; wet → wet; unknown → undefined', () => {
    const cases: Record<VisualCompound, TyreType | undefined> = {
      soft: 'slick',
      medium: 'slick',
      hard: 'slick',
      superSoft: 'slick',
      inter: 'inter',
      wet: 'wet',
      unknown: undefined,
    };
    for (const [compound, type] of Object.entries(cases)) expect([compound, tyreTypeOf(compound as VisualCompound)]).toEqual([compound, type]);
  });

  it('an actual compound: inter → inter; wet, classicWet, f2Wet → wet; unknown → undefined; every other → slick', () => {
    const cases: Record<ActualCompound, TyreType | undefined> = {
      C0: 'slick',
      C1: 'slick',
      C2: 'slick',
      C3: 'slick',
      C4: 'slick',
      C5: 'slick',
      C6: 'slick',
      inter: 'inter',
      wet: 'wet',
      classicDry: 'slick',
      classicWet: 'wet',
      f2SuperSoft: 'slick',
      f2Soft: 'slick',
      f2Medium: 'slick',
      f2Hard: 'slick',
      f2Wet: 'wet',
      unknown: undefined,
    };
    for (const [compound, type] of Object.entries(cases)) expect([compound, tyreTypeOf(compound as ActualCompound)]).toEqual([compound, type]);
  });
});
