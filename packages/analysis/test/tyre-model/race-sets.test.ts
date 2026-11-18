// `tyre-model`'s `raceSets` (SP4.3e Task 3b, ruling R13; C8, C43): our car's sets for the next race, every set available
// now (the fitted one included) plus those reserved for it (`TyreSet.forNextRace`, step 1), each with its noise compound
// (as `usedSets` maps it) and wear; a rival's `unknown('notApplicable')`; no sets `unknown('notReceived')`.
import { NOISE_COMPOUNDS, unknown } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { tyreModelCalculator } from '../../src/tyre-model/index.ts';
import { guardedQuick } from '../situated.ts';
import { carOf, liveSets, modelView, tyreSet } from './support.ts';

const calc = guardedQuick(tyreModelCalculator);

type RaceSet = { compound: string; wearPct: number };
const sorted = (sets: readonly RaceSet[]): RaceSet[] => [...sets].sort((a, b) => a.compound.localeCompare(b.compound) || a.wearPct - b.wearPct);

describe('tyre-model: raceSets (SP4.3e Task 3b)', () => {
  it('available + fitted + forNextRace → in raceSets', () => {
    const sets = liveSets([
      tyreSet('medium', { fitted: true, wearPct: 9 }),
      tyreSet('hard', { wearPct: 3 }),
      tyreSet('soft', { available: false, forNextRace: true, recommendedSession: 15 }),
    ]);
    const out = carOf(calc.compute(modelView([{ id: 0, wearPct: 9, sets }])), 0).raceSets;
    expect(out?.known).toBe(true);
    if (out === undefined || !out.known) return;
    expect(sorted(out.value)).toEqual([
      { compound: 'hard', wearPct: 3 },
      { compound: 'medium', wearPct: 9 },
      { compound: 'soft', wearPct: 0 },
    ]);
  });

  it('a set neither available nor forNextRace → not in raceSets', () => {
    const sets = liveSets([
      tyreSet('medium', { fitted: true, wearPct: 4 }),
      tyreSet('soft', { available: false }),
      tyreSet('hard', { available: false, forNextRace: false, wearPct: 30 }),
    ]);
    const out = carOf(calc.compute(modelView([{ id: 0, wearPct: 4, sets }])), 0).raceSets;
    expect(out?.known).toBe(true);
    if (out === undefined || !out.known) return;
    expect(sorted(out.value)).toEqual([{ compound: 'medium', wearPct: 4 }]);
  });

  it('a rival → notApplicable', () => {
    const sets = liveSets([tyreSet('medium', { fitted: true }), tyreSet('hard', { available: false, forNextRace: true })]);
    const out = calc.compute(modelView([{ id: 0, sets }, { id: 1, sets }], { playerCar: 0 }));
    expect(carOf(out, 1).raceSets).toEqual(unknown('notApplicable'));
    expect(carOf(out, 0).raceSets?.known).toBe(true);
  });

  it('no sets → notReceived', () => {
    const car = carOf(calc.compute(modelView([{ id: 0, sets: liveSets([]) }])), 0);
    expect(car.raceSets).toEqual(unknown('notReceived'));
    // the other set terms say the same (unchanged)
    for (const c of NOISE_COMPOUNDS) expect(car.freshSets[c], c).toEqual(unknown('notReceived'));
  });
});
