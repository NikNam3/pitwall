// `battle` on real data (contract C84, live polish spec 3.1): PACE Δ from the mini-sector crossings. Segment
// race-zandvoort-full-lap (fixtures/index.json): a 20-car race lap, every car's crossings one per segment, no pit stop
// and no neutralisation in it. The engine runs the segment frame by frame (`SessionTracker`, `SessionRunner`); after its
// last frame a scheduler that needs `battle` runs it and `gaps`, each through its guarded view (C41), on the final view:
// a newly needed unit runs at once against the current view (C49), from scratch (incremental = from scratch, C31.3,
// is battle.test.ts'). Running them on every frame of the 79 s lap would take the test past its time budget.
import { describe, expect, it } from 'vitest';
import { currentCrossings, feedId, MINI_SECTORS, unknown, type CarId, type MiniSectorCrossing } from '@pitwall/domain';
import { CalculatorRegistry, Scheduler, SessionRunner, SessionTracker, situationOf, type DeepReadonly, type EngineState, type StepResult } from '@pitwall/engine';
import { guarded } from '../../../engine/test/support/scheduler.ts';
import { IDLE_FEED } from '../../../../test-support/builders/index.ts';
import { segmentPackets } from '../../../../test-support/segments.ts';
import { battleCalculator } from '../../src/battle/calculator.ts';
import { BATTLE, type BattleOutput } from '../../src/battle/index.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { neutralisedSpans } from '../../src/shared/neutralised.ts';

const FULL_LAP = 'race-zandvoort-full-lap.pwrec.gz';

type LastRun = { cards: BattleOutput; state: DeepReadonly<EngineState> };

/** Battle's output on the last view of segment `file`, and the final engine state. */
async function lastRun(file: string): Promise<LastRun> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined);
  if (first?.session === undefined) throw new Error(`${file}: no frame carried a session`);
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session });
  let last: StepResult | undefined;
  const onResult = (r: StepResult): void => {
    last = r;
  };
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  runner.end(onResult);
  if (last === undefined) throw new Error(`${file}: no frame applied`);
  const scheduler = new Scheduler(CalculatorRegistry.build([guarded(gapsCalculator), guarded(battleCalculator)]), { freezeOutputs: true });
  scheduler.setNeeded([BATTLE]);
  const { state, changed, delta } = last;
  const scheduled = scheduler.run({ live: state, situation: situationOf(state), history: state.history, changed, delta, weekend: state.weekend, feed: IDLE_FEED, config: {}, priors: {}, track: unknown('notApplicable') });
  expect(scheduled.errors).toEqual([]);
  expect(scheduled.ran).toContain(BATTLE);
  return { cards: scheduled.outputs.get(BATTLE) as BattleOutput, state };
}

/** A car's current crossings by their count of segments from (1, 0): when it crossed each boundary. */
const passesOf = (crossings: readonly MiniSectorCrossing[], car: CarId): Map<number, number> =>
  new Map(currentCrossings(crossings).filter((c) => c.carId === car).map((c) => [(c.lap - 1) * MINI_SECTORS + c.segment, c.at]));

/**
 * The gap change of the pair over the same segments, per lap: from the newest boundary both cars crossed (of the two
 * cars' newest boundaries, the one the other car crossed later), back over every segment both cars passed, at most 50;
 * each car's passes of the same boundary indices (`index mod 50`), its own newest. The gap at a boundary is our crossing
 * minus theirs; PACE Δ (their time minus ours over the segments) is minus its change, normalised to one lap.
 */
function gapChangePace(ours: Map<number, number>, theirs: Map<number, number>): { paceMs: number; segments: number } {
  const newestOf = (passes: Map<number, number>, boundary: number): number => {
    let newest = -1;
    for (const index of passes.keys()) if (index % MINI_SECTORS === boundary && index > newest) newest = index;
    return newest;
  };
  const candidates = [Math.max(...ours.keys()), Math.max(...theirs.keys())].map((index) => index % MINI_SECTORS);
  const ends = candidates.map((b) => ({ o: newestOf(ours, b), t: newestOf(theirs, b) }));
  const olderOf = (e: { o: number; t: number }) => Math.min(ours.get(e.o)!, theirs.get(e.t)!);
  const end = ends.reduce((best, e) => (olderOf(e) > olderOf(best) ? e : best));
  let n = 0;
  while (n < MINI_SECTORS && ours.has(end.o - n - 1) && theirs.has(end.t - n - 1)) n++;
  const gapAt = (back: number) => ours.get(end.o - back)! - theirs.get(end.t - back)!;
  return { paceMs: (-(gapAt(0) - gapAt(n)) * MINI_SECTORS) / n, segments: n };
}

describe('battle on real data', () => {
  it('race-zandvoort-full-lap: after one lap PACE Δ is known for our cars and their neighbours and equals minus their gap change over the same segments, within 1 ms', async () => {
    const { cards, state } = await lastRun(FULL_LAP);
    const crossings = state.history.crossings as MiniSectorCrossing[];
    // the window holds only usable segments: no neutralisation, and the pair's cars on track throughout
    expect(neutralisedSpans(state.history, situationOf(state))).toEqual([]);
    const offTrack = new Set(
      [...(state.history.spans['car-location'] ?? []), ...(situationOf(state).byMachine['car-location'] ?? [])].filter((s) => s.kind !== 'track').map((s) => s.carId),
    );
    const checked: string[] = [];
    for (const card of Object.values(cards)) {
      for (const [name, side] of [['ahead', card.ahead], ['behind', card.behind]] as const) {
        if (!side.known || offTrack.has(card.carId) || offTrack.has(side.value.carId)) continue;
        const expected = gapChangePace(passesOf(crossings, card.carId), passesOf(crossings, side.value.carId));
        const label = `car ${card.carId} ${name} (car ${side.value.carId}), ${expected.segments} segments`;
        expect(expected.segments, label).toBeGreaterThanOrEqual(25);
        expect(side.value.paceDeltaMs, label).toMatchObject({ known: true });
        if (!side.value.paceDeltaMs.known) continue;
        expect(Math.abs(side.value.paceDeltaMs.value - expected.paceMs), label).toBeLessThanOrEqual(1);
        checked.push(label);
      }
    }
    expect(checked.length).toBeGreaterThan(0);
  });
});
