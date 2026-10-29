import { known } from '@pitwall/domain';
import type { CarId, CarState, ErsAttack, ErsState, Known } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';
import { lapsToReach, perLapRate, PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import type { RateSample } from '../per-lap-rate/index.ts';
import { currentStintLaps } from '../shared/stint-laps.ts';
import { ERS, ERS_CONFIG } from './index.ts';
import type { ErsOutput } from './index.ts';

type View = Pick<EngineView, 'state' | 'config'>;

/** The store at the end of each lap of the current stint that counts for a rate, oldest first. */
function trendSamples(view: View, id: CarId): RateSample[] {
  const isRace = view.state.session.kind === 'race';
  return currentStintLaps(view.state.history, id).flatMap((l) =>
    classifyLap(l, { isRace }).forRate && l.ersStoreAtEndJ.known ? [{ lap: l.lapNumber, value: l.ersStoreAtEndJ.value, at: l.completedAt }] : [],
  );
}

function flowOf(power: CarState['energy']['power']): ErsState['flow'] {
  if (!power.known) return power;
  const { mgukW } = power.value;
  return known(mgukW > 0 ? 'deploying' : mgukW < 0 ? 'harvesting' : 'idle', power.at);
}

/** Ready at or above the level (as of the reading); below it, the laps to the level rounded up to whole laps, at least 1. */
function attackOf(storeJ: Known<number>, attackLevelJ: number, lapsToLevel: Known<number>): Known<ErsAttack> {
  if (!storeJ.known) return storeJ;
  if (storeJ.value >= attackLevelJ) return known({ ready: true }, storeJ.at);
  if (!lapsToLevel.known) return lapsToLevel;
  return known({ ready: false, inLaps: Math.max(1, Math.ceil(lapsToLevel.value)) }, lapsToLevel.at);
}

function ersOf(view: EngineView, car: EngineView['state']['cars'][number]): ErsState {
  const { deployLimitJ, capacityJ, attackLevelJ } = ERS_CONFIG.read(view);
  const constants = { capacityJ, deployLimitJ, attackLevelJ };
  const ers = car.energy.ers;
  if (!ers.known) {
    const hidden: Known<never> = ers;
    return {
      ...constants,
      storeJ: hidden,
      deployedThisLapJ: hidden,
      harvestedThisLapJ: hidden,
      storeTrendJPerLap: hidden,
      lapsToAttackLevel: hidden,
      attack: hidden,
      mode: hidden,
      flow: flowOf(car.energy.power),
    };
  }
  const { storeJ, deployedJ, harvestedMgukJ, harvestedMguhJ, mode } = ers.value;
  const trend = perLapRate(trendSamples(view, car.id), PER_LAP_RATE_CONFIG.read(view));
  const store = known(storeJ, ers.at);
  const lapsToAttackLevel = lapsToReach(trend, { value: storeJ, at: ers.at }, attackLevelJ, 'rising');
  return {
    ...constants,
    storeJ: store,
    deployedThisLapJ: known(deployedJ, ers.at),
    harvestedThisLapJ: known(harvestedMgukJ + harvestedMguhJ, ers.at),
    storeTrendJPerLap: trend.known ? known(trend.value.perLap, trend.at) : trend,
    lapsToAttackLevel,
    attack: attackOf(store, attackLevelJ, lapsToAttackLevel),
    mode: known(mode, ers.at),
    flow: flowOf(car.energy.power),
  };
}

/** The ERS state of every active car: store, this lap's flows, the store's trend over the stint, the laps to the attack level and the attack readiness. */
export const ersCalculator: QuickCalculator<ErsOutput> = {
  id: ERS,
  kind: 'quick',
  reads: ['laps', 'stints', 'energy', 'session'],
  cadence: { hz: 4 },
  compute: (view): ErsOutput => {
    const out: ErsOutput = {};
    for (const car of view.state.cars) if (car.active) out[car.id] = ersOf(view, car);
    return out;
  },
};
