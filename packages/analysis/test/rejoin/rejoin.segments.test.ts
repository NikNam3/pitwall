// `rejoin` on real data (contract C84, SP4.2 spec 6.1): the ghost needs gaps of about a pit loss and our own crossings of
// that long ago, so only full-lap segments carry it. The engine runs each segment frame by frame (`SessionTracker`,
// `SessionRunner`), and a scheduler that needs `rejoin` (through its guarded view, C41) runs on every frame, with
// `gaps` and `pit-loss` upstream; the track file is the session's committed one (C62b), so `pit-loss` has its
// defaults for every condition. Behaviour only, never the recording's values (C84):
//  - race-zandvoort-full-lap at its end: for our car every condition has a known rejoin position no better than its
//    position, the order holds `2 × orderAround + 1` rows with exactly one ghost, and the map point lies on the outline;
//  - race-mexico-vsc-full-lap while the VSC is out: the VSC row is known.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedId, known, unknown, type MapPoint, type TrackData, type TrackFile } from '@pitwall/domain';
import { CalculatorRegistry, Scheduler, SessionRunner, SessionTracker, situationOf, type Calculator, type DeepReadonly, type EngineState, type StepResult } from '@pitwall/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { guarded } from '../../../engine/test/support/scheduler.ts';
import { IDLE_FEED, NO_PRIORS } from '../../../../test-support/builders/index.ts';
import { segmentPackets } from '../../../../test-support/segments.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { REJOIN, REJOIN_CONFIG, type RejoinOutput } from '../../src/rejoin/index.ts';
import { CALCULATORS } from '../units.ts';

const ZANDVOORT_LAP = 'race-zandvoort-full-lap.pwrec.gz';
const MEXICO_VSC_LAP = 'race-mexico-vsc-full-lap.pwrec.gz';

/** The committed track file of `trackId` (`data/tracks/`, C62b) as `view.track` holds it: without its provenance. */
function trackOf(trackId: number): DeepReadonly<TrackData> {
  const { source: _source, ...data } = JSON.parse(readFileSync(join(import.meta.dirname, `../../../../data/tracks/${trackId}.json`), 'utf8')) as TrackFile;
  return data;
}

/** A run's output on one frame, with its state. */
type Seen = { out: RejoinOutput; state: DeepReadonly<EngineState> };

/**
 * Runs segment `file` frame by frame with a scheduler that needs `rejoin` (guarded) on every frame; `keep` picks the
 * frames whose output is kept (the newest kept one is returned).
 */
async function runSegment(file: string, keep: (state: DeepReadonly<EngineState>) => boolean): Promise<Seen> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined);
  if (first?.session === undefined) throw new Error(`${file}: no frame carried a session`);
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session });
  const units = CALCULATORS.map((c) => (c.id === REJOIN ? (guarded(rejoinCalculator as Calculator) as Calculator) : c));
  const scheduler = new Scheduler(CalculatorRegistry.build(units), { freezeOutputs: true });
  scheduler.setNeeded([REJOIN]);
  let track: DeepReadonly<TrackData> | undefined;
  let seen: Seen | undefined;
  const onResult = ({ state, changed, delta }: StepResult): void => {
    track ??= trackOf(state.session.trackId);
    const result = scheduler.run({
      live: state,
      situation: situationOf(state),
      history: state.history,
      changed,
      delta,
      weekend: state.weekend,
      feed: IDLE_FEED,
      config: {},
      priors: NO_PRIORS,
      track: known(track, 0),
    });
    expect(result.errors).toEqual([]);
    const out = result.outputs.get(REJOIN) as RejoinOutput | undefined;
    if (out !== undefined && keep(state)) seen = { out, state };
  };
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  runner.end(onResult);
  if (seen === undefined) throw new Error(`${file}: no frame kept a rejoin output`);
  return seen;
}

/** Whether the session's open race phase is a VSC (`neutralised` with a VSC car). */
const vscOut = (state: DeepReadonly<EngineState>): boolean =>
  (situationOf(state).byMachine['session-phase-race'] ?? []).some((s) => s.kind === 'neutralised' && (s.detail as { car?: string } | undefined)?.car === 'VSC');

let zandvoort: Seen;
let mexico: Seen;

describe('rejoin on real data', () => {
  beforeAll(async () => {
    zandvoort = await runSegment(ZANDVOORT_LAP, () => true);
    mexico = await runSegment(MEXICO_VSC_LAP, vscOut);
  }, 120_000);

  it('race-zandvoort-full-lap at its end: every condition known, no better than our position, the full order with one ghost, the map point on the outline', () => {
    const { out, state } = zandvoort;
    const player = state.playerCar;
    const r = out.cars[player];
    expect(r, `car ${player}`).toBeDefined();
    if (r === undefined) return;
    const outline = trackOf(state.session.trackId).outline;
    if (!outline.known) throw new Error('the committed track file has an outline');
    const rows = 2 * REJOIN_CONFIG.defaults.orderAround + 1;
    for (const c of ['green', 'vsc', 'sc'] as const) {
      const at = r.conditions[c];
      expect(at.lossMs.known, c).toBe(true);
      expect(at.rejoinPosition.known, c).toBe(true);
      if (at.rejoinPosition.known) expect(at.rejoinPosition.value, c).toBeGreaterThanOrEqual(r.position);
      expect(at.order.known, c).toBe(true);
      if (at.order.known) {
        expect(at.order.value, c).toHaveLength(rows);
        expect(at.order.value.filter((row) => row.ghost), c).toHaveLength(1);
      }
      expect(at.mapPoint.known, c).toBe(true);
      if (at.mapPoint.known) expect(onOutline(outline.value, at.mapPoint.value), c).toBe(true);
    }
  });

  it('race-mexico-vsc-full-lap with the VSC out: the VSC row is known', () => {
    const { out, state } = mexico;
    expect(vscOut(state)).toBe(true);
    const r = out.cars[state.playerCar];
    expect(r, `car ${state.playerCar}`).toBeDefined();
    if (r === undefined) return;
    const vsc = r.conditions.vsc;
    expect(vsc.lossMs.known).toBe(true);
    expect(vsc.rejoinPosition.known).toBe(true);
    expect(vsc.order.known).toBe(true);
    expect(vsc.mapPoint).not.toEqual(unknown('notApplicable'));
  });
});

/** Whether `p` lies on the outline: on one of its segments between neighbouring points, to a micrometre of the map. */
function onOutline(outline: readonly DeepReadonly<MapPoint>[], p: MapPoint): boolean {
  return outline.some((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    return Math.abs(cross) <= 1e-6 * Math.max(1, length) && along >= -1e-9 && along <= length * length + 1e-9;
  });
}
