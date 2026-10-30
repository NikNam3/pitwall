// Behaviours that only exist over a whole qualifying lap, on qualifying-singapore-full-lap (facts in fixtures/index.json):
// in Q2, car 14 (the player) leaves the out lap at the line and runs its flying lap 1 to the line; ten other cars
// complete a lap whose start lies before the segment. One replay through the engine and `lap-times` feeds every test.
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyLap, LAP_TIMES, LAP_TIMES_CONFIG, lapTimesCalculator, type LapTimesOutput } from '@pitwall/analysis';
import type { Known, LapRecord } from '@pitwall/domain';
import type { DeepReadonly, EngineState } from '@pitwall/engine';
import { InvariantChecker } from '../../../../packages/engine/test/support/invariants.ts';
import { replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

type Lap = DeepReadonly<LapRecord>;

const run: { state: DeepReadonly<EngineState>; lapTimes: LapTimesOutput; invariantErrors: string[] } = {} as never;

beforeAll(async () => {
  const invariantErrors: string[] = [];
  const checker = new InvariantChecker();
  let lapTimes: LapTimesOutput | undefined;
  const runner = await replayScheduled(segmentPath('qualifying-singapore-full-lap.pwrec.gz'), [lapTimesCalculator], (r, scheduled) => {
    try {
      checker.check(r);
    } catch (error) {
      if (invariantErrors.length === 0) invariantErrors.push(String(error));
    }
    lapTimes = scheduled.outputs.get(LAP_TIMES) as LapTimesOutput;
  });
  Object.assign(run, { state: runner.state, lapTimes: lapTimes!, invariantErrors });
});

/** The value of a `Known` the test needs; an unknown one fails the test with its reason. */
const valueOf = <T>(k: DeepReadonly<Known<T>>): DeepReadonly<T> => {
  if (!k.known) throw new Error(`expected a known value, got unknown (${k.reason})`);
  return k.value;
};

const confirmed = (): Lap[] => run.state.history.laps.filter((l) => l.status === 'confirmed');
const validLaps = (): Lap[] => confirmed().filter((l) => l.valid.lap);
/** The player's flying lap: its lap timed from line to line in the segment. */
const flyingLap = (): Lap => {
  const { playerCar, history } = run.state;
  const line = (lap: number) => history.miniSectors.some((m) => m.carId === playerCar && m.lap === lap && m.segment === 0);
  return confirmed().find((l) => l.carId === playerCar && line(l.lapNumber) && line(l.lapNumber + 1))!;
};
const playerRow = () => run.lapTimes.rows.find((r) => r.carId === run.state.playerCar)!;
const fastest = <T extends { ms: number }>(xs: T[]): T => xs.reduce((a, b) => (b.ms < a.ms ? b : a));

describe('qualifying-singapore-full-lap: the flying lap', () => {
  it('the engine invariants hold on every frame of the lap', () => {
    expect(run.invariantErrors).toEqual([]);
  });

  it('the flying lap timed from the line after the out lap from the garage counts for pace, for the rate and for bests', () => {
    expect(classifyLap(flyingLap(), { isRace: false })).toEqual({ forPace: true, forRate: true, forBest: { lap: true, sectors: [true, true, true] } });
  });

  it("the lap carries the game's lap time, its sectors add up to it, and the board shows both as the last lap", () => {
    const lap = flyingLap();
    expect(lap.lapTimeMs).toBe(92_485);
    const sum = lap.sectorTimesMs[0] + lap.sectorTimesMs[1] + lap.sectorTimesMs[2]; // spec 10.2: lapTime − 2 ≤ sum ≤ lapTime
    expect(sum).toBeLessThanOrEqual(lap.lapTimeMs);
    expect(sum).toBeGreaterThanOrEqual(lap.lapTimeMs - 2);
    const row = playerRow();
    expect(valueOf(row.lastLapMs)).toBe(lap.lapTimeMs);
    expect(row.lastSectorsMs.map((s) => valueOf(s))).toEqual(lap.sectorTimesMs);
  });
});

describe('qualifying-singapore-full-lap: bests', () => {
  it("each car's best lap is its fastest valid lap, and the session best is the fastest of them", () => {
    const valid = validLaps().map((l) => ({ carId: l.carId, ms: l.lapTimeMs }));
    for (const row of run.lapTimes.rows) {
      const own = valid.filter((l) => l.carId === row.carId);
      expect(row.bestLapMs.known ? row.bestLapMs.value : undefined, `car ${row.carId}`).toBe(own.length === 0 ? undefined : fastest(own).ms);
    }
    expect(valueOf(run.lapTimes.sessionBest.lap)).toEqual(fastest(valid));
  });

  it('the session best sectors are the fastest valid sector times of any car', () => {
    for (const i of [0, 1, 2] as const) {
      const sectors = confirmed()
        .filter((l) => l.valid.sectors[i])
        .map((l) => ({ carId: l.carId, ms: l.sectorTimesMs[i] }));
      expect(valueOf(run.lapTimes.sessionBest.sectors[i]), `sector ${i + 1}`).toEqual(fastest(sectors));
    }
  });

  it("the player's first valid lap is its personal best; the lap and each sector show session best only where the player holds it", () => {
    const { playerCar } = run.state;
    const row = playerRow();
    const best = valueOf(run.lapTimes.sessionBest.lap);
    expect(row.lastLapStatus).toBe(best.carId === playerCar ? 'sessionBest' : 'personalBest');
    expect(row.lastSectorStatus).toEqual(run.lapTimes.sessionBest.sectors.map((s) => (valueOf(s).carId === playerCar ? 'sessionBest' : 'personalBest')));
  });
});

describe('qualifying-singapore-full-lap: the projection on the next lap', () => {
  /** Every other car's best valid lap. */
  const othersBests = () => {
    const { playerCar } = run.state;
    const byCar = new Map<number, number>();
    for (const l of validLaps()) if (l.carId !== playerCar) byCar.set(l.carId, Math.min(byCar.get(l.carId) ?? Infinity, l.lapTimeMs));
    return [...byCar.values()];
  };

  it("once the flying lap is the player's best, the projection is known and ranks the projected lap among the other cars' bests", () => {
    const p = run.lapTimes.projections[run.state.playerCar]!;
    const projected = valueOf(p.projectedLapMs);
    expect(valueOf(p.projectedPosition)).toBe(1 + othersBests().filter((ms) => ms <= projected).length);
    expect(valueOf(p.deltaToBestMs)).toBe(projected - valueOf(playerRow().bestLapMs));
  });

  it('the Q2 cut-off is the place of the last car through to Q3: the active cars of Q2 minus the cars it knocks out', () => {
    const { session } = run.state;
    expect(session.sessionType).toBe(6);
    const cutOff = valueOf(run.lapTimes.projections[run.state.playerCar]!.cutOff);
    expect(cutOff.position).toBe(session.numActiveCars - LAP_TIMES_CONFIG.defaults.eliminatedQ2);
    expect(cutOff.timeMs).toBe([...othersBests()].sort((a, b) => a - b)[cutOff.position - 1]);
  });
});
