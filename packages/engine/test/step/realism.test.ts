// Realism mode (spec 7.9): the rivals' hidden fields are unknown('realism') before any calculator sees them.
import { describe, expect, it } from 'vitest';
import { unknown, type CarState } from '@pitwall/domain';
import { initialState, step, type EngineState, type Frame } from '../../src/index.ts';
import { withholdForRealism } from '../../src/step/state-update/realism.ts';
import type { StepOutput } from '../../src/step/types.ts';
import { STATE_UPDATE } from '../../src/step/step.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { inOrder } from '../support/module-order.ts';
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

describe('realism in step 1', () => {
  // Was "runs right after applyOwnCar": an order inside step 1, which C11 forbids. What it guarded stays: no step-1
  // module writes a hidden value past the mask, whatever order they run in.
  it('masks the rivals whatever order the step-1 modules run in (here reversed)', () => {
    const { st } = inOrder(STATE_UPDATE, [...STATE_UPDATE].reverse(), () => run(frames(1), true));
    for (const [path, value] of hiddenFields(st.cars[3]!)) expect([path, value]).toEqual([path, REALISM]);
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

/** The hidden fields of `hiddenFields` by the step-1 module that writes them (its area). */
const AREA_FIELDS = {
  energy: (c: CarState) => [c.energy.fuel, c.energy.ers, c.energy.power],
  tyres: (c: CarState) => [
    c.tyres.sets,
    ...CORNERS.flatMap((w) => {
      const t = c.tyres.corners[w];
      return [t.surfaceTempC, t.carcassTempC, t.pressurePsi, t.wearPct, t.damagePct, t.blistersPct];
    }),
  ],
  condition: (c: CarState) => [
    c.condition.bodywork, c.condition.powerUnit, c.condition.drsFault, c.condition.engineTempC,
    ...CORNERS.flatMap((w) => [c.condition.brakes[w].tempC, c.condition.brakes[w].damagePct]),
  ],
  dynamics: (c: CarState) => [c.dynamics],
} as const;

const allHidden = (c: CarState): boolean => hiddenFields(c).every(([, v]) => v === REALISM || (v as { reason?: string }).reason === 'realism');
const noneHidden = (c: CarState): boolean => hiddenFields(c).every(([, v]) => (v as { known: boolean }).known);

// Ruling (Task 4 review F1, C11): each step-1 module masks its own fields, with the player, the teammate and realism of
// the previous frame's live state; placing the player is the identity module's own output. So no pass after the
// modules reads their same-frame output, and a change of player or teammate shows in the masking one frame later.
describe('realism: masked by each module, from the previous frame', () => {
  it.each(Object.keys(AREA_FIELDS) as Array<keyof typeof AREA_FIELDS>)('with realism, the %s module hides its rival fields', (area) => {
    const [first, second] = frames(2);
    const st = initialState({ ...initFor([first!]), realism: true });
    step(st, first!);
    // this module alone, on a frame that carries every packet: the values it writes for the rival are masked by itself
    const update = STATE_UPDATE.find((m) => m.id === area)!;
    const out: StepOutput = { changed: new Set(), corrections: [] };
    update.apply(second!, st, st.signals, out);
    expect(AREA_FIELDS[area](st.cars[3]!).map((v) => (v as { known: boolean; reason?: string }).reason)).toEqual(AREA_FIELDS[area](st.cars[3]!).map(() => 'realism'));
  });

  it("on the session's first frame the initial state's player decides: the teammate Participants names is masked until the next frame", () => {
    const fs = frames(2);
    const st = initialState({ ...initFor(fs), realism: true });
    step(st, fs[0]!);
    expect([st.teammateCar, noneHidden(st.cars[0]!), allHidden(st.cars[1]!)]).toEqual([1, true, true]);
    step(st, fs[1]!);
    expect([noneHidden(st.cars[0]!), noneHidden(st.cars[1]!), allHidden(st.cars[3]!)]).toEqual([true, true, true]);
  });

  it('a player change takes effect on realism masking one frame later', () => {
    // player 0 (teammate 1) on frames 0 and 1; the game's player is car 3 from frame 2 on (its teammate is car 2)
    const fs = frames(4).map((f, i) => (i >= 2 ? { ...f, playerCarIndex: 3 } : f));
    const st = initialState({ ...initFor(fs), realism: true });
    for (const f of fs.slice(0, 3)) step(st, f);
    // frame 2: car 3 is the player now, but the masking still follows frame 1's player and teammate
    expect([st.playerCar, st.teammateCar, allHidden(st.cars[3]!), noneHidden(st.cars[0]!), noneHidden(st.cars[1]!)]).toEqual([3, 2, true, true, true]);
    step(st, fs[3]!);
    // frame 3: the masking follows frame 2's player (3) and teammate (2)
    expect([noneHidden(st.cars[3]!), allHidden(st.cars[0]!), allHidden(st.cars[1]!)]).toEqual([true, true, true]);
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
