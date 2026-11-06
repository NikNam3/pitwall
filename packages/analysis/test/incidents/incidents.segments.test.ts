// `incidents` on real data (contract C84, C43, C45): a neutralisation names its likely cause. Segment
// race-sc-after-collision (fixtures/index.json): a collision, then, a few seconds later, the safety car. The engine
// runs the segment frame by frame (`SessionTracker`, `SessionRunner`), and the scheduler runs the calculator, through
// its guarded view (C41), on every step; the test reads its last output.
import { describe, expect, it } from 'vitest';
import { feedId, unknown, type IncidentEntry } from '@pitwall/domain';
import { CalculatorRegistry, Scheduler, SessionRunner, SessionTracker, situationOf, type StepResult } from '@pitwall/engine';
import { guarded } from '../../../engine/test/support/scheduler.ts';
import { IDLE_FEED } from '../../../../test-support/builders/index.ts';
import { SEGMENTS, segmentPackets } from '../../../../test-support/segments.ts';
import { incidentsCalculator } from '../../src/incidents/calculator.ts';
import { INCIDENTS, type IncidentsOutput } from '../../src/incidents/index.ts';

/** The feed (`IncidentsOutput.feed`) of the calculator's last run over segment `file`, from the first frame that carries a Session. */
async function lastFeed(file: string): Promise<IncidentEntry[]> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined);
  if (first?.session === undefined) throw new Error(`${file}: no frame carried a session`);
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session });
  const unit = guarded(incidentsCalculator);
  const scheduler = new Scheduler(CalculatorRegistry.build([unit]), { freezeOutputs: true });
  scheduler.setNeeded([INCIDENTS]);
  let out: IncidentsOutput | undefined;
  const onResult = (r: StepResult): void => {
    if (r.delta.rewound !== undefined) scheduler.reset();
    const { state, changed, delta } = r;
    const scheduled = scheduler.run({ live: state, situation: situationOf(state), history: state.history, changed, delta, weekend: state.weekend, feed: IDLE_FEED, config: {}, priors: {}, track: unknown('notApplicable') });
    expect(scheduled.errors).toEqual([]);
    if (scheduled.ran.includes(INCIDENTS)) out = scheduled.outputs.get(INCIDENTS) as IncidentsOutput;
  };
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  runner.end(onResult);
  if (out === undefined) throw new Error(`${file}: incidents never ran`);
  return out.feed;
}

describe('a neutralisation names its likely cause on real data', () => {
  it('raceScAfterCollision: the SC entry names the collision before it as its cause, and that collision is in the feed', async () => {
    const feed = await lastFeed(SEGMENTS.raceScAfterCollision);
    const neutralised = feed.filter((e) => e.kind === 'neutralised');
    expect(neutralised.map((e) => e.kind)).toEqual(['neutralised']);
    const cause = neutralised[0]!.cause;
    expect(cause?.kind).toBe('collision');
    const named: IncidentEntry | undefined = feed.find((e) => e.id === cause?.entryId);
    expect(named?.kind).toBe('collision');
  });
});
