// Shared setup of the `sc-call` job tests (SP4.3b spec §9.3; plan SP4.3b2 Task 9): `strategy`'s small generator race
// seen from our two cars (`../strategy/support.ts`: player 2, teammate 5), the view as the scheduler hands it to the
// job (append frames, the track file, `race-hazard`'s output, our sets) plus `rejoin`'s output and `sc-call`'s config.
//
// How these tests read `sc-call` (the test agent's decisions, Task 9 report):
// - `SC_CALL_JOB.prepare(view)` gives the job's input (structured-cloneable, C51); `run(input, rng)` (`job.ts`, the
//   job's module) its output: per our car an `ScCall`, a rival absent.
// - `rejoin`'s output is passed explicitly (`rejoinOutput`): the job takes its rejoin position, loss and loss source
//   per condition from it (C43), as the 4.2 calculator did; the 4.2 values (SC 9 / 9 800 / default, VSC 10 / 13 100 /
//   calibration) are its default.
// - `ScCall.lap` is our car's DP start lap (`toDpInput(…).fromLap`, `startLapOf`): the lap "box now" boxes at.
// - The races: `GREEN` (no neutralisation), `SC_OUT` (an SC deployed during the leader's lap 5, in during lap 7, nobody
//   stops under it), `SC_BOX` (an SC deployed during lap 9, in during lap 12; our cars stop on lap 10, under it).
import {
  known,
  unknown,
  type CarId,
  type EstimateSource,
  type Known,
  type Ms,
  type OpenSpan,
  type PitCondition,
  type Rejoin,
  type RejoinAt,
  type ScCall,
  type ScCallRow,
} from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { REJOIN, type RejoinOutput } from '../../src/rejoin/index.ts';
import { SC_CALL_CONFIG } from '../../src/sc-call/index.ts';
import { generated, once, OURS, PARAMS, viewAt, viewAtFrame, type ViewSpec } from '../strategy/support.ts';

export { OURS, PLAYER, TEAMMATE } from '../strategy/support.ts';

/**
 * The cap of the behaviour tests, through `sc-call`'s config override (C47; Task 18s: test speed): far below the
 * config's (spec §11.1, pinned by the budget test). The rows compare the job's rows with the recorded `scoreCalls`
 * outcomes of the same run, so any cap with scenarios per condition holds them: 10 per forced condition, 20 under an SC out.
 */
export const CAP = 40;

/** The leader's lap of the green views. */
export const LAP = 3;

/** `strategy`'s small race: no neutralisation. */
export const GREEN = once(() => generated());
/** An SC deployed during the leader's lap 5 and in during lap 7; every stop is on laps 8 to 10. */
export const SC_OUT = once(() => generated({ ...PARAMS, sc: { fromLap: 5, toLap: 7 } }));
/** An SC deployed during the leader's lap 9 and in during lap 12; our cars stop on lap 10, under it. */
export const SC_BOX = once(() => generated({ ...PARAMS, sc: { fromLap: 9, toLap: 12 } }));

export const SESSION_SOURCE: EstimateSource = { kind: 'session', sessionShare: 1, parts: 'session' };
export const DEFAULT_SOURCE: EstimateSource = { kind: 'default', note: 'track file', sessionShare: 0, parts: 'default' };
export const CALIBRATION_SOURCE: EstimateSource = { kind: 'calibration', setName: 'Monza dry', sources: 4, sessionShare: 0, parts: 'calibration' };

/** The 4.2 losses: green 20 300 (session), SC 9 800 (default), VSC 13 100 (calibration). */
export const LOSSES: Record<PitCondition, Known<Ms>> = { green: known(20_300, 0), sc: known(9_800, 0), vsc: known(13_100, 0) };
export const SOURCES: Record<PitCondition, EstimateSource> = { green: SESSION_SOURCE, sc: DEFAULT_SOURCE, vsc: CALIBRATION_SOURCE };
/** The 4.2 rejoin positions: green 12, SC 9, VSC 10. */
export const POSITIONS: Record<PitCondition, Known<number>> = { green: known(12, 0), sc: known(9, 0), vsc: known(10, 0) };

/** `rejoin`'s value of one car: its rejoin positions per condition, the 4.2 losses and sources. */
export function rejoinOf(car: CarId, positions: Record<PitCondition, Known<number>> = POSITIONS, losses: Record<PitCondition, Known<Ms>> = LOSSES): Rejoin {
  const at = (condition: PitCondition): RejoinAt => ({
    condition,
    lossMs: losses[condition],
    lossSource: SOURCES[condition],
    rejoinPosition: positions[condition],
    order: unknown('insufficientData'),
    mapPoint: unknown('notApplicable'),
  });
  return { carId: car, position: 8, conditions: { green: at('green'), sc: at('sc'), vsc: at('vsc') } };
}

/** `rejoin`'s output with `cars` (default: our two cars with the 4.2 values). */
export function rejoinOutput(cars: Partial<Record<CarId, Rejoin>> = Object.fromEntries(OURS.map((c) => [c, rejoinOf(c)]))): RejoinOutput {
  return { cars: cars as RejoinOutput['cars'], ghost: { gaps: {} as RejoinOutput['ghost']['gaps'], losses: LOSSES, ourCars: [...OURS], ghostLaps: 6 } };
}

export type ScViewSpec = ViewSpec & {
  /** `rejoin`'s output; default `rejoinOutput()`. */
  rejoin?: RejoinOutput;
  /** `sc-call`'s config section, over `{ maxScenarioPolicies: CAP }`. */
  scConfig?: Record<string, unknown>;
  /** The weekend phase's kind, in `situation.weekendPhase` and in the open `weekend-phase` span both. */
  phase?: 'practice' | 'qualifying' | 'race' | 'none';
};

/** `view` with `rejoin`'s output, `sc-call`'s config and the weekend phase of `spec`. */
export function withScCall(view: EngineView, spec: ScViewSpec = {}): EngineView {
  const outputs = new Map(view.outputs);
  outputs.set(REJOIN, spec.rejoin ?? rejoinOutput());
  const config = { ...view.config, [SC_CALL_CONFIG.key]: { maxScenarioPolicies: CAP, ...spec.scConfig } };
  if (spec.phase === undefined) return { ...view, outputs, config };
  const phase = spec.phase;
  const byMachine = Object.fromEntries(
    Object.entries(view.situation.byMachine).map(([machine, spans]) => [machine, machine === 'weekend-phase' ? spans.map((s: OpenSpan) => ({ ...s, kind: phase })) : spans]),
  );
  const situation = { weekendPhase: { ...view.situation.weekendPhase, kind: phase }, byMachine } as EngineView['situation'];
  return { ...view, outputs, config, situation };
}

/** The view on the leader's lap `lap` of `race`, as the scheduler hands it to `sc-call`'s job. */
export const scViewAt = (race: BuilderRace, lap: number, spec: ScViewSpec = {}): EngineView => withScCall(viewAt(race, lap, spec), spec);

/** The view after `frame` of `race`, as `scViewAt` gives it. */
export const scViewAtFrame = (race: BuilderRace, frame: number, spec: ScViewSpec = {}): EngineView =>
  withScCall(viewAtFrame(race, frame as Parameters<typeof viewAtFrame>[1], spec), spec);

/** The open `session-phase-race` span of the view, if any. */
export const sessionPhaseOf = (view: EngineView): OpenSpan | undefined => view.situation.byMachine['session-phase-race']?.[0] as OpenSpan | undefined;

/** Car `car`'s open `car-activity-race` span kind. */
export const activityOf = (view: EngineView, car: CarId): string | undefined => view.situation.byMachine['car-activity-race']?.find((s) => s.carId === car)?.kind;

/** The first frame of `race` from `from` on where `car`'s car activity is `kind`; throws without one. */
export function firstFrameWith(race: BuilderRace, car: CarId, kind: string, from = 1): number {
  for (let f = from; f <= race.lastFrame; f++) if (activityOf(race.viewAt(f as Parameters<BuilderRace['viewAt']>[0]), car) === kind) return f;
  throw new Error(`no frame with car ${car} in ${kind}`);
}

/** Our car's value; fails the test that asks when it is absent. */
export function callOf(out: Record<CarId, ScCall>, car: CarId): ScCall {
  const v = out[car];
  if (v === undefined) throw new Error(`no sc call for car ${car}`);
  return v;
}

/** One condition's row of `call`. */
export function rowOf(call: ScCall, condition: 'sc' | 'vsc'): ScCallRow {
  const r = call.rows.find((x) => x.condition === condition);
  if (r === undefined) throw new Error(`no ${condition} row`);
  return r;
}

/** Every `Known` field of a row. */
export const KNOWN_FIELDS = ['ePosDelta', 'pGain', 'gainBins', 'rejoinPosition', 'lossMs', 'range'] as const satisfies readonly (keyof ScCallRow)[];

export const NOT_APPLICABLE = unknown('notApplicable');

/** A row's `Known` fields, to compare with `ALL_NOT_APPLICABLE`. */
export const knownsOf = (row: ScCallRow): Record<string, unknown> => Object.fromEntries(KNOWN_FIELDS.map((k) => [k, row[k]]));

/** Every `Known` field `unknown('notApplicable')`. */
export const ALL_NOT_APPLICABLE: Record<string, unknown> = Object.fromEntries(KNOWN_FIELDS.map((k) => [k, NOT_APPLICABLE]));
