// Step 1's `TyreSet.forNextRace` (SP4.3e Task 3b, ruling R13; C8, C12, C13): a set is reserved for the next race when
// its `recommendedSession` is the type of the next race session (15, 16 or 17) after the current session in the weekend
// structure (the current session's position: its session type's first occurrence). No such race (structure unknown or
// zeros, a race session itself): false. The weekend structure is a signal: only the boolean enters the live state.
// False is the field's absence (the domain type: "Absent: false"), so a set not reserved keeps the shape every other
// reader and recorder test pins (`test/recorders/lap-end-samples.test.ts`, `car-state.test.ts`).
import { describe, expect, it } from 'vitest';
import type { TyreSet } from '@pitwall/domain';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const setData = (recommendedSession: number, available = 0) =>
  ({ actualTyreCompound: 18, visualTyreCompound: 16, wear: 0, available, fitted: 0, recommendedSession, lifeSpan: 20, usableLife: 22, lapDeltaTime: 0 });

/**
 * Car 0's sets in a session of `sessionType` in the weekend `structure`: the Session packet on the first frame, the
 * Tyre Sets packet (one set per entry of `recommended`) on the second, so the structure is the one the session holds.
 */
function setsIn(sessionType: number, structure: number[], recommended: number[]): TyreSet[] {
  const tyreSetData = Object.fromEntries(recommended.map((r, i) => [i, setData(r)]));
  const { st } = runScenario(new ScenarioBuilder({ cars: 1 })
    .session({ sessionType, numSessionsInWeekend: structure.length, weekendStructure: structure })
    .frames(1, () => {})
    .frames(1, (d) => { d.add('tyreSets', { carIdx: 0, fittedIdx: 0, tyreSetData }); }));
  const sets = st.cars[0]!.tyres.sets;
  if (!sets.known) throw new Error(`car 0's sets unknown: ${sets.reason}`);
  return sets.value.sets.slice(0, recommended.length);
}

/** Each set's `forNextRace`, absent read as false. */
const reserved = (sets: TyreSet[]): boolean[] => sets.map((s) => s.forNextRace ?? false);

const QUALIFYING_WEEKEND = [1, 2, 3, 5, 6, 7, 15];

describe('step 1: TyreSet.forNextRace', () => {
  it('qualifying (type 8) in [1, 2, 3, 5, 6, 7, 15]: recommendedSession 15 → forNextRace true, 6 → false', () => {
    const sets = setsIn(8, QUALIFYING_WEEKEND, [15, 6]);
    expect(reserved(sets)).toEqual([true, false]);
  });

  it('qualifying (type 6) in [1, 2, 3, 5, 6, 7, 15]: recommendedSession 15 → forNextRace true, 6 → false', () => {
    const sets = setsIn(6, QUALIFYING_WEEKEND, [15, 6]);
    expect(reserved(sets)).toEqual([true, false]);
  });

  it('sprint shootout (type 12) in [1, 12, 15, 5, 6, 7, 16]: the sprint race type 15 is next (15 true, 16 false)', () => {
    const sets = setsIn(12, [1, 12, 15, 5, 6, 7, 16], [15, 16, 12]);
    expect(reserved(sets)).toEqual([true, false, false]);
  });

  it('sprint shootout (type 10) in the sprint structure [1, 10, 15, 5, 16]: the sprint race type 15 is next', () => {
    const sets = setsIn(10, [1, 10, 15, 5, 16], [15, 16]);
    expect(reserved(sets)).toEqual([true, false]);
  });

  it('qualifying (type 5) after the sprint in [1, 10, 15, 5, 16]: the grand prix type 16 is next', () => {
    const sets = setsIn(5, [1, 10, 15, 5, 16], [15, 16]);
    expect(reserved(sets)).toEqual([false, true]);
  });

  it('a race session (15) → false for all', () => {
    const sets = setsIn(15, QUALIFYING_WEEKEND, [15, 16, 6]);
    expect(reserved(sets)).toEqual([false, false, false]);
  });

  it('structure all zeros → false', () => {
    const sets = setsIn(8, [0, 0, 0, 0, 0, 0, 0], [15, 0]);
    expect(reserved(sets)).toEqual([false, false]);
  });

  it('no structure (numSessionsInWeekend 0) → false', () => {
    const sets = setsIn(8, [], [15]);
    expect(reserved(sets)).toEqual([false]);
  });

  it('the live state holds only the boolean: no weekend structure or session type on a set (C13)', () => {
    const [set] = setsIn(8, QUALIFYING_WEEKEND, [15]);
    expect(Object.keys(set!).sort()).toEqual(['actualCompound', 'available', 'fitted', 'forNextRace', 'lapDeltaMs', 'lifeSpanLaps',
      'recommendedSession', 'usableLifeLaps', 'visualCompound', 'wearPct']);
    expect(set!.forNextRace).toBe(true);
  });

  it('a set not reserved carries no forNextRace (absent is false, the shape stays as before)', () => {
    const [notNext] = setsIn(8, QUALIFYING_WEEKEND, [6]);
    expect('forNextRace' in notNext!).toBe(false);
  });
});
