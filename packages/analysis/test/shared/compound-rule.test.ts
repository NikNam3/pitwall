// The compound rule's one judgement (SP4.3b Task 11d, contract C43): whether a car still owes a stop for a second dry
// compound. The compound-rule sub-machine holds `required` for the whole dry race (the rule applies); whether the car has
// met it, by running two distinct dry compounds in its closed stints and its current set, is this shared helper's.
import { carId, type StintRecord, type VisualCompound } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { dryCompoundsUsed, owesSecondDryCompound } from '../../src/shared/compound-rule.ts';

const ACTUAL = { soft: 'C3', medium: 'C2', hard: 'C1', inter: 'inter', wet: 'wet' } as const;

/** A closed stint of `car` on `compound`. */
const stint = (compound: VisualCompound, car = 0, firstLap = 1, lastLap = 10): StintRecord => ({
  carId: carId(car),
  firstLap,
  lastLap,
  actualCompound: ACTUAL[compound as keyof typeof ACTUAL],
  visualCompound: compound,
  tyreAgeAtFitting: 0,
  frame: lastLap * 20,
});

const sorted = (used: Iterable<string>): string[] => [...used].sort();

describe('shared compound rule (SP4.3b Task 11d, row 5)', () => {
  it('row 5: the shared helper: inter or wet sets do not count as dry compounds; the current set counts', () => {
    // inters, then softs, now on wets: one dry compound
    expect(sorted(dryCompoundsUsed({ stints: [stint('inter'), stint('soft', 0, 11, 20)] }, carId(0), 'wet'))).toEqual(['soft']);
    // softs, now on mediums: the current set counts
    expect(sorted(dryCompoundsUsed({ stints: [stint('soft')] }, carId(0), 'medium'))).toEqual(['medium', 'soft']);
    // the same compound twice is one
    expect(sorted(dryCompoundsUsed({ stints: [stint('medium')] }, carId(0), 'medium'))).toEqual(['medium']);
    // no stint, no set (before the first lap, on an in lap): none
    expect(sorted(dryCompoundsUsed({ stints: [] }, carId(0)))).toEqual([]);
    // another car's stints are not the car's
    expect(sorted(dryCompoundsUsed({ stints: [stint('hard', 1)] }, carId(0), 'soft'))).toEqual(['soft']);
  });

  it('a car owes a stop while the rule is required and it has used fewer than two dry compounds', () => {
    expect(owesSecondDryCompound('required', { stints: [stint('soft')] }, carId(0), 'soft')).toBe(true);
    expect(owesSecondDryCompound('required', { stints: [stint('soft')] }, carId(0), 'medium')).toBe(false);
    expect(owesSecondDryCompound('required', { stints: [] }, carId(0), 'hard')).toBe(true);
    // inters then softs: one dry compound, the rule (still required: the inters were fitted before the lights out) is owed
    expect(owesSecondDryCompound('required', { stints: [stint('inter')] }, carId(0), 'soft')).toBe(true);
    // another car's stints do not meet the car's rule
    expect(owesSecondDryCompound('required', { stints: [stint('medium', 1)] }, carId(0), 'soft')).toBe(true);
    // a waived rule is never owed
    expect(owesSecondDryCompound('waived', { stints: [] }, carId(0), 'soft')).toBe(false);
  });
});
