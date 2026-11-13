// `race-hazard` on real data (contract C84; plan 4.3b1 Task 16 row 8): segment race-spa-sc-deployed (fixtures/index.json;
// session time 2204.2 to 2211.0 of the Spa race, lap 20): the SCAR deployment at 2205.265 and nothing of the lap under
// it. The engine runs the segment frame by frame (`SessionTracker`, `SessionRunner`); on its last view, with Spa's
// committed track file (data/tracks/10.json, C62b) as `view.track`, the unit (through `hazardOf`: the scheduled run and
// the as-of form, each through its guarded view, C41) has the SC out with its laps left known: the span has run 0 laps,
// so the pmf is Spa's SC duration pmf itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedId, known, unknown, type TrackData, type TrackFile } from '@pitwall/domain';
import { SessionRunner, SessionTracker, situationOf, type StepResult } from '@pitwall/engine';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { IDLE_FEED } from '../../../../test-support/builders/index.ts';
import { segmentPackets } from '../../../../test-support/segments.ts';
import { conditioned, expectPmf, hazardOf } from './support.ts';

const FILE = 'race-spa-sc-deployed.pwrec.gz';

/** Spa's committed track file as `view.track` holds it: without `source`. */
const spa = (): TrackData => {
  const { source: _source, ...data } = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../data/tracks/10.json'), 'utf8')) as TrackFile;
  return data;
};

/** The segment's last view, with Spa's track. */
async function lastView(): Promise<EngineView> {
  const tracker = new SessionTracker({ feedId: feedId(FILE) });
  const events = (await segmentPackets(FILE)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined);
  if (first?.session === undefined) throw new Error(`${FILE}: no frame carried a session`);
  const runner = new SessionRunner({ feedId: feedId(FILE), sessionUid: first.sessionUid, session: first.session });
  let last: StepResult | undefined;
  const onResult = (r: StepResult): void => {
    last = r;
  };
  // the session's last frame, before the runner's end closes its spans
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  if (last === undefined) throw new Error(`${FILE}: no frame applied`);
  const { state, changed, delta } = last;
  return {
    live: state,
    situation: situationOf(state),
    history: state.history,
    changed,
    delta,
    weekend: state.weekend,
    feed: IDLE_FEED,
    config: {},
    priors: unknown('notApplicable'),
    drivers: state.cars.map(() => unknown('notApplicable')),
    track: known(spa(), 0),
    outputs: new Map(),
  };
}

describe('race-hazard on real data', () => {
  it('segment race-spa-sc-deployed: active is SC with remainingLaps known', async () => {
    const track = spa();
    if (!track.defaults.hazard.known) throw new Error('data/tracks/10.json: no hazard');
    const view = await lastView();
    // the race's SC is out at the segment's end (the segment's content, not the unit's)
    expect(view.situation.weekendPhase.kind).toBe('race');
    expect(view.situation.byMachine['session-phase-race']?.[0]?.kind).toBe('neutralised');
    const out = hazardOf(view);
    if (!out.known) throw new Error(`race-hazard: unknown (${out.reason})`);
    expect(out.value.active?.condition).toBe('sc');
    expectPmf(out.value.active?.remainingLaps, conditioned(track.defaults.hazard.value.value.durationLaps.sc, 0), 'Spa SC, run 0');
  });
});
