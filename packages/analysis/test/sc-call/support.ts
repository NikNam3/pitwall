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
// - `ScCallBlocks.lap` is our car's DP start lap (`toDpInput(…).fromLap`, `startLapOf`): the lap "box now" boxes at.
// - SP4.3d1 Task 6 (spec §6.3): the value is `ScCallBlocks`, per condition a block of six options (stay, S, M, H, I,
//   W); the old `ScCall` rows and their helpers are deleted with the type. A block's options are found by `answer`.
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
  type ScCallAnswer,
  type ScCallBlock,
  type ScCallBlocks,
  type ScCallOption,
} from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { REJOIN, type RejoinOutput } from '../../src/rejoin/index.ts';
import { SC_CALL_CONFIG } from '../../src/sc-call/index.ts';
import { generated, once, OURS, PARAMS, viewAt, viewAtFrame, type ViewSpec } from '../strategy/support.ts';

export { OURS, PLAYER, TEAMMATE } from '../strategy/support.ts';

/**
 * The cap of the behaviour tests, through `sc-call`'s config override (C47; Task 18s: test speed): far below the
 * config's (pinned by the budget test). Three blocks of six options while green: 6 scenarios per option.
 */
export const CAP = 108;

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

/** `rejoin`'s race position of our car now (`Rejoin.position`): the stay option's rejoin. */
export const POSITION_NOW = 8;

/** `rejoin`'s value of one car: its rejoin positions per condition, the 4.2 losses and sources, its position now 8. */
export function rejoinOf(car: CarId, positions: Record<PitCondition, Known<number>> = POSITIONS, losses: Record<PitCondition, Known<Ms>> = LOSSES): Rejoin {
  const at = (condition: PitCondition): RejoinAt => ({
    condition,
    lossMs: losses[condition],
    lossSource: SOURCES[condition],
    rejoinPosition: positions[condition],
    order: unknown('insufficientData'),
  });
  return { carId: car, position: POSITION_NOW, conditions:{ green: at('green'), sc: at('sc'), vsc: at('vsc') } };
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
export function callOf(out: Record<CarId, ScCallBlocks>, car: CarId): ScCallBlocks {
  const v = out[car];
  if (v === undefined) throw new Error(`no sc call for car ${car}`);
  return v;
}

/** The six answers in the card's order (spec §6.3). */
export const ANSWERS: readonly ScCallAnswer[] = ['stay', 'S', 'M', 'H', 'I', 'W'];

/** The compound a box answer stops onto. */
export const COMPOUND_OF = { S: 'soft', M: 'medium', H: 'hard', I: 'inter', W: 'wet' } as const satisfies Record<Exclude<ScCallAnswer, 'stay'>, string>;

/** One condition's block of `call`; fails the test that asks when it is absent. */
export function blockOf(call: ScCallBlocks, condition: ScCallBlock['condition']): ScCallBlock {
  const b = call.blocks.find((x) => x.condition === condition);
  if (b === undefined) throw new Error(`no ${condition} block`);
  return b;
}

/** One answer's option of `block`; fails the test that asks when it is absent. */
export function optionOf(block: ScCallBlock, answer: ScCallAnswer): ScCallOption {
  const o = block.options.find((x) => x.answer === answer);
  if (o === undefined) throw new Error(`no ${answer} option in the ${block.condition} block`);
  return o;
}

/** Every `Known` field of an option. */
export const KNOWN_FIELDS = ['ePos', 'se', 'ePosDelta', 'pGain', 'rejoinPosition', 'positionPmf'] as const satisfies readonly (keyof ScCallOption)[];

export const NOT_APPLICABLE = unknown('notApplicable');
export const NO_SET = unknown('noSet');

/** An option's `Known` fields, to compare with `ALL_NOT_APPLICABLE` or `ALL_NO_SET`. */
export const knownsOf = (option: ScCallOption): Record<string, unknown> => Object.fromEntries(KNOWN_FIELDS.map((k) => [k, option[k]]));

/** Every `Known` field `unknown('notApplicable')`. */
export const ALL_NOT_APPLICABLE: Record<string, unknown> = Object.fromEntries(KNOWN_FIELDS.map((k) => [k, NOT_APPLICABLE]));

/** Every `Known` field `unknown('noSet')`. */
export const ALL_NO_SET: Record<string, unknown> = Object.fromEntries(KNOWN_FIELDS.map((k) => [k, NO_SET]));

/** Every option of every block of `call`, labelled `<condition> <answer>`. */
export const optionsOf = (call: ScCallBlocks): { label: string; option: ScCallOption }[] =>
  call.blocks.flatMap((b) => b.options.map((option) => ({ label: `${b.condition} ${option.answer}`, option })));
