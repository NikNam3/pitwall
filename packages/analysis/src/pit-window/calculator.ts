// `pit-window` (SP4.2 spec 3.4): per our car the fitted set's latest stop lap and, per compound we still have a new set of
// (the compound rule applied), the window from which a new set of it reaches the flag; the car's `window` state. Every lap
// is a stop lap: the lap at whose end the car boxes. Quick (C31). Race only (C14): elsewhere our car's value is
// `notApplicable`; `notReceived` until the tyre sets arrive.
import { known, unknown, type CarId, type Known, type PitWindow, type PitWindowSet, type PitWindowState, type VisualCompound } from '@pitwall/domain';
import { openSpansOf, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { behaviourFor, type BehaviourTable } from '../shared/behaviour.ts';
import { ourCars } from '../shared/our-cars.ts';
import { TYRE_LIFE, type TyreLife, type TyreLifeOutput } from '../tyre-life/index.ts';
import { PIT_WINDOW_BEHAVIOUR, phaseRow, type PitWindowEffect } from './behaviour.ts';
import { PIT_WINDOW_CONFIG } from './config.ts';
import { PIT_WINDOW, type PitWindowOutput } from './index.ts';

const ACTIVITY = 'car-activity-race';
const WET: ReadonlySet<VisualCompound> = new Set(['inter', 'wet']);
const DRY: ReadonlySet<VisualCompound> = new Set(['soft', 'medium', 'hard', 'superSoft']);
const INSUFFICIENT = unknown('insufficientData');

/** Whether `a` and `b` are of one type: both dry, or both inter or wet. */
const sameTypeOf = (a: VisualCompound, b: VisualCompound): boolean => (DRY.has(a) && DRY.has(b)) || (WET.has(a) && WET.has(b));

/** The newest of several `Known.at`s. */
const atOf = (...ks: Known<unknown>[]): number => ks.reduce((t, k) => (k.known ? Math.max(t, k.at) : t), 0);

/** The table without the session's row: the car's machines. */
const CAR_TABLE: BehaviourTable<PitWindowEffect> = {
  'compound-rule': PIT_WINDOW_BEHAVIOUR['compound-rule'] ?? {},
  [ACTIVITY]: PIT_WINDOW_BEHAVIOUR[ACTIVITY] ?? {},
};

/**
 * The stint's first lap and the frame from which a box stop counts as one since the stint start: the lap after the car's
 * newest stop (its pit exit's frame), at least the lap the fitted set's age gives, at least lap 1.
 */
function stintStart(view: EngineView, car: CarId, currentLap: number, age: number): { fromLap: number; sinceFrame: number } {
  let fromLap = Math.max(1, currentLap - age);
  let sinceFrame = Number.NEGATIVE_INFINITY;
  for (const stop of view.history.pitStops) {
    if (stop.carId !== car || stop.frame <= sinceFrame) continue;
    sinceFrame = stop.frame;
    fromLap = Math.max(1, currentLap - age, Math.min(currentLap, stop.lap + 1));
  }
  return { fromLap, sinceFrame };
}

/** Whether a box-stop row's span (open or closed) of our car opened after `sinceFrame`. */
function stoppedSince(view: EngineView, car: CarId, sinceFrame: number): boolean {
  const rows = PIT_WINDOW_BEHAVIOUR[ACTIVITY] ?? {};
  const stopped = (s: { kind: string; carId?: CarId | undefined; startFrame: number }): boolean =>
    s.carId === car && s.startFrame > sinceFrame && rows[s.kind]?.stopped === true;
  return (view.history.spans[ACTIVITY] ?? []).some(stopped) || openSpansOf(view, ACTIVITY, car).some(stopped);
}

/** What a set's state depends on besides its own window: the current lap, the lead, and whether every window is closed. */
type StateContext = { currentLap: number; windowLeadLaps: number; closed: boolean };

/**
 * One compound's row (spec 3.4): its life, the first stop lap from which it reaches the flag, its life end from `latest`;
 * its window (stop laps `earliest` to `latest`, none when it does not reach the flag or opens after `latest`) and its state.
 */
function setRow(
  compound: VisualCompound,
  fitted: VisualCompound,
  life: TyreLife | undefined,
  flag: number,
  fromLap: number,
  latest: Known<number>,
  ctx: StateContext,
): PitWindowSet {
  const lifeLaps: Known<number> = life?.freshLifeLaps[compound] ?? INSUFFICIENT;
  const earliest: Known<number> = lifeLaps.known ? known(Math.max(flag - lifeLaps.value, fromLap), lifeLaps.at) : lifeLaps;
  const lifeEnd: Known<number> = !lifeLaps.known ? lifeLaps : !latest.known ? latest : known(latest.value + lifeLaps.value, atOf(latest, lifeLaps));
  const reaches: Known<boolean> = lifeEnd.known ? known(lifeEnd.value >= flag, lifeEnd.at) : lifeEnd;
  let windowLaps: Known<{ from: number; to: number }>;
  let state: Known<PitWindowState>;
  if (!latest.known) {
    windowLaps = latest;
    state = latest;
  } else if (!(reaches.known && reaches.value && earliest.known && earliest.value <= latest.value)) {
    windowLaps = unknown('notApplicable');
    state = known('none', latest.at);
  } else {
    const opens = earliest.value;
    const at = atOf(latest, reaches, earliest);
    const value: PitWindowState = ctx.closed
      ? 'closed'
      : ctx.currentLap >= opens
        ? 'open'
        : ctx.currentLap >= opens - ctx.windowLeadLaps
          ? 'lead'
          : 'before';
    windowLaps = known({ from: opens, to: latest.value }, at);
    state = known(value, at);
  }
  return { compound, sameType: sameTypeOf(compound, fitted), lifeLaps, earliest, lifeEnd, reaches, windowLaps, state };
}

/** Rows by the stop lap they open from (unknown last), then the longer life, then the allocation's order. */
const byEarliest = (a: PitWindowSet, b: PitWindowSet): number => {
  const e = (s: PitWindowSet) => (s.earliest.known ? s.earliest.value : Number.POSITIVE_INFINITY);
  const l = (s: PitWindowSet) => (s.lifeLaps.known ? s.lifeLaps.value : Number.NEGATIVE_INFINITY);
  return e(a) - e(b) || l(b) - l(a);
};

/** Our car's `pitWindow.car` value. */
function pitWindowOf(view: EngineView, car: CarId, life: TyreLife | undefined, windowLeadLaps: number): Known<PitWindow> {
  const state = view.live.cars[car];
  if (state === undefined) return unknown('notReceived');
  const { tyres } = state;
  if (!tyres.sets.known) return tyres.sets;
  const flag = view.live.session.totalLaps;
  const currentLap = state.timing.lap;
  const fitted = tyres.visualCompound;
  const effect: PitWindowEffect = Object.assign({}, ...behaviourFor(CAR_TABLE, view, car));
  const { fromLap, sinceFrame } = stintStart(view, car, currentLap, tyres.age);

  // the last lap the fitted set can run (a set at its limit: this one), and the latest stop lap (a stop at the flag is none)
  const lapsToLimit: Known<number> = life?.lapsToLimit ?? INSUFFICIENT;
  const last: Known<number> = lapsToLimit.known ? known(currentLap + Math.floor(lapsToLimit.value), lapsToLimit.at) : lapsToLimit;
  const latest: Known<number> = last.known ? known(Math.min(last.value, flag - 1), last.at) : last;
  const pastLimit = (lapsToLimit.known && lapsToLimit.value < 1) || (latest.known && currentLap > latest.value);

  // without the rule to meet, a set that runs the final lap needs no stop
  const noStop = effect.ruleRequired !== true && last.known && last.value >= flag;
  const stopNeeded: Known<boolean> = latest.known ? known(!noStop, latest.at) : latest;
  const compounds: VisualCompound[] = [];
  if (!noStop) {
    for (const s of tyres.sets.value.sets) {
      if (!s.available || s.fitted || s.wearPct !== 0 || compounds.includes(s.visualCompound)) continue;
      if (effect.ruleRequired === true && s.visualCompound === fitted) continue;
      compounds.push(s.visualCompound);
    }
  }
  // every window closes once the fitted set is past its limit or the car boxed since the stint start
  const ctx: StateContext = { currentLap, windowLeadLaps, closed: pastLimit || stoppedSince(view, car, sinceFrame) };
  const sets = compounds.map((c) => setRow(c, fitted, life, flag, fromLap, latest, ctx)).sort(byEarliest);

  // the car's window: its first same-type set with a window
  let window: Known<PitWindowState>;
  let windowCompound: Known<VisualCompound>;
  if (!latest.known) {
    window = latest;
    windowCompound = latest;
  } else {
    const first = sets.find((s) => s.sameType && s.windowLaps.known);
    if (first === undefined) {
      window = known('none', latest.at);
      windowCompound = unknown('notApplicable');
    } else {
      window = first.state;
      windowCompound = known(first.compound, first.windowLaps.known ? first.windowLaps.at : latest.at);
    }
  }

  return known(
    { carId: car, flag, currentLap, stint: { compound: fitted, fromLap, latest, stopNeeded, pastLimit }, sets, window, windowCompound },
    atOf(tyres.sets, latest),
  );
}

export const pitWindowCalculator: QuickCalculator<PitWindowOutput> = {
  id: PIT_WINDOW,
  kind: 'quick',
  reads: [{ calculator: TYRE_LIFE }, 'identity', 'tyres', 'session', 'laps', 'pitStops', 'decisions', 'timing', 'spans:weekend-phase', 'spans:compound-rule', 'spans:car-activity-race'],
  cadence: { hz: 4 },
  compute: (view): PitWindowOutput => {
    // the session's row (the weekend phase), over the race's (C14: a pending phase reads as the race)
    const session: PitWindowEffect = Object.assign(
      {},
      phaseRow('pending'),
      ...behaviourFor({ 'weekend-phase': PIT_WINDOW_BEHAVIOUR['weekend-phase'] ?? {} }, view),
    );
    const out: PitWindowOutput = {};
    const cars = ourCars(view.live);
    if (session.notApplicable === true) {
      for (const car of cars) out[car] = unknown('notApplicable');
      return out;
    }
    const lives = view.outputs.get(TYRE_LIFE) as TyreLifeOutput | undefined;
    const { windowLeadLaps } = PIT_WINDOW_CONFIG.read(view);
    for (const car of cars) out[car] = pitWindowOf(view, car, lives?.[car], windowLeadLaps);
    return out;
  },
};
