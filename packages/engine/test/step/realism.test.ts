// Realism mode (spec 7.9): the rivals' hidden fields are unknown('realism') before any calculator sees them.
import { describe, expect, it } from 'vitest';
import { unknown, type CarState } from '@pitwall/domain';
import { initialState, step, type EngineState, type Frame } from '../../src/index.ts';
import { applyRealism, withholdForRealism } from '../../src/step/realism.ts';
import { SUB_STEPS } from '../../src/step/step.ts';
import { applyOwnCar } from '../../src/step/own-car.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor } from '../support/run.ts';

const REALISM = unknown('realism');
const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

// 6 cars: player 0, teammate 1 (same team), car 3 a rival; every packet kind with hidden data in every frame
const frames = (n = 2): Frame[] =>
  new ScenarioBuilder({ cars: 6 }).frames(n, (d) => {
    d.add('carDamage');
    d.add('tyreSets', { carIdx: 0 });
    d.add('tyreSets', { carIdx: 1 });
    d.add('tyreSets', { carIdx: 3 });
  }).build();

const run = (fs: Frame[], realism?: boolean): { st: EngineState; changed: Array<Set<string>> } => {
  const st = initialState({ ...initFor(fs), ...(realism !== undefined && { realism }) });
  const changed = fs.map((f) => new Set<string>(step(st, f).changed));
  return { st, changed };
};

/** Every field of requirement 2, as [path, value]. */
const hiddenFields = (c: CarState): Array<[string, unknown]> => [
  ['energy.fuel', c.energy.fuel], ['energy.ers', c.energy.ers], ['energy.power', c.energy.power], ['tyres.sets', c.tyres.sets],
  ['condition.bodywork', c.condition.bodywork], ['condition.powerUnit', c.condition.powerUnit],
  ['condition.drsFault', c.condition.drsFault], ['condition.engineTempC', c.condition.engineTempC],
  ...CORNERS.flatMap((w): Array<[string, unknown]> => [
    [`${w}.surfaceTempC`, c.tyres.corners[w].surfaceTempC], [`${w}.carcassTempC`, c.tyres.corners[w].carcassTempC],
    [`${w}.pressurePsi`, c.tyres.corners[w].pressurePsi], [`${w}.wearPct`, c.tyres.corners[w].wearPct],
    [`${w}.damagePct`, c.tyres.corners[w].damagePct], [`${w}.blistersPct`, c.tyres.corners[w].blistersPct],
    [`${w}.brake.tempC`, c.condition.brakes[w].tempC], [`${w}.brake.damagePct`, c.condition.brakes[w].damagePct],
  ]),
  ['dynamics', c.dynamics],
];

describe('EngineState.realism', () => {
  it('is false by default and takes the init value', () => {
    const fs = frames(1);
    expect(initialState(initFor(fs)).realism).toBe(false);
    expect(initialState({ ...initFor(fs), realism: false }).realism).toBe(false);
    expect(initialState({ ...initFor(fs), realism: true }).realism).toBe(true);
  });
});

describe('applyRealism', () => {
  it('runs right after applyOwnCar', () => {
    const at = SUB_STEPS.indexOf(applyOwnCar);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(SUB_STEPS[at + 1]).toBe(applyRealism);
  });

  it('control: without realism the rival car 3 has every hidden field known', () => {
    const { st } = run(frames(), false);
    for (const [path, value] of hiddenFields(st.cars[3]!)) expect([path, (value as { known: boolean }).known]).toEqual([path, true]);
  });

  it('with realism every hidden field of car 3 is unknown("realism") after a frame with all packets', () => {
    const { st } = run(frames(1), true);
    for (const [path, value] of hiddenFields(st.cars[3]!)) expect([path, value]).toEqual([path, REALISM]);
  });

  it('the player (0) and the teammate (1) stay complete: identical to the run without realism', () => {
    const on = run(frames(), true).st, off = run(frames(), false).st;
    expect(on.teammateCar).toBe(1);
    for (const id of [0, 1]) {
      expect(on.cars[id]).toEqual(off.cars[id]);
      for (const [path, value] of hiddenFields(on.cars[id]!)) expect([id, path, (value as { known: boolean }).known]).toEqual([id, path, true]);
    }
  });

  it('every other rival is masked too (cars 2, 4, 5)', () => {
    const { st } = run(frames(), true);
    for (const id of [2, 4, 5]) for (const [path, value] of hiddenFields(st.cars[id]!)) expect([id, path, value]).toEqual([id, path, REALISM]);
  });

  it('masks on every frame: values arriving again in a later frame do not survive', () => {
    const { st } = run(frames(3), true);
    expect(hiddenFields(st.cars[3]!).every(([, v]) => v === REALISM || (v as { reason?: string }).reason === 'realism')).toBe(true);
  });

  it('keeps timing, position on track, compounds, tyre age and speed trap of the rival as without realism', () => {
    const on = run(frames(), true).st.cars[3]!, off = run(frames(), false).st.cars[3]!;
    expect(on.timing).toEqual(off.timing);
    expect(on.motion).toEqual(off.motion);
    expect([on.tyres.actualCompound, on.tyres.visualCompound, on.tyres.age]).toEqual([off.tyres.actualCompound, off.tyres.visualCompound, off.tyres.age]);
    expect(on.timing.speedTrapFastestKmh).toEqual(off.timing.speedTrapFastestKmh);
    expect(on.identity).toEqual(off.identity);
    expect(on.condition.ersFault).toBe(off.condition.ersFault);
  });

  it('with realism false nothing changes: the whole state equals a run that never heard of realism', () => {
    const fs = frames();
    expect(run(fs, false).st).toEqual(run(fs).st);
  });

  it('adds no change tag', () => {
    const fs = frames();
    expect(run(fs, true).changed).toEqual(run(fs, false).changed);
  });
});

describe('withholdForRealism', () => {
  it('sets exactly the listed fields on a car and leaves the rest alone', () => {
    const car = run(frames(1), false).st.cars[3]!;
    const before = structuredClone(car);
    withholdForRealism(car);
    for (const [path, value] of hiddenFields(car)) expect([path, value]).toEqual([path, REALISM]);
    // everything outside the list is unchanged
    const rest = (c: CarState) => {
      const copy = structuredClone(c) as any;
      copy.energy = {} as never; copy.dynamics = undefined as never;
      copy.tyres = { ...copy.tyres, sets: undefined as never, corners: undefined as never };
      copy.condition = { ...copy.condition, bodywork: undefined as never, powerUnit: undefined as never, drsFault: undefined as never, engineTempC: undefined as never, brakes: undefined as never };
      return copy;
    };
    expect(rest(car)).toEqual(rest(before));
    expect(car.motion).toEqual(before.motion);
    expect(car.timing).toEqual(before.timing);
  });
});
