import { describe, expect, it } from 'vitest';
import { endsQualifying, raceFormatOf, type QualifyingFormat, type WeekendPhase } from '../src/index.ts';

describe('raceFormatOf (SP4.3d spec §7.0 rule 5)', () => {
  it.each<[QualifyingFormat, 'grandPrix' | 'sprint']>([
    ['grandPrix', 'grandPrix'],
    ['short', 'grandPrix'],
    ['oneShot', 'grandPrix'],
    ['sprintShootout', 'sprint'],
    ['shortSprintShootout', 'sprint'],
    ['oneShotSprintShootout', 'sprint'],
  ])('%s plans the %s', (format, race) => {
    expect(raceFormatOf(format)).toBe(race);
  });
});

describe('endsQualifying', () => {
  it.each<[string, WeekendPhase, boolean]>([
    ['Q1', { kind: 'qualifying', format: 'grandPrix', segment: 1 }, false],
    ['Q2', { kind: 'qualifying', format: 'grandPrix', segment: 2 }, false],
    ['Q3', { kind: 'qualifying', format: 'grandPrix', segment: 3 }, true],
    ['one-shot', { kind: 'qualifying', format: 'oneShot', segment: undefined }, true],
    ['short', { kind: 'qualifying', format: 'short', segment: undefined }, true],
    ['shootout 3', { kind: 'qualifying', format: 'sprintShootout', segment: 3 }, true],
    ['shootout 1', { kind: 'qualifying', format: 'sprintShootout', segment: 1 }, false],
    ['a race', { kind: 'race', format: 'grandPrix' }, false],
    ['practice', { kind: 'practice', format: 'practice', segment: undefined }, false],
    ['pending', { kind: 'pending' }, false],
  ])('%s: %s', (_name, phase, ends) => {
    expect(endsQualifying(phase)).toBe(ends);
  });
});
