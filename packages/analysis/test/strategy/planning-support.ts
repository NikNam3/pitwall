// Shared setup of the planning job's tests (SP4.3d2 Task 9, spec §7.1 steps 4–5, §7.2; C51, C62d): a builder race
// recast as the ended qualifying session the planning job reads (its as-of view at its end, `fixed.totalLaps` the race's
// laps as the user entered them, C62d), the planning round's prepared plans, and the job run as the job runner runs it
// (`PLANNING_JOB.parts`: split, each part in its own worker with the strategy job's module, merged).
//
// How these tests read the planning job (the test agent's decisions, Task 9):
// - The qualifying session is a builder race's view after its last frame (`./support.ts`' `viewAtFrame`, our cars 2
//   and 5 with their sets) seen as qualifying: its weekend phase `qualifying` one-shot (the grid is the best valid laps'
//   order, no earlier segment, spec §7.0 rule 5), the race-only sub-machines' spans (session-phase-race,
//   race-control-race, car-activity-race, compound-rule, penalties) removed from the situation and the projection, the
//   qualifying session phase `finished`. Its laps, stints and stops stay as the builder recorded them: a qualifying
//   session's laps are laps too.
// - `fixed.weatherNow.nextForecast` holds the race's forecast samples (spec §7.3), `fixed.setsNow` the cars' sets.
// - `PLANNING_JOB.module` is the strategy job's module: its `run` is `runStrategy` (exported by `strategy/index.ts`).
import { known, type CarId, type ForecastSample, type Policy, type Slot, type StrategyOutput } from '@pitwall/domain';
import { asOfNow, createRng, type AsOfView } from '@pitwall/engine/readers';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { PLANNING_JOB, runStrategy, type StrategyInput } from '../../src/strategy/index.ts';
import { openSpan } from '../situated.ts';
import { viewAtFrame, type ViewSpec } from './support.ts';

/** The sub-machines that run only in the race (C17): none of them has a span in a qualifying session. */
const RACE_ONLY = new Set(['session-phase-race', 'race-control-race', 'car-activity-race', 'compound-rule', 'penalties']);

/** The race's forecast as qualifying's last Session packet lists it: dry, then up to 60 % rain. */
export const RACE_FORECAST: readonly ForecastSample[] = [0, 15, 30, 45, 60].map((offsetMin, i) => ({
  offsetMin,
  weather: i < 2 ? 'overcast' : 'lightRain',
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 22,
  airTempTrend: 'flat',
  rainPct: [0, 10, 60, 40, 20][i]!,
}));
/** The highest rain chance of `RACE_FORECAST`'s samples. */
export const RACE_FORECAST_MAX_RAIN = 60;

export type QualifyingSpec = Pick<ViewSpec, 'sets' | 'config'> & {
  /** The race's laps as entered (`fixed.totalLaps`, C62d). */
  laps: number;
  /** The race's forecast samples; `null`: the session's weather holds none (default `RACE_FORECAST`). */
  forecast?: readonly ForecastSample[] | null;
};

/**
 * The ended qualifying session's as-of view (spec §7.0 rule 4) from builder race `race`: the view after its last frame,
 * seen as a one-shot qualifying (see the header), `fixed.totalLaps` the race's entered laps.
 */
export function qualifyingAsOf(race: BuilderRace, spec: QualifyingSpec): AsOfView {
  const view = viewAtFrame(race, race.lastFrame, { ...(spec.sets !== undefined && { sets: spec.sets }), ...(spec.config !== undefined && { config: spec.config }) });
  const now = asOfNow({ ...view, outputs: new Map() });
  const byMachine: Record<string, unknown[]> = {};
  for (const [machine, spans] of Object.entries(view.situation.byMachine)) if (!RACE_ONLY.has(machine) && machine !== 'weekend-phase') byMachine[machine] = [...spans];
  byMachine['weekend-phase'] = [openSpan('weekend-phase', 'qualifying', { detail: { format: 'oneShot', segment: undefined } })];
  byMachine['session-phase-qualifying'] = [openSpan('session-phase-qualifying', 'finished')];
  const spans = Object.fromEntries(Object.entries(view.history.spans).filter(([machine]) => !RACE_ONLY.has(machine)));
  const weatherNow = now.fixed.weatherNow;
  const forecast = spec.forecast === undefined ? RACE_FORECAST : spec.forecast;
  return {
    history: { ...view.history, spans },
    situation: { weekendPhase: { kind: 'qualifying', format: 'oneShot', segment: undefined }, byMachine } as AsOfView['situation'],
    frame: 'now',
    at: now.at,
    config: now.config,
    priors: now.priors,
    drivers: now.drivers,
    track: now.track,
    basis: now.basis,
    outputs: new Map(),
    fixed: {
      totalLaps: known(spec.laps, 0),
      playerCar: now.fixed.playerCar,
      teammateCar: now.fixed.teammateCar,
      aiDifficulty: now.fixed.aiDifficulty,
      safetyCar: now.fixed.safetyCar,
      carKeys: known(view.live.cars.map((c) => ({ teamId: c.identity.teamId, raceNumber: c.identity.raceNumber })), 0),
      setsNow: now.fixed.setsNow,
      weatherNow: weatherNow === null ? null : { ...weatherNow, nextForecast: forecast === null ? [] : [...forecast] },
    },
  };
}

/** One car's prepared plans as the planning round hands them to the job. */
export type PreparedRound = Record<CarId, { saved: Partial<Record<Slot, Policy>>; active: Slot | null }>;

/** No car has prepared plans. */
export const NO_PLANS = (cars: readonly CarId[]): PreparedRound => Object.fromEntries(cars.map((c) => [c, { saved: {}, active: null }])) as PreparedRound;

/** `PLANNING_JOB.parts`; fails the test that asks when the job declares none. */
export function planningParts(): NonNullable<typeof PLANNING_JOB.parts> {
  const parts = PLANNING_JOB.parts;
  if (parts === undefined) throw new Error('PLANNING_JOB declares no parts (the strategy job\'s parts, one per our car)');
  return parts;
}

/** The planning job's output on `input` as the job runner computes it: split, each part cloned into its worker with seed `seed`, merged. */
export function runPlanning(input: StrategyInput, seed: number): StrategyOutput {
  const parts = planningParts();
  return parts.merge(parts.split(structuredClone(input)).map((part: StrategyInput) => runStrategy(structuredClone(part), createRng(seed))));
}
