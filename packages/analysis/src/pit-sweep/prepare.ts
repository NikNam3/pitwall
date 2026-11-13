// `pit-sweep`'s job input (SP4.3b spec §9.2): the shared strategy input (`shared/strategy-input/`, C43) and, per our car,
// `pit-window`'s compounds with a new set, its `windowCompound`, `flag` and `stint.latest`, `rejoin`'s green rejoin
// position and the car's row of the behaviour table; the config. Structured-cloneable (C51).
import { known, unknown, type CarId, type Known, type NoiseCompound, type VisualCompound } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { PIT_WINDOW, type PitWindowOutput } from '../pit-window/index.ts';
import { REJOIN, type RejoinOutput } from '../rejoin/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { strategyInputFrom, type StrategyInput } from '../shared/strategy-input/index.ts';
import { PIT_SWEEP_BEHAVIOUR, type PitSweepEffect } from './behaviour.ts';
import { PIT_SWEEP_CONFIG, type PitSweepConfig } from './config.ts';

/** What the job sweeps for one of our cars. */
export type SweepCar = {
  /** The car's current lap (live timing): its sweep's lap while the starting point is unknown. */
  lap: number;
  /** By the behaviour table: `false` outside the race phase, in the pit lane and where the car does not race on. */
  applies: boolean;
  /** `pit-window`'s compounds with a new set, mapped to `NoiseCompound` (a set without one skipped), each once. */
  compounds: NoiseCompound[];
  /** `pit-window`'s `windowCompound`, mapped (`insufficientData` for one without a `NoiseCompound`). */
  auto: Known<NoiseCompound>;
  /** `pit-window`'s flag (the race's lap count), `unknown` without its value. */
  flag: Known<number>;
  /** `pit-window`'s `stint.latest`: the fitted set's latest stop lap by its life. */
  latest: Known<number>;
  /** `rejoin`'s green rejoin position (a stop now, C43). */
  greenRejoin: Known<number>;
};

/** The job's input: `strategy`'s input, per our car what it sweeps, and `pit-sweep`'s config. */
export type PitSweepInput = { strategy: StrategyInput; cars: Record<CarId, SweepCar>; config: PitSweepConfig };

/** `soft` … `wet` map to themselves; `superSoft` (F2 only) and `unknown` have none (plan Global Constraints, P28). */
const NOISE_OF: Partial<Record<VisualCompound, NoiseCompound>> = { soft: 'soft', medium: 'medium', hard: 'hard', inter: 'inter', wet: 'wet' };

/** A visual compound's `NoiseCompound`, or `undefined` without one. */
export const noiseCompoundOf = (c: VisualCompound): NoiseCompound | undefined => NOISE_OF[c];

/** The table's row of the situation's weekend phase; a pending one is read as the race (on the grid, C14). */
function phaseRow(view: EngineView): PitSweepEffect {
  const kind = view.situation.weekendPhase.kind;
  return kind === 'pending' ? 'sweep' : (PIT_SWEEP_BEHAVIOUR['weekend-phase']?.[kind] ?? 'notApplicable');
}

/** Car `car`'s sweep from `pit-window`'s and `rejoin`'s outputs. */
function sweepCarOf(view: EngineView, car: CarId, windows: PitWindowOutput, rejoins: RejoinOutput | undefined): SweepCar {
  const applies = phaseRow(view) === 'sweep' && behaviourFor(PIT_SWEEP_BEHAVIOUR, view, car).every((row) => row === 'sweep');
  const lap = view.live.cars.find((c) => c.id === car)?.timing.lap ?? 1;
  const greenRejoin = rejoins?.cars[car]?.conditions.green.rejoinPosition ?? unknown('insufficientData');
  const w = windows[car];
  if (w === undefined || !w.known) {
    const why = w === undefined ? 'insufficientData' : w.reason;
    return { lap, applies, compounds: [], auto: unknown(why), flag: unknown(why), latest: unknown(why), greenRejoin };
  }
  const value = w.value;
  const compounds: NoiseCompound[] = [];
  for (const set of value.sets) {
    const c = noiseCompoundOf(set.compound);
    if (c !== undefined && !compounds.includes(c)) compounds.push(c);
  }
  const wc = value.windowCompound;
  const mapped = wc.known ? noiseCompoundOf(wc.value) : undefined;
  const auto: Known<NoiseCompound> = !wc.known ? wc : mapped === undefined ? unknown('insufficientData') : known(mapped, wc.at);
  return { lap, applies, compounds, auto, flag: known(value.flag, w.at), latest: value.stint.latest, greenRejoin };
}

/** The job's input from the view (C39, C41: `strategy`'s reads, `pit-window`, `rejoin` and the config). */
export function preparePitSweep(view: EngineView): PitSweepInput {
  const strategy = strategyInputFrom(view);
  const windows = (view.outputs.get(PIT_WINDOW) as PitWindowOutput | undefined) ?? {};
  const rejoins = view.outputs.get(REJOIN) as RejoinOutput | undefined;
  const cars: Record<CarId, SweepCar> = {};
  for (const car of strategy.ourCars) cars[car] = sweepCarOf(view, car, windows, rejoins);
  return { strategy, cars, config: PIT_SWEEP_CONFIG.read(view) };
}
