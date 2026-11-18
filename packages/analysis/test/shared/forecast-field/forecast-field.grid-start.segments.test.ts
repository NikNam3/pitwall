// The grid start on real data (SP4.3d2 Task 7 row 7; contract C3, C50, C62d, C84): segment qualifying-texas-send
// (`fixtures/index.json`: the last ~10 s of a one-shot qualifying to its SEND) replayed to its end by the engine
// (`SessionTracker`, `SessionRunner`), as the planning job reads the ended session: its as-of view at the end with
// `fixed.totalLaps` the race's entered laps, the priors passed explicitly (the committed fixture
// `test-support/fixtures/priors-texas.json`, C84), the committed track file (`data/tracks/15.json`, C62b). The starting
// point's units run on it (`FORECAST_UNITS`), the grid is `gridOf`'s, our cars' start compounds free and every rival's
// drawn. Invariants only, no fact of the recording.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedId, known, trackDataOf, unknown, validateTrackFile, type CarId, type Known, type NoiseCompound, type PriorsSnapshot, type StartOption } from '@pitwall/domain';
import { SessionRunner, SessionTracker, situationOf, type StepResult } from '@pitwall/engine';
import { asOfNow, runAsOf, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { IDLE_FEED } from '../../../../../test-support/builders/index.ts';
import { SEGMENTS, segmentPackets } from '../../../../../test-support/segments.ts';
import { buildGridStart, FORECAST_UNITS } from '../../../src/shared/forecast-field/index.ts';
import { gridOf } from '../../../src/shared/grid.ts';
import { arraysOf } from './support.ts';

/** The race's laps as the planning round would enter them. */
const RACE_LAPS = 30;
const ROOT = join(import.meta.dirname, '../../../../..');

/** The priors fixture, passed explicitly (C84). */
const priors = (): PriorsSnapshot => JSON.parse(readFileSync(join(ROOT, 'test-support/fixtures/priors-texas.json'), 'utf8')) as PriorsSnapshot;

/** The committed Texas track file as `view.track` holds it (C62b). */
function texasTrack(): EngineView['track'] {
  const v = validateTrackFile(JSON.parse(readFileSync(join(ROOT, 'data/tracks/15.json'), 'utf8')));
  if (!v.ok) throw new Error(`data/tracks/15.json: ${v.errors.join('; ')}`);
  return known(trackDataOf(v.file), 0);
}

/** The engine's view after the segment's last frame, with the priors, the track file and no profiles. */
async function endedView(file: string): Promise<EngineView> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined);
  if (first?.session === undefined) throw new Error(`${file}: no frame carried a session`);
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session });
  let last: StepResult | undefined;
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, (r) => (last = r));
  if (last === undefined) throw new Error(`${file}: no frame applied`);
  const { state, changed, delta } = last;
  return {
    live: state,
    situation: situationOf(state),
    history: state.history,
    changed,
    delta,
    basis: state.basis,
    feed: IDLE_FEED,
    config: {},
    priors: known(priors(), 0),
    drivers: state.cars.map(() => unknown('notApplicable')),
    track: texasTrack(),
    outputs: new Map(),
  };
}

describe('the grid start on the qualifying-texas-send segment (SP4.3d2 Task 7)', () => {
  let view: AsOfView;
  beforeAll(async () => {
    const now = asOfNow(await endedView(SEGMENTS.qualifyingTexasSend));
    view = { ...now, fixed: { ...now.fixed, totalLaps: known(RACE_LAPS, 0) } };
  }, 60_000);

  it('7: real segment: the grid start is known, every competing car on the grid once, no NaN', () => {
    const competing = (view.situation.byMachine['car-status'] ?? []).filter((s) => s.kind === 'competing').map((s) => s.carId as CarId);
    expect(competing.length).toBeGreaterThan(0);
    const grid = gridOf(view);
    expect(grid.known, grid.known ? '' : grid.reason).toBe(true);
    if (!grid.known) return;
    // every competing car once, nothing else
    expect([...grid.value].sort((a, b) => a - b)).toEqual([...competing].sort((a, b) => a - b));

    const fixed = view.fixed;
    const ours = new Set<number>([fixed.playerCar.known ? fixed.playerCar.value : -1, fixed.teammateCar.known ? fixed.teammateCar.value : -1]);
    const outputs = runAsOf(FORECAST_UNITS, view);
    const sp = buildGridStart(view, outputs, { laps: RACE_LAPS, grid: [...grid.value], fittedCompound: (car: CarId): Known<NoiseCompound> | 'free' => (ours.has(car) ? 'free' : unknown('notApplicable')) });
    expect(sp.known, sp.known ? '' : sp.reason).toBe(true);
    if (!sp.known) return;
    const s = sp.value;
    expect(Array.from(s.order)).toEqual([...grid.value]);
    expect(s.lapsTotal).toBe(RACE_LAPS);
    for (const [name, values] of arraysOf(s)) for (let i = 0; i < values.length; i++) expect(Number.isNaN(values[i]), `${name}[${i}]`).toBe(false);
    // our cars free; every rival's options sum to 1, no NaN in them
    expect(s.start).not.toBeNull();
    for (const k of grid.value) {
      if (ours.has(k)) {
        expect(s.start!.freeCompound[k], `car ${k}: ours, free`).toBe(1);
        continue;
      }
      const options = s.start!.odds[k];
      expect(options, `car ${k}: odds`).not.toBeNull();
      expect(options!.reduce((sum: number, o: StartOption) => sum + o.p, 0), `car ${k}: odds sum`).toBeCloseTo(1, 9);
      for (const o of options as StartOption[]) for (const v of [o.p, o.stopLow, o.stopMid, o.stopHigh]) expect(Number.isNaN(v), `car ${k} ${o.compound}`).toBe(false);
    }
    // the weather: known or an unknown with its reason, never NaN
    if (s.weather.known) for (const l of s.weather.value.byLap) expect(Number.isNaN(l.rainPct), `lap ${l.lap}`).toBe(false);
  });
});
