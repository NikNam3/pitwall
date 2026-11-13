// The select of `pitSweep.car` (SP4.3b spec §9.2; plan 4.3b2 Task 8 row 5; C55): the job's output per car to the table
// of the panel's compound. `auto` resolves to the compound `pit-sweep` named (C43), never in the panel or the display.
import { carId, known, unknown, type PitSweepCar, type PitSweepTable } from '@pitwall/domain';
import type { PitSweepOutput } from '@pitwall/analysis';
import { describe, expect, it } from 'vitest';
import { selectSweep } from '../../../src/features/pit-sweep/select.ts';

const OURS = carId(2);
const OTHER = carId(5);
const RIVAL = carId(9);

const table = (compound: PitSweepTable['compound'], stopLap: number): PitSweepTable => ({
  compound,
  scenarios: 100,
  rows: [
    {
      stopLap,
      rejoinPosition: known(6, 1_000),
      traffic: known(1, 1_000),
      ePos: 5.2,
      positionPmf: [0, 0, 0.1, 0.2, 0.4, 0.3],
      pGain: 0.3,
      meanMs: 1_800_000,
      pastLife: known(false, 1_000),
      inWindow: true,
    },
  ],
});

const HARD = table('hard', 12);
const MEDIUM = table('medium', 13);

const sweep = (car: typeof OURS, auto: PitSweepCar['auto']): PitSweepCar => ({
  carId: car,
  lap: 10,
  position: 5,
  auto,
  byCompound: { hard: known(HARD, 1_000), medium: known(MEDIUM, 1_000) },
});

const OUT: PitSweepOutput = { [OURS]: sweep(OURS, known('hard', 1_000)), [OTHER]: sweep(OTHER, unknown('insufficientData')) };

describe('pitSweep.car select', () => {
  // row 5
  it('the topic\'s select: compound auto → the auto table and fromAuto true; a compound absent from byCompound → table notApplicable; auto unknown → table with its reason; a car without an entry → no data', () => {
    // auto known: that compound's table, fromAuto
    expect(selectSweep(OUT, { carId: OURS, compound: 'auto' })).toEqual({ carId: OURS, lap: 10, position: 5, compound: 'hard', fromAuto: true, table: known(HARD, 1_000) });
    // a compound chosen in the panel: its table, not from auto
    expect(selectSweep(OUT, { carId: OURS, compound: 'medium' })).toEqual({ carId: OURS, lap: 10, position: 5, compound: 'medium', fromAuto: false, table: known(MEDIUM, 1_000) });
    // a compound absent from byCompound: notApplicable, never no data
    expect(selectSweep(OUT, { carId: OURS, compound: 'soft' })).toEqual({ carId: OURS, lap: 10, position: 5, compound: 'soft', fromAuto: false, table: unknown('notApplicable') });
    // auto unknown: compound auto, table with auto's reason
    expect(selectSweep(OUT, { carId: OTHER, compound: 'auto' })).toEqual({ carId: OTHER, lap: 10, position: 5, compound: 'auto', fromAuto: true, table: unknown('insufficientData') });
    // auto resolves to a compound without a table: that compound, notApplicable
    const noHard: PitSweepOutput = { [OURS]: { ...sweep(OURS, known('hard', 1_000)), byCompound: { medium: known(MEDIUM, 1_000) } } };
    expect(selectSweep(noHard, { carId: OURS, compound: 'auto' })).toEqual({ carId: OURS, lap: 10, position: 5, compound: 'hard', fromAuto: true, table: unknown('notApplicable') });
    // a car without an entry (a rival), and an output without cars: no data
    expect(selectSweep(OUT, { carId: RIVAL, compound: 'auto' })).toBeUndefined();
    expect(selectSweep({}, { carId: OURS, compound: 'hard' })).toBeUndefined();
  });
});
