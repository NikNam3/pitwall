// The `lap-overview` analysis (spec 3.2): every completed lap of every car, in its current version (C25), with its stint,
// visual compound, kind, best, heat within its stint and track status. The status is the lap record's neutralised time
// (`lap-classes`' `maxNeutralisedMs`) unless the lap's membership (C26: the spans covering the frame it describes, its
// crossing) holds a session-phase span whose row is `red` (C44). Stints by `stintLaps` (`shared/stint-laps.ts`).
import { known, unknown, type CarId, type Known, type LapRecord, type Ratio, type StintRecord } from '@pitwall/domain';
import { membershipOf, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { classifyLap, LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { carLaps, stintLaps } from '../shared/stint-laps.ts';
import { LAP_OVERVIEW_BEHAVIOUR, SESSION_PHASE_MACHINES, type LapOverviewEffect } from './behaviour.ts';
import { LAP_OVERVIEW, type LapOverviewLap, type LapOverviewOutput, type LapStatus } from './index.ts';

/** The weekend-phase rows alone: the session-phase rows apply per lap, by its membership, not by the open spans. */
const WEEKEND_PHASE_TABLE = { 'weekend-phase': LAP_OVERVIEW_BEHAVIOUR['weekend-phase'] ?? {} };

/**
 * The stint index of each of a car's laps (counted from 1): a lap inside a closed stint record (`history.stints`) has that
 * record's index; the laps of the current stint (`stintLaps`) the index after the last record, unless the last record
 * reaches the newest lap and so is the current stint itself.
 */
function stintIndexOf(laps: readonly LapRecord[], records: readonly StintRecord[]): (lap: LapRecord) => number {
  const last = records.at(-1);
  const current = new Set(stintLaps(laps, last));
  return (lap) => {
    // the current stint's laps past the last record: the next stint
    if (current.has(lap) && (last === undefined || lap.lapNumber > last.lastLap)) return records.length + 1;
    const record = records.findIndex((s) => lap.lapNumber >= s.firstLap && lap.lapNumber <= s.lastLap);
    // a lap between records (none expected) belongs to the stint after the last record before it
    return record >= 0 ? record + 1 : records.filter((s) => s.lastLap < lap.lapNumber).length + 1;
  };
}

/**
 * Per `forPace` lap of one stint, its heat: 0 = the stint's fastest `forPace` lap, 1 = its slowest, as of the stint's
 * newest `forPace` lap (`at`, its completion); a stint with fewer than two has none.
 */
function heatsOf(stint: readonly LapRecord[], isPace: (lap: LapRecord) => boolean): Map<LapRecord, Known<Ratio>> {
  const pace = stint.filter(isPace);
  const heats = new Map<LapRecord, Known<Ratio>>();
  if (pace.length < 2) return heats;
  const times = pace.map((l) => l.lapTimeMs);
  const fastest = Math.min(...times);
  const spread = Math.max(...times) - fastest;
  const at = Math.max(...pace.map((l) => l.completedAt));
  // a stint of equal laps: every lap is its fastest
  for (const l of pace) heats.set(l, known(spread === 0 ? 0 : (l.lapTimeMs - fastest) / spread, at));
  return heats;
}

/** The faster of two `forBest` laps; the earlier one on a tie. */
const faster = (a: LapRecord | undefined, b: LapRecord): LapRecord => (a === undefined || b.lapTimeMs < a.lapTimeMs ? b : a);

export const lapOverviewCalculator: QuickCalculator<LapOverviewOutput> = {
  id: LAP_OVERVIEW,
  kind: 'quick',
  reads: ['laps', 'stints', 'spans:weekend-phase', 'spans:session-phase-race', 'spans:session-phase-qualifying', 'spans:session-phase-practice'],
  cadence: 'frame',
  compute: (view: EngineView) => {
    const session: LapOverviewEffect = Object.assign({}, ...behaviourFor(WEEKEND_PHASE_TABLE, view));
    const { maxNeutralisedMs } = LAP_CLASSES_CONFIG.read(view);
    // a pending weekend phase has no span yet and reads as the race (C14)
    const classes: LapClassOptions = { isRace: session.isRace ?? true, maxNeutralisedMs };

    const cars = [...new Set(view.history.laps.map((l) => l.carId))];
    const lapsByCar = new Map<CarId, LapRecord[]>(cars.map((id) => [id, carLaps(view.history, id)]));

    // bests as of now: each car's fastest `forBest.lap` lap, and the session's among them
    const personal = new Map<CarId, LapRecord>();
    let sessionBest: LapRecord | undefined;
    for (const [id, laps] of lapsByCar) {
      let best: LapRecord | undefined;
      for (const l of laps) if (classifyLap(l, classes).forBest.lap) best = faster(best, l);
      if (best === undefined) continue;
      personal.set(id, best);
      sessionBest = faster(sessionBest, best);
    }

    const statusOf = (lap: LapRecord): LapStatus => {
      const member = membershipOf({ history: view.history, situation: view.situation }, lap);
      for (const machine of SESSION_PHASE_MACHINES) {
        const span = member[machine];
        if (span !== undefined && LAP_OVERVIEW_BEHAVIOUR[machine]?.[span.kind]?.red === true) return 'red';
      }
      if ((lap.scShare + lap.vscShare) * lap.lapTimeMs < maxNeutralisedMs) return 'green';
      return lap.scShare > 0 ? 'sc' : 'vsc';
    };

    const out: LapOverviewOutput = {};
    for (const [id, laps] of lapsByCar) {
      // the view is deep-readonly; the records are only read
      const records = (view.history.stints as readonly StintRecord[]).filter((s) => s.carId === id);
      const stintOf = stintIndexOf(laps, records);
      const byStint = new Map<number, LapRecord[]>();
      for (const l of laps) {
        const i = stintOf(l);
        const list = byStint.get(i);
        if (list === undefined) byStint.set(i, [l]);
        else list.push(l);
      }
      const heats = new Map<LapRecord, Known<Ratio>>();
      for (const stint of byStint.values()) for (const [l, h] of heatsOf(stint, (x) => classifyLap(x, classes).forPace)) heats.set(l, h);

      out[id] = {
        laps: laps.map(
          (l): LapOverviewLap => ({
            lapNumber: l.lapNumber,
            lapTimeMs: l.lapTimeMs,
            stint: stintOf(l),
            compound: l.visualCompound,
            kind: l.inLap ? 'in' : l.outLap ? 'out' : 'normal',
            best: l === sessionBest ? 'session' : l === personal.get(id) ? 'personal' : 'none',
            heat: heats.get(l) ?? unknown('notApplicable'),
            status: statusOf(l),
          }),
        ),
      };
    }
    return out;
  },
};
