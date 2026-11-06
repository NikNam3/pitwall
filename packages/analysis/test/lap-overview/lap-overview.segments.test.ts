// `lap-overview` on real data (contract C84, SP4.1b spec 3.2, 6.1): the lap status from the lap record's neutralised time.
// Segment race-mexico-vsc-full-lap (fixtures/index.json): the player's lap from line to line under a VSC that ends about
// half way round, then green until its crossing. Every lap that completes in the segment overlaps the VSC: the other cars'
// laps began before the segment, while the VSC was out, and the engine, which joins the session at the segment's first
// frame, records them with all of their seen time under VSC. So the segment holds no green lap; its green part is the VSC's
// end, the session phase back to `racing`, inside the player's lap. The engine runs the segment frame by frame
// (`SessionTracker`, `SessionRunner`); after its last frame a scheduler that needs `lap-overview` runs it through its
// guarded view (C41) on the final view: a newly needed unit runs at once against the current view (C49).
import { describe, expect, it } from 'vitest';
import { currentLaps, feedId, unknown, type LapRecord } from '@pitwall/domain';
import { CalculatorRegistry, Scheduler, SessionRunner, SessionTracker, situationOf, type DeepReadonly, type EngineState, type StepResult } from '@pitwall/engine';
import { guarded } from '../../../engine/test/support/scheduler.ts';
import { IDLE_FEED, NO_PRIORS } from '../../../../test-support/builders/index.ts';
import { segmentPackets } from '../../../../test-support/segments.ts';
import { LAP_CLASSES_CONFIG } from '../../src/lap-classes/index.ts';
import { lapOverviewCalculator } from '../../src/lap-overview/calculator.ts';
import { LAP_OVERVIEW, type LapOverviewOutput } from '../../src/lap-overview/index.ts';

const VSC_LAP = 'race-mexico-vsc-full-lap.pwrec.gz';

type LastRun = { overview: LapOverviewOutput; state: DeepReadonly<EngineState> };

/** Lap-overview's output on the last view of segment `file`, and the final engine state. */
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
  const scheduler = new Scheduler(CalculatorRegistry.build([guarded(lapOverviewCalculator)]), { freezeOutputs: true });
  scheduler.setNeeded([LAP_OVERVIEW]);
  const { state, changed, delta } = last;
  const scheduled = scheduler.run({ live: state, situation: situationOf(state), history: state.history, changed, delta, weekend: state.weekend, feed: IDLE_FEED, config: {}, priors: NO_PRIORS, track: unknown('notApplicable') });
  expect(scheduled.errors).toEqual([]);
  expect(scheduled.ran).toContain(LAP_OVERVIEW);
  return { overview: scheduled.outputs.get(LAP_OVERVIEW) as LapOverviewOutput, state };
}

const { maxNeutralisedMs } = LAP_CLASSES_CONFIG.defaults;
const neutralisedMs = (l: DeepReadonly<LapRecord>): number => (l.scShare + l.vscShare) * l.lapTimeMs;

/** The run of the segment, once for both rows. */
let run: Promise<LastRun> | undefined;
const segmentRun = (): Promise<LastRun> => (run ??= lastRun(VSC_LAP));

describe('lap-overview on real data', () => {
  it("race-mexico-vsc-full-lap: the player's lap run from line to line under a VSC that ends during it is `vsc`", async () => {
    const { overview, state } = await segmentRun();
    const player = state.playerCar;
    // the player's newest lap: the one the segment holds whole, partly green after the VSC's end
    const record = currentLaps(state.history.laps as LapRecord[])
      .filter((l) => l.carId === player)
      .at(-1);
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(record.scShare).toBe(0);
    expect(record.vscShare).toBeGreaterThan(0);
    expect(record.vscShare).toBeLessThan(1);
    expect(neutralisedMs(record)).toBeGreaterThanOrEqual(maxNeutralisedMs);
    const lap = overview[player]?.laps.find((l) => l.lapNumber === record.lapNumber);
    expect(lap, `car ${player} lap ${record.lapNumber}`).toMatchObject({ lapTimeMs: record.lapTimeMs, status: 'vsc' });
  });

  it('race-mexico-vsc-full-lap: after the VSC ends the session is green again, and every lap that overlaps the VSC is `vsc`, none `green`, `sc` or `red`', async () => {
    const { overview, state } = await segmentRun();
    // the VSC's end: a closed `neutralised` span, the session phase `racing` after it
    const closed = state.history.spans['session-phase-race'] ?? [];
    expect(closed.map((s) => s.kind)).toContain('neutralised');
    expect((situationOf(state).byMachine['session-phase-race'] ?? []).map((s) => s.kind)).toEqual(['racing']);
    // every lap the segment completes overlaps the VSC: its neutralised time reaches the threshold, all of it VSC
    const records = currentLaps(state.history.laps as LapRecord[]);
    expect(records.length).toBeGreaterThan(1);
    for (const r of records) {
      const label = `car ${r.carId} lap ${r.lapNumber}`;
      expect(r.scShare, label).toBe(0);
      expect(neutralisedMs(r), label).toBeGreaterThanOrEqual(maxNeutralisedMs);
      expect(overview[r.carId]?.laps.find((l) => l.lapNumber === r.lapNumber)?.status, label).toBe('vsc');
    }
    // one status per current lap, no lap beyond them
    expect(Object.values(overview).flatMap((o) => o.laps)).toHaveLength(records.length);
  });
});
