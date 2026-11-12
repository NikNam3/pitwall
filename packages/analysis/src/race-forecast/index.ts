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
import { DOUBLE_STACK_MS, DRS_FROM_LAP, DRS_RANGE_MS, HUMAN_STOP_SAVING_MS, MEDIAN_PASS_HAZARD, PASS_MARGIN_MS } from './constants.ts';
import { draws, PURPOSE, streamKey, uniform } from './draws.ts';
import { createField, endLap, lineIndex, NEUTRAL, startLap, type Field } from './field.ts';
import { lapPoints, POINT, type LapPoints } from './points.ts';
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
const RANGE_MS = DRS_RANGE_MS;
const FROM_LAP = DRS_FROM_LAP;
const MEDIAN_HAZARD = MEDIAN_PASS_HAZARD;
const MARGIN_MS = PASS_MARGIN_MS;
const uniformDraw = uniform;
const keyOf = streamKey;
const lapStart = startLap;
const lapEnd = endLap;
const lineAt = lineIndex;

/** A follower this close to `minGapMs` (floating error) counts as held. */
const HELD_EPS_MS = 1e-6;
const PIT_LOSS = ['green', 'vsc', 'sc'] as const;

/** The pass chance at one braking zone (`PassCurve`), with the DRS factor where it applies. */
function passChance(curve: PassCurve, wet: boolean, drsFactor: number, advantageMs: number): number {
  const p = curve.cap / (1 + Math.exp(-(curve.level + curve.slopePerMs * advantageMs)));
  return Math.min(1, p * (wet ? curve.wetFactor : 1) * drsFactor);
}

/** The session's pass curve: its band's, else the first band's; none passes without a band. */
function curveOf(start: StartingPoint): PassCurve | undefined {
  const { bands, band } = start.interaction;
  return (band.known ? bands[band.value]?.curve : undefined) ?? bands[0]?.curve;
}

type Run = { f: Field; pts: LapPoints; order: Int16Array; m: number };

/** DRS is enabled from `DRS_FROM_LAP`, off on a neutralised lap and the lap after one. */
const drsOn = (f: Field, lap: number): boolean => lap >= FROM_LAP && f.neutralByLap[lap] === GREEN && f.neutralByLap[lap - 1] === GREEN;

/** Where global point `g` is, in laps (lap number plus lap fraction; the line ends its lap). */
const posOf = (pts: LapPoints, g: number): number => {
  const P = pts.fraction.length;
  const i = g % P;
  return (g - i) / P + (pts.fraction[i] ?? 0);
};

/** Car `c`'s time at point `g`; back-extrapolated at its lap time for a car that started the forecast past `g`. */
function tAt(r: Run, c: number, g: number): number {
  const last = (r.f.gNext[c] ?? 0) - 1;
  const t = r.f.tLast[c] ?? 0;
  if (last === g) return t;
  return t - (posOf(r.pts, last) - posOf(r.pts, g)) * (r.f.lapMs[c] ?? 0);
}

/** The field at the flag (or at `opts.toLap`) under `scenario`, each car following its policy (by car slot). */
export function raceForecast(start: StartingPoint, policies: readonly Policy[], scenario: Scenario, rng: Rng, opts?: { trace?: boolean; toLap?: number }): ForecastResult {
  const pts = lapPoints(start.track.brakingZones, start.track.drsZones);
  const P = pts.fraction.length;
  const toLap = opts?.toLap;
  const toFlag = toLap === undefined || toLap >= start.lapsTotal;
  const lastLap = toFlag ? start.lapsTotal : toLap;
  const f = createField(start, policies, scenario, draws(rng.int(0, 2_147_483_647), scenario.id), lastLap);
  const order = new Int16Array(start.cars);
  let m = 0;
  for (const c of start.order) if (f.running[c] === 1) order[m++] = c;
  const r: Run = { f, pts, order, m };
  place(r);

  const it = start.interaction;
  const curve = curveOf(start);
  const wet = start.wetness.wetnessMs > 0;
  const { gNext, tLast, retireAt, neutral, greenMs, lapMs, hazard, heldBy, drsRange, drsPass, inLap } = f;

  let gFrom = Infinity;
  for (let k = 0; k < r.m; k++) gFrom = Math.min(gFrom, gNext[order[k] ?? 0] ?? 0);
  const gEnd = lastLap * P + P - 1;
  for (let g = gFrom; g <= gEnd; g++) {
    const i = g % P;
    const lap = (g - i) / P;
    const kind = pts.kind[i] ?? LINE;
    const at = pts.fraction[i] ?? 1;
    const segment = at - (i === 0 ? 0 : (pts.fraction[i - 1] ?? 0));
    const drs = (kind === DETECTION || kind === DRS_END) && drsOn(f, lap);
    let ahead = -1;
    for (let k = 0; k < r.m; k++) {
      const c = order[k] ?? 0;
      if (gNext[c] !== g) {
        ahead = c;
        continue;
      }
      if (at >= (retireAt[c] ?? 2)) {
        // it retires before this point: it leaves the race order
        f.running[c] = 0;
        order.copyWithin(k, k + 1, r.m);
        r.m--;
        k--;
        continue;
      }
      // under SC a follower closes up at its green pace; the queue's front runs the SC's
      let t = (tLast[c] ?? 0) + segment * ((neutral[c] === SC && ahead >= 0 ? greenMs[c] : lapMs[c]) ?? 0);
      if (kind === DRS_END && drs && drsRange[c] === 1) t -= it.drsStraightGainMs;
      if (ahead >= 0) {
        const ta = tAt(r, ahead, g);
        const within = t - ta <= it.minGapMs + HELD_EPS_MS;
        if (!within || heldBy[c] !== ahead) hazard[c] = 0;
        heldBy[c] = within ? ahead : -1;
        t = Math.max(t, ta + it.minGapMs);
        if (kind === BRAKING) {
          const advantageMs = (greenMs[ahead] ?? 0) - (greenMs[c] ?? 0);
          if (within && curve !== undefined && advantageMs > 0 && neutral[c] === GREEN && neutral[ahead] === GREEN && inLap[c] === 0) {
            const p = passChance(curve, wet, drsPass[c] === 1 ? it.drsPassFactor : 1, advantageMs);
            let passes: boolean;
            if (f.plain) {
              // plain: the held car passes once its summed hazard reaches the median pass time's
              const h = (hazard[c] ?? 0) + (p >= 1 ? Infinity : -Math.log1p(-p));
              hazard[c] = h;
              passes = h >= MEDIAN_HAZARD;
            } else passes = uniformDraw(keyOf(f.draws, c, lap), PASS, i) < p;
            if (passes) {
              t = ta - MARGIN_MS;
              order[k - 1] = c;
              order[k] = ahead;
              hazard[c] = 0;
              heldBy[c] = -1;
            }
          }
          drsPass[c] = 0;
        } else if (kind === DETECTION) drsRange[c] = drs && t - ta <= RANGE_MS ? 1 : 0;
        else if (kind === DRS_END) drsPass[c] = drs && drsRange[c] === 1 && drsRange[ahead] === 0 ? 1 : 0;
      } else {
        heldBy[c] = -1;
        hazard[c] = 0;
        if (kind === DETECTION) drsRange[c] = 0;
        else if (kind === DRS_END || kind === BRAKING) drsPass[c] = 0;
      }
      tLast[c] = t;
      gNext[c] = g + 1;
      // a car entering the pits holds nobody at the line
      if (!(kind === LINE && inLap[c] === 1)) ahead = order[k] ?? c;
    }
    if (kind === LINE) crossLine(r, g, lap);
  }
  return result(f, toFlag, opts?.trace === true);
}

/** Every car on its lap at its lap fraction, the leader's lap `start.lap`, its last point's time back-extrapolated. */
function place(r: Run): void {
  const { f, pts, order } = r;
  const s = f.start;
  const P = pts.fraction.length;
  const leaderFraction = r.m > 0 ? (s.lapFraction[order[0] ?? 0] ?? 0) : 0;
  for (let k = 0; k < r.m; k++) {
    const c = order[k] ?? 0;
    const at = s.lapFraction[c] ?? 0;
    const lap = at > leaderFraction ? s.lap - 1 : s.lap;
    lapStart(f, c, lap, at, true);
    let i = 0;
    while ((pts.fraction[i] ?? 1) <= at) i++;
    const lapMs = f.lapMs[c] ?? 0;
    f.gNext[c] = lap * P + i;
    f.tLast[c] = -(at - (i === 0 ? 0 : (pts.fraction[i - 1] ?? 0))) * lapMs;
    if (lap >= 1) f.lineT[lineAt(f, c, lap - 1)] = -at * lapMs;
  }
}

/** Every car crossed the line ending `lap` at point `g`: its line time, its stop (loss, double stack), its next lap. */
function crossLine(r: Run, g: number, lap: number): void {
  const { f, order } = r;
  const s = f.start;
  let stopped = false;
  let boxFreeAt = -Infinity;
  for (let k = 0; k < r.m; k++) {
    const c = order[k] ?? 0;
    if (f.gNext[c] !== g + 1) continue;
    const entry = f.tLast[c] ?? 0;
    f.lineT[lineAt(f, c, lap)] = entry;
    const condition = PIT_LOSS[f.neutral[c] ?? GREEN] ?? 'green';
    if (lapEnd(f, c, lap) !== undefined) {
      stopped = true;
      let lossMs = s.track.pitLossMs[condition] - (s.human[c] === 1 ? HUMAN_STOP_SAVING_MS : 0);
      if (f.setsUsed.has(c)) {
        // our cars share one box: a car entering while it is busy waits for it
        const wait = Math.max(0, boxFreeAt - entry);
        lossMs += wait;
        boxFreeAt = entry + wait + DOUBLE_STACK_MS;
      }
      f.tLast[c] = entry + lossMs;
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
