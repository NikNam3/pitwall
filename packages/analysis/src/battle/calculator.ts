// `battle` (timing spec 6.3, live polish spec 3.1): each of our cars against the car ahead and the car behind. The gap
// now is from `gaps.intervals`; PACE Δ from the mini-sector crossings (`battle.ts`), and from it the margin and the laps
// to DRS; the DRS status from race control's spans. Incremental (C31): the accumulator folds the projection alone
// (C31.2); `output` adds `gaps`, the open spans and the live state. Every number is positive when it is good for our car.
import { known, unknown, type BattleCard, type BattleSide, type CarId, type CarState, type DrsOffReason, type DrsStatus, type Known, type Ms } from '@pitwall/domain';
import { openSpansOf, type DeepReadonly, type EngineView, type IncrementalCalculator } from '@pitwall/engine/readers';
import type { GapsOutput } from '../gaps/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { NEUTRALISATION_READS } from '../shared/neutralised.ts';
import { ourCars } from '../shared/our-cars.ts';
import { emptyBattleAcc, foldBattle, openNeutralised, paceDelta, type BattleAcc } from './battle.ts';
import { BATTLE, BATTLE_BEHAVIOUR, BATTLE_CONFIG, type BattleOutput } from './index.ts';

export type { BattleAcc } from './battle.ts';

const NOT_APPLICABLE = unknown('notApplicable');
type Car = DeepReadonly<CarState>;
type Config = ReturnType<typeof BATTLE_CONFIG.read>;

/**
 * The laps to DRS range on one side: (gap − `drsRangeMs`) / the closing car's edge per lap (`edge`, positive while the
 * gap closes). DRS off: `notApplicable`; the gap unknown: its reason; inside the range: 0 as of the gap; PACE Δ unknown:
 * its reason; not closing: `notApplicable`.
 */
function lapsToDrs(drs: DrsStatus, gapMs: Known<Ms>, pace: Known<Ms>, edge: number, drsRangeMs: number): Known<number> {
  if (!drs.enabled) return NOT_APPLICABLE;
  if (!gapMs.known) return gapMs;
  if (gapMs.value <= drsRangeMs) return known(0, gapMs.at);
  if (!pace.known) return pace;
  if (edge <= 0) return NOT_APPLICABLE;
  return known((gapMs.value - drsRangeMs) / edge, Math.max(gapMs.at, pace.at));
}

/** What one side needs besides the cars: the fold, the gaps, DRS, the neutralisations and the config. */
type Context = { acc: BattleAcc; view: EngineView; gaps: GapsOutput; drs: DrsStatus; neutralised: ReturnType<typeof openNeutralised>; config: Config };

function side(ctx: Context, ourId: CarId, theirId: CarId, isAhead: boolean): Known<BattleSide> {
  const { acc, view, gaps, drs, neutralised, config } = ctx;
  const ours = view.live.cars[ourId];
  const theirs = view.live.cars[theirId];
  if (ours === undefined || theirs === undefined) return NOT_APPLICABLE;
  const interval = gaps.intervals.find((i) => i.carId === ourId);
  const gapMs = (isAhead ? interval?.toAheadMs : interval?.toBehindMs) ?? unknown('notReceived');

  const { overtakeThresholdMs, drsRangeMs, minPaceSegments } = config;
  const pace = paceDelta(acc, view, [...acc.neutralised, ...neutralised], ourId, theirId, minPaceSegments);
  // the closing car's edge per lap: ours on the car ahead, theirs (−PACE Δ) on the car behind
  const edge = pace.known ? (isAhead ? pace.value : -pace.value) : 0;
  const margin: Known<{ kind: 'pass' | 'hold'; ms: Ms }> = !pace.known
    ? pace
    : known(isAhead ? { kind: 'pass', ms: (edge - overtakeThresholdMs) as Ms } : { kind: 'hold', ms: (overtakeThresholdMs - edge) as Ms }, pace.at);
  const ers = theirs.energy.ers;
  const tyre = (c: Car) => ({ compound: c.tyres.visualCompound, age: c.tyres.age });
  return known(
    {
      carId: theirId,
      gapMs,
      // removed in Task 15 of the live polish plan
      closingMsPerLap: NOT_APPLICABLE,
      lapsToDrs: lapsToDrs(drs, gapMs, pace, edge, drsRangeMs),
      paceDeltaMs: pace,
      // removed in Task 15 of the live polish plan; `margin` replaces it
      overtakeMarginMs: NOT_APPLICABLE,
      margin,
      ours: tyre(ours),
      theirs: tyre(theirs),
      theirErsStoreJ: ers.known ? known(ers.value.storeJ, ers.at) : ers,
    },
    view.live.sessionTime,
  );
}

/** Race control's DRS now; outside a race nothing restricts it, in a race before any span it is `notEnabledYet`. */
function drsOf(view: EngineView, race: boolean): DrsStatus {
  if (!race) return { enabled: true };
  const row = behaviourFor({ 'race-control-race': BATTLE_BEHAVIOUR['race-control-race'] }, view)[0];
  if (row === undefined) return { enabled: false, reason: 'notEnabledYet' };
  if (row.drs === 'enabled') return { enabled: true };
  const detail = openSpansOf(view, 'race-control-race')[0]?.detail as { reason?: DrsOffReason } | undefined;
  return { enabled: false, reason: detail?.reason ?? 'unknown' };
}

/** One of our cars against its neighbours in the order of `gaps.intervals`. */
function cardOf(ctx: Omit<Context, 'gaps'> & { gaps: GapsOutput | undefined }, computed: boolean, ourId: CarId): BattleCard {
  const { gaps, drs } = ctx;
  if (!computed) return { carId: ourId, ahead: NOT_APPLICABLE, behind: NOT_APPLICABLE, drs };
  if (gaps === undefined) return { carId: ourId, ahead: unknown('notReceived'), behind: unknown('notReceived'), drs };
  const withGaps = { ...ctx, gaps };
  const at = gaps.intervals.findIndex((i) => i.carId === ourId);
  const neighbour = (index: number) => (at < 0 ? undefined : gaps.intervals[index]?.carId);
  const aheadId = neighbour(at - 1);
  const behindId = neighbour(at + 1);
  return {
    carId: ourId,
    ahead: aheadId === undefined ? NOT_APPLICABLE : side(withGaps, ourId, aheadId, true),
    behind: behindId === undefined ? NOT_APPLICABLE : side(withGaps, ourId, behindId, false),
    drs,
  };
}

/** The cards of our cars: the player's car and the teammate's, race only. */
function output(acc: BattleAcc, view: EngineView): BattleOutput {
  const gaps = view.outputs.get('gaps') as GapsOutput | undefined;
  const phase = behaviourFor({ 'weekend-phase': BATTLE_BEHAVIOUR['weekend-phase'] }, view)[0];
  // a pending weekend phase (no span yet) reads as a race grid (C14): the cards are computed, DRS is not enabled yet
  const computed = phase === undefined || phase.cards === 'computed';
  const drs = drsOf(view, phase?.cards !== 'notApplicable');
  const ctx = { acc, view, gaps, drs, neutralised: computed && gaps !== undefined ? openNeutralised(view) : [], config: BATTLE_CONFIG.read(view) };
  const out: BattleOutput = {};
  for (const id of ourCars(view.live)) out[id] = cardOf(ctx, computed, id);
  return out;
}

/** The player's car and the teammate's against the cars next to them, with race control's DRS status; race only. */
export const battleCalculator: IncrementalCalculator<BattleAcc, BattleOutput> = {
  id: BATTLE,
  kind: 'incremental',
  reads: [
    { calculator: 'gaps' },
    'miniSectors',
    'spans:car-location',
    ...NEUTRALISATION_READS,
    'tyres',
    'energy',
    'identity',
    'spans:race-control-race',
    'spans:weekend-phase',
  ],
  cadence: 'frame',
  init: (view) => foldBattle(emptyBattleAcc(), view),
  // a flashback starts the fold over (C30, C31.5)
  update: (acc, delta, view) => foldBattle(delta.rewound !== undefined ? emptyBattleAcc() : acc, view),
  output,
};
