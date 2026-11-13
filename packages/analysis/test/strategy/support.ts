// Shared setup of the `strategy` tests (SP4.3b spec §8.1, plan 4.3b1 Task 20): a small generator race seen from our two
// cars (player 2, teammate 5, mid-field, so each has a rival directly ahead and behind), the view at a leader's lap as
// the scheduler hands it to the job (append frames, the track file, `race-hazard`'s output, our cars' tyre sets, plan
// decisions), and how a `race-monte-carlo` call is read.
//
// How these tests read `strategy` (the test agent's decisions, Task 20 report):
// - `prepareStrategy(view)` gives the job's input; `runStrategy(input, rng)` its output, per our car (`ourCars`) a
//   `Known` of its rows; `notApplicable` for a car it cannot plan (outside the race phase, no braking zones, retired).
// - `candidatesOf(start, car, dp, config)` (`candidates.ts`) builds one car's candidates from its DP result: every DP
//   plan, `boxNow` (where not `null`) and `stayOut`, source `dp`; the stop-lap neighbours, source `neighbour`: a DP
//   plan with one stop moved by 1–3 laps (`neighbourMinLaps`–`neighbourMaxLaps`), the rest kept; the rule candidates,
//   source `rule`, on the best plan (`plans[0]`): mirror ahead and mirror behind (its first stop moved to the rival's
//   likeliest stop lap, `start.stopMid`), cover (a `rivalPits` trigger on the rival directly behind, action `cover`,
//   within `ruleGapMs`) and extend (the same on the rival directly ahead, action `extend`). Every policy is
//   `policyOf(plan, thresholds)`: the DP's thresholds, plus the rule's own `rivalPits` trigger for cover and extend.
// - A `race-monte-carlo` call plans car `c` when `input.candidates[c]` is not empty. While it scores one car, our other
//   car follows `committed[other] ?? candidates[other][0]` (race-monte-carlo's rule, `search.ts`); our other car is
//   "modelled like a rival" when it is not one of the call's cars (`input.start.sets` has no entry for it).
import {
  carId,
  known,
  unknown,
  type CarId,
  type DecisionRecord,
  type FrameNumber,
  type LapRecord,
  type Policy,
  type RaceHazard,
  type TyreSet,
} from '@pitwall/domain';
import type { EngineView, Projection } from '@pitwall/engine/readers';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { raceHazardCalculator } from '../../src/race-hazard/index.ts';
import type { McInput } from '../../src/race-monte-carlo/index.ts';

export const PLAYER: CarId = carId(2);
export const TEAMMATE: CarId = carId(5);
export const OURS: readonly CarId[] = [PLAYER, TEAMMATE];

/** The track file of every view here: braking zones, DRS zones, pit-loss defaults and the SC/VSC hazard table. */
export const TRACK: EngineView['track'] = known(zandvoortTrack(), 0);

/** The search's cap in the job tests: small, so a run takes well under a second (the budget test runs the config's). */
export const TEST_CAP = 400;

/** A small generator race: 8 cars, 20 laps, one stop each on laps 8 to 10, medium to hard. */
export const PARAMS: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  cars: 8,
  laps: 20,
  field: GENERATOR_DEFAULTS.field.slice(12).map((car, i) => ({ ...car, stops: [{ lap: 8 + (i % 3), compound: 'hard' as const }] })),
};

/** Computed once, on first use (a throw fails the test that asked, not the file). */
export const once = <T>(f: () => T): (() => T) => {
  let v: { value: T } | undefined;
  return () => (v ??= { value: f() }).value;
};

/** The generator race of `params` (seed 1). */
export const generated = (params: GeneratorParams = PARAMS, seed = 1): BuilderRace => generateRace(params, seed).race;

/** The race of `PARAMS`, built once. */
export const RACE = once(() => generated());

/** The fact lists of the projection (the log's `FACT_LISTS`). */
const FACT_LISTS = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'penalties', 'decisions', 'clock'] as const;

/** `p` with the append frame of every entry (a fact on the frame it describes, a confirmed lap on the frame after its provisional's crossing, a closed span on its end frame). */
export function withAppendFrames(p: Projection): Projection {
  const appendedAt: Record<string, FrameNumber[]> = {};
  for (const list of FACT_LISTS) {
    appendedAt[list] = (p[list] as readonly { frame: FrameNumber; status?: LapRecord['status'] }[]).map((fact) =>
      list === 'laps' && fact.status !== 'provisional' ? fact.frame + 1 : fact.frame,
    );
  }
  for (const [machine, spans] of Object.entries(p.spans)) appendedAt[`spans:${machine}`] = spans.map((s) => s.endFrame);
  return { ...p, appendedAt } as Projection;
}

const set = (visualCompound: 'soft' | 'medium' | 'hard', wearPct: number, fitted: boolean): TyreSet => ({
  actualCompound: visualCompound === 'soft' ? 'C3' : visualCompound === 'medium' ? 'C2' : 'C1',
  visualCompound,
  wearPct,
  available: true,
  fitted,
  recommendedSession: 0,
  lifeSpanLaps: 20,
  usableLifeLaps: 18,
  lapDeltaMs: 0,
});

/** Our cars' default sets: the fitted medium, then a new soft, medium and hard each. */
export const SETS: readonly TyreSet[] = [set('medium', 10, true), set('soft', 0, false), set('medium', 0, false), set('hard', 0, false)];

/** Only the fitted set: no set left to stop onto. */
export const NO_SETS_LEFT: readonly TyreSet[] = [set('medium', 10, true)];

export type ViewSpec = {
  /** Default `PLAYER`, `TEAMMATE`. */
  player?: CarId;
  teammate?: CarId | null;
  /**
   * Plan decisions, recorded on frame `frame` (absolute: a decision after the view's frame is not in it yet), else on
   * the view's frame minus `framesBefore` (default 1).
   */
  decisions?: ({ frame?: FrameNumber; framesBefore?: number } & ({ kind: 'planCommitted'; carId: CarId; policy: Policy } | { kind: 'planCleared'; carId: CarId }))[];
  /** `strategy`'s config section, over `{ maxScenarioPolicies: TEST_CAP }`. */
  config?: Record<string, unknown>;
  /** `race-hazard`'s output; default its calculator's on the view. */
  hazard?: RaceHazard;
  /** Default `TRACK`. */
  track?: EngineView['track'];
  /** Our cars' sets; default `SETS`. */
  sets?: Partial<Record<CarId, readonly TyreSet[]>>;
  /** Cars whose car-status span is `retired`. */
  retired?: readonly CarId[];
  /** The weekend phase's kind; default the race's. */
  weekendPhase?: 'practice' | 'qualifying' | 'race' | 'none';
  /** Which frame of the leader's lap (default its 31st, 15 s in: the small race's field has crossed the line). */
  frameOfLap?: number;
};

/** The frame of the leader's lap `lap` the views here are taken at. */
export const frameOf = (race: BuilderRace, lap: number, k = 30): FrameNumber => {
  const frames = race.framesOfLap(lap);
  return frames[Math.min(k, frames.length - 1)]!;
};

/**
 * The view after the frame on the leader's lap `lap`, as the scheduler hands it to `strategy`'s job: its append frames,
 * the track file, our cars and their sets, the plan decisions, the config and `race-hazard`'s output.
 */
export function viewAt(race: BuilderRace, lap: number, spec: ViewSpec = {}): EngineView {
  return viewAtFrame(race, frameOf(race, lap, spec.frameOfLap), spec);
}

/** The view after `frame` as `viewAt` gives it (`frameOfLap` unused). */
export function viewAtFrame(race: BuilderRace, frame: FrameNumber, spec: ViewSpec = {}): EngineView {
  const raw = race.viewAt(frame);
  const player = spec.player ?? PLAYER;
  const teammate = spec.teammate === undefined ? TEAMMATE : spec.teammate;
  const ours = new Set<number>([player, ...(teammate === null ? [] : [teammate])]);
  const at = raw.live.sessionTime;
  const decisions: DecisionRecord[] = [
    ...(raw.history.decisions as readonly DecisionRecord[]),
    ...(spec.decisions ?? [])
      .map(({ frame: at, framesBefore, ...d }) => ({ ...d, frame: at ?? frame - (framesBefore ?? 1) }) as DecisionRecord)
      .filter((d) => d.frame <= frame),
  ];
  const history = withAppendFrames({ ...raw.history, decisions });
  const cars = raw.live.cars.map((c) =>
    ours.has(c.id) ? { ...c, tyres: { ...c.tyres, sets: known({ sets: [...(spec.sets?.[c.id] ?? SETS)], fittedIdx: 0 }, at) } } : c,
  );
  const retired = new Set<number>(spec.retired ?? []);
  const byMachine = Object.fromEntries(
    Object.entries(raw.situation.byMachine).map(([machine, spans]) => [
      machine,
      machine === 'car-status' ? spans.map((s) => (s.carId !== undefined && retired.has(s.carId) ? { ...s, kind: 'retired' } : s)) : spans,
    ]),
  );
  const situation = {
    weekendPhase: spec.weekendPhase === undefined ? raw.situation.weekendPhase : { ...raw.situation.weekendPhase, kind: spec.weekendPhase },
    byMachine,
  } as EngineView['situation'];
  const base: EngineView = {
    ...raw,
    live: { ...raw.live, playerCar: player, ...(teammate === null ? { teammateCar: undefined } : { teammateCar: teammate }), cars } as EngineView['live'],
    situation,
    history,
    track: spec.track ?? TRACK,
    config: { strategy: { maxScenarioPolicies: TEST_CAP, ...spec.config } },
    outputs: new Map(),
  };
  const hazard = spec.hazard ?? raceHazardCalculator.compute(base);
  return { ...base, outputs: new Map([['race-hazard', hazard]]) };
}

/** `race-hazard`'s output as unknown (no track table). */
export const HAZARD_UNKNOWN: RaceHazard = unknown('insufficientData');

/** The car `car`'s lap now: one past its newest lap record in the view. */
export function currentLapOf(view: EngineView, car: CarId): number {
  let n = 0;
  for (const l of view.history.laps) if (l.carId === car && l.lapNumber > n) n = l.lapNumber;
  return n + 1;
}

/** The cars a `race-monte-carlo` call plans: those with candidates. */
export const plannedIn = (input: McInput): CarId[] =>
  Object.entries(input.candidates)
    .filter(([, list]) => list.length > 0)
    .map(([car]) => Number(car) as CarId);

/** Whether car `car` is one of the call's own cars (else it is modelled like a rival). */
export const oursIn = (input: McInput, car: CarId): boolean => Object.hasOwn(input.start.sets, car);

/** The plan our car `car` follows while another car is scored in the call (race-monte-carlo's rule): committed, else its first candidate. */
export const fixedIn = (input: McInput, car: CarId): Policy | null => input.committed[car] ?? input.candidates[car]?.[0]?.policy ?? null;

/** A valid one-stop plan from the view's lap: a stop `inLaps` laps ahead onto `compound`. */
export const stopIn = (view: EngineView, car: CarId, inLaps: number, compound: Policy['stops'][number]['compound'] = 'hard'): Policy => ({
  stops: [{ lap: currentLapOf(view, car) + inLaps, compound }],
  triggers: [],
});

export const json = (x: unknown): string => JSON.stringify(x);
