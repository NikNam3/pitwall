// `race-forecast` (SP4.3a spec 6.3): a simulator (C50): the field to the flag under one scenario and one policy per
// car, from a starting point `forecast-field` built; draws only from the injected generator (C2). No reads, no
// cadence, no topic.
//
// Every car steps from point to point of the lap (braking zones, DRS detections and ends, the line; S25), all cars at
// one point before any at the next, in race order. A follower is held `minGapMs` behind the car ahead; at a braking zone
// a held, faster car passes by the pass curve on its pace advantage. Interaction is only between neighbours in race
// order, so a lapped car never holds a faster one (blue flags). Stops, retirements and neutralisations are events at
// the points; the lap's time comes from `lap-model`.
import type { ForecastResult, PassCurve, Policy, Scenario, StartingPoint } from '@pitwall/domain';
import { defineSimulator, type Rng } from '@pitwall/engine/readers';
import { DOUBLE_STACK_MS, HUMAN_STOP_SAVING_MS, MEDIAN_PASS_HAZARD, PASS_MARGIN_MS, PLAIN_PASS_MIN_ADVANTAGE_MS } from './constants.ts';
import { PURPOSE, streamKey, uniform } from './draws.ts';
import { createField, endLap, fitStop, lineIndex, NEUTRAL, SLOT, startLap, stopAt, STRIDE, wetnessOn, type Field } from './field.ts';
import { lapPointsOf, POINT, type LapPoints } from './points.ts';
import { result } from './result.ts';

export const SIMULATOR = defineSimulator('race-forecast');

// The hot loop's imports, bound once: under a module runner (vitest) every use of an import is a property read on its
// module's namespace, which keeps the loop from being optimised (the budget, spec 10).
const BRAKING = POINT.braking;
const DETECTION = POINT.detection;
const DRS_END = POINT.drsEnd;
const LINE = POINT.line;
const GREEN = NEUTRAL.none;
const SC = NEUTRAL.sc;
const PASS = PURPOSE.pass;
const MEDIAN_HAZARD = MEDIAN_PASS_HAZARD;
const MARGIN_MS = PASS_MARGIN_MS;
const uniformDraw = uniform;
const keyOf = streamKey;
const lapStart = startLap;
const lapEnd = endLap;
const lineAt = lineIndex;
const W = STRIDE;
const T_LAST = SLOT.tLast;
const G_NEXT = SLOT.gNext;
const RETIRE_AT = SLOT.retireAt;
const LAP_MS = SLOT.lapMs;
const GREEN_MS = SLOT.greenMs;
const NEUTRAL_AT = SLOT.neutral;
const IN_LAP = SLOT.inLap;
const HAZARD = SLOT.hazard;
const HELD_BY = SLOT.heldBy;
const DRS_RANGE = SLOT.drsRange;
const DRS_PASS = SLOT.drsPass;

/** A follower this close to `minGapMs` (floating error) counts as held. */
const HELD_EPS_MS = 1e-6;
const PIT_LOSS = ['green', 'vsc', 'sc'] as const;

/**
 * The pass chance at one braking zone, the model `race-interaction` fits (`race-interaction/fit.ts`; SP4.3b Task 10b):
 * cap · σ(level + slopePerMs · advantageMs + drsFactor · [DRS]), × wetFactor when wet; `drs`: a zone after a DRS zone.
 */
export function passChance(curve: PassCurve, wet: boolean, drs: boolean, advantageMs: number): number {
  const eta = curve.level + curve.slopePerMs * advantageMs + (drs ? curve.drsFactor : 0);
  return ((wet ? curve.wetFactor : 1) * curve.cap) / (1 + Math.exp(-eta));
}

/** The session's pass curve: its band's, else the first band's; none passes without a band. */
function curveOf(start: StartingPoint): PassCurve | undefined {
  const { bands, band } = start.interaction;
  return (band.known ? bands[band.value]?.curve : undefined) ?? bands[0]?.curve;
}

type Run = { f: Field; pts: LapPoints; order: Int16Array; m: number };

/** DRS is enabled from `fromLap` (`start.drs`), off on a neutralised lap and the lap after one. */
const drsOn = (f: Field, fromLap: number, lap: number): boolean => lap >= fromLap && f.neutralByLap[lap] === GREEN && f.neutralByLap[lap - 1] === GREEN;

/** Where global point `g` is, in laps (lap number plus lap fraction; the line ends its lap). */
const posOf = (pts: LapPoints, g: number): number => {
  const P = pts.fraction.length;
  const i = g % P;
  return (g - i) / P + (pts.fraction[i] ?? 0);
};

/** Car `c`'s time at point `g`; back-extrapolated at its lap time for a car that started the forecast past `g`. */
function tAt(r: Run, c: number, g: number): number {
  const car = r.f.car;
  const last = (car[c * W + G_NEXT] ?? 0) - 1;
  const t = car[c * W + T_LAST] ?? 0;
  if (last === g) return t;
  return t - (posOf(r.pts, last) - posOf(r.pts, g)) * (car[c * W + LAP_MS] ?? 0);
}

/** The field at the flag (or at `opts.toLap`) under `scenario`, each car following its policy (by car slot). */
export function raceForecast(start: StartingPoint, policies: readonly Policy[], scenario: Scenario, rng: Rng, opts?: { trace?: boolean; toLap?: number }): ForecastResult {
  const pts = lapPointsOf(start.track.brakingZones, start.track.drsZones);
  const P = pts.fraction.length;
  const toLap = opts?.toLap;
  const toFlag = toLap === undefined || toLap >= start.lapsTotal;
  const lastLap = toFlag ? start.lapsTotal : toLap;
  const f = createField(start, policies, scenario, rng.int(0, 2_147_483_647), lastLap);
  const order = f.order;
  let m = 0;
  for (const c of start.order) if (f.running[c] === 1) order[m++] = c;
  const r: Run = { f, pts, order, m };
  place(r);

  const it = start.interaction;
  const minGapMs = it.minGapMs;
  const heldWithinMs = minGapMs + HELD_EPS_MS;
  const drsGainMs = it.drsStraightGainMs;
  // the one DRS rule, race-interaction's (forecast-field fills it, F7)
  const drsRangeMs = start.drs.rangeMs;
  const drsFromLap = start.drs.fromLap;
  const curve = curveOf(start);
  // a wet lap scales the pass chance; per lap where the scenario carries a wetness path (SP4.3b spec §7.1)
  const wetPath = f.wetnessByLap !== undefined;
  let wet = start.wetness.wetnessMs > 0;
  const plain = f.plain;
  const fieldDraws = f.draws;
  const { car, running } = f;
  const kinds = pts.kind;
  const fractions = pts.fraction;
  const segments = pts.segment;

  // the loop's counters stay small integers (a double counter makes every point's `%` a float modulus)
  let gFrom = 0x7fffffff;
  // from `gSync` on every running car reaches every point (each car steps every point from its first)
  let gSync = 0;
  for (let k = 0; k < r.m; k++) {
    const gNext = car[(order[k] ?? 0) * W + G_NEXT] ?? 0;
    gFrom = Math.min(gFrom, gNext);
    gSync = Math.max(gSync, gNext);
  }
  const gEnd = lastLap * P + P - 1;
  let i = gFrom % P;
  let lap = (gFrom - i) / P;
  if (wetPath) wet = wetnessOn(f, lap) > 0;
  for (let g = gFrom; g <= gEnd; g++) {
    const kind = kinds[i] ?? LINE;
    const at = fractions[i] ?? 1;
    const segment = segments[i] ?? 0;
    const drs = (kind === DETECTION || kind === DRS_END) && drsOn(f, drsFromLap, lap);
    const drsEnd = kind === DRS_END && drs;
    const gAfter = g + 1;
    const synced = g >= gSync;
    let m = r.m;
    // the car ahead, its state's offset, and (when `aheadAt`, it has already stepped this point) its time here
    let ahead = -1;
    let a = 0;
    let aheadAt = false;
    let aheadT = 0;
    for (let k = 0; k < m; k++) {
      const c = order[k] ?? 0;
      const b = c * W;
      if (!synced && car[b + G_NEXT] !== g) {
        ahead = c;
        a = b;
        aheadAt = false;
        continue;
      }
      if (at >= (car[b + RETIRE_AT] ?? 2)) {
        // it retires before this point: it leaves the race order
        running[c] = 0;
        order.copyWithin(k, k + 1, m);
        m--;
        r.m = m;
        k--;
        continue;
      }
      // under SC a follower closes up at its green pace; the queue's front runs the SC's
      const nc = car[b + NEUTRAL_AT] ?? GREEN;
      let t = (car[b + T_LAST] ?? 0) + segment * ((nc === SC && ahead >= 0 ? car[b + GREEN_MS] : car[b + LAP_MS]) ?? 0);
      if (drsEnd && car[b + DRS_RANGE] === 1) t -= drsGainMs;
      let passed = false;
      let passedT = 0;
      if (ahead >= 0) {
        // the car ahead has mostly just passed this point (always once synced); else its time is back-extrapolated
        const ta = aheadAt ? aheadT : tAt(r, ahead, g);
        const within = t - ta <= heldWithinMs;        if (!within || car[b + HELD_BY] !== ahead) car[b + HAZARD] = 0;
        car[b + HELD_BY] = within ? ahead : -1;
        t = Math.max(t, ta + minGapMs);
        if (kind === BRAKING) {
          if (within && curve !== undefined && nc === GREEN) {
            const advantageMs = (car[a + GREEN_MS] ?? 0) - (car[b + GREEN_MS] ?? 0);
            if (advantageMs > 0 && car[a + NEUTRAL_AT] === GREEN && car[b + IN_LAP] === 0) {
              const p = passChance(curve, wet, car[b + DRS_PASS] === 1, advantageMs);
              let passes: boolean;
              if (plain && advantageMs <= PLAIN_PASS_MIN_ADVANTAGE_MS) {
                // plain is the mode: below the minimum advantage a pass is less likely than not, so it stays behind
                passes = false;
              } else if (plain) {
                // plain: the held car passes once its summed hazard reaches the median pass time's
                const h = (car[b + HAZARD] ?? 0) + (p >= 1 ? Infinity : -Math.log1p(-p));
                car[b + HAZARD] = h;
                passes = h >= MEDIAN_HAZARD;
              } else passes = uniformDraw(keyOf(fieldDraws, c, lap), PASS, i) < p;
              if (passes) {
                t = ta - MARGIN_MS;
                order[k - 1] = c;
                order[k] = ahead;
                car[b + HAZARD] = 0;
                car[b + HELD_BY] = -1;
                // the passed car now leads the next one, at its time here
                passed = true;
                passedT = ta;
              }
            }
          }
          car[b + DRS_PASS] = 0;
        } else if (kind === DETECTION) car[b + DRS_RANGE] = drs && t - ta <= drsRangeMs ? 1 : 0;
        else if (kind === DRS_END) car[b + DRS_PASS] = drs && car[b + DRS_RANGE] === 1 && car[a + DRS_RANGE] === 0 ? 1 : 0;
      } else {
        car[b + HELD_BY] = -1;
        car[b + HAZARD] = 0;
        if (kind === DETECTION) car[b + DRS_RANGE] = 0;
        else if (kind === DRS_END || kind === BRAKING) car[b + DRS_PASS] = 0;
      }
      car[b + T_LAST] = t;
      car[b + G_NEXT] = gAfter;
      // a car entering the pits holds nobody at the line
      if (!(kind === LINE && car[b + IN_LAP] === 1)) {
        ahead = order[k] ?? c;
        a = ahead * W;
        aheadAt = true;
        aheadT = passed ? passedT : t;
      }
    }
    if (kind === LINE) crossLine(r, g, lap);
    if (++i === P) {
      i = 0;
      lap++;
      if (wetPath) wet = wetnessOn(f, lap) > 0;
    }
  }
  return result(f, toFlag, opts?.trace === true);
}

/**
 * The lap car `c` is on at the start: the leader's lap `start.lap`, or the one before for a car past the leader's lap
 * fraction (behind it, not yet at the line). The forecast's one rule; `forecast-score`'s policies read it too.
 */
export function startLapOf(start: StartingPoint, c: number): number {
  const leader = start.order.find((k) => start.retired[k] !== 1);
  const leaderFraction = leader === undefined ? 0 : (start.lapFraction[leader] ?? 0);
  return (start.lapFraction[c] ?? 0) > leaderFraction ? start.lap - 1 : start.lap;
}

/** Every car on its lap at its lap fraction (`startLapOf`), its last point's time back-extrapolated. */
function place(r: Run): void {
  const { f, pts, order } = r;
  const s = f.start;
  const P = pts.fraction.length;
  for (let k = 0; k < r.m; k++) {
    const c = order[k] ?? 0;
    const at = s.lapFraction[c] ?? 0;
    const lap = startLapOf(s, c);
    // at its line with a stop at the end of the lap it just finished: its in-lap is done, it is in the pit lane (F2)
    const pitting = at === 0 && lap >= 1 ? stopAt(f, c, lap - 1) : -1;
    if (pitting !== -1) fitStop(f, c, pitting);
    lapStart(f, c, lap, at, true);
    let i = 0;
    while ((pts.fraction[i] ?? 1) <= at) i++;
    const lapMs = f.car[c * W + LAP_MS] ?? 0;
    f.car[c * W + G_NEXT] = lap * P + i;
    f.car[c * W + T_LAST] = -(at - (i === 0 ? 0 : (pts.fraction[i - 1] ?? 0))) * lapMs;
    // it pays the out-lap part of its stop's loss only
    if (pitting !== -1) f.car[c * W + T_LAST] = (f.car[c * W + T_LAST] ?? 0) + outLapLossMs(s, c, PIT_LOSS[f.neutralByLap[lap - 1] ?? GREEN] ?? 'green');
    if (lap >= 1) f.lineT[lineAt(f, c, lap - 1)] = -at * lapMs;
  }
}

type Condition = (typeof PIT_LOSS)[number];

/** The in-lap's part of a stop's loss under `condition`: `inLapShare` of it (F2). */
const inLapLossMs = (s: StartingPoint, condition: Condition): number => s.track.pitLossMs.inLapShare * s.track.pitLossMs[condition];

/** The rest of car `c`'s loss, paid after the line: a human's shorter stationary time comes off it. */
const outLapLossMs = (s: StartingPoint, c: number, condition: Condition): number =>
  s.track.pitLossMs[condition] - inLapLossMs(s, condition) - (s.human[c] === 1 ? HUMAN_STOP_SAVING_MS : 0);

/** Every car crossed the line ending `lap` at point `g`: its line time, its stop (loss, double stack), its next lap. */
function crossLine(r: Run, g: number, lap: number): void {
  const { f, order } = r;
  const s = f.start;
  const car = f.car;
  let stopped = false;
  let boxFreeAt = -Infinity;
  for (let k = 0; k < r.m; k++) {
    const c = order[k] ?? 0;
    const b = c * W;
    if (car[b + G_NEXT] !== g + 1) continue;
    // placed just past this line (its line time set by place): it crossed it before the start
    if (!Number.isNaN(f.lineT[lineAt(f, c, lap)] ?? Number.NaN)) continue;
    const kind = car[b + NEUTRAL_AT] ?? GREEN;
    const condition = PIT_LOSS[kind] ?? 'green';
    // a stopping car's in-lap pays its share of the loss before the line (F2)
    const entry = (car[b + T_LAST] ?? 0) + (car[b + IN_LAP] === 1 ? inLapLossMs(s, condition) : 0);
    car[b + T_LAST] = entry;
    f.lineT[lineAt(f, c, lap)] = entry;
    if (lapEnd(f, c, lap) !== undefined) {
      stopped = true;
      let lossMs = outLapLossMs(s, c, condition);
      if (f.setsUsed.has(c)) {
        // our cars share one box: a car entering while it is busy waits for it
        const wait = Math.max(0, boxFreeAt - entry);
        lossMs += wait;
        boxFreeAt = entry + wait + DOUBLE_STACK_MS;
      }
      car[b + T_LAST] = entry + lossMs;
    }
    if (lap + 1 <= f.endLap) lapStart(f, c, lap + 1, 0, false);
  }
  if (!stopped) return;
  // the stoppers rejoin where their time puts them (stable insertion sort; only stoppers move back)
  for (let k = 1; k < r.m; k++) {
    const c = order[k] ?? 0;
    const t = tAt(r, c, g);
    let j = k - 1;
    while (j >= 0 && tAt(r, order[j] ?? 0, g) > t) {
      order[j + 1] = order[j] ?? 0;
      j--;
    }
    order[j + 1] = c;
  }
}
