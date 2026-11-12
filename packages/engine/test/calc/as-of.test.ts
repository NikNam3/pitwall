// The "as of frame N" forms (SP4.3a spec 6.1, plan Task 3, review P1 and P2; C39): `asOfNow` gives the current view
// without a cut, `runAsOf` runs several units' forms in dependency order with each one's output in the next one's
// `outputs`, and `asOfStored` gives a stored session's whole projection (frame `'now'`), so a profile aggregate can run
// the forms over a stored session (C62c).
import { describe, expect, it } from 'vitest';
import { carId, known, unknown, type SessionUid, type TrackData } from '@pitwall/domain';
import { history } from '../../../../test-support/builders/index.ts';
import { asOfNow, asOfStored, runAsOf, type AsOfUnit, type AsOfView, type StoredDriverSession } from '../../src/index.ts';
import { gridStart, run, script } from '../situations/script.ts';
import { viewOf } from '../support/scheduler.ts';

/** An as-of view of an empty race, with `outputs` before the units. */
const viewWith = (outputs: AsOfView['outputs'] = new Map()): AsOfView => ({
  fixed: { totalLaps: unknown('notReceived'), playerCar: unknown('notReceived'), aiDifficulty: unknown('notReceived'), setsNow: null, weatherNow: null },
  history: history(),
  situation: { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: {} },
  frame: 'now',
  at: 0,
  config: {},
  priors: unknown('notApplicable'),
  drivers: [],
  track: unknown('notApplicable'),
  weekend: undefined,
  outputs,
});

describe('asOfNow', () => {
  it('asOfNow is the current view without a cut: its projection, situation, fixed inputs and outputs, frame now', () => {
    const view = { ...viewOf(run(script(gridStart(10))).results.at(-1)!), outputs: new Map([['a', 1]]) };
    const now = asOfNow(view);
    expect(now.frame).toBe('now');
    expect(now.history).toBe(view.history);
    expect(now.situation).toBe(view.situation);
    expect(now.at).toBe(view.live.sessionTime);
    expect([now.config, now.priors, now.drivers, now.track, now.weekend]).toEqual([view.config, view.priors, view.drivers, view.track, view.weekend]);
    expect(now.outputs.get('a')).toBe(1);
  });
});

describe('runAsOf (P2)', () => {
  it('runAsOf feeds each unit the outputs of the units before it', () => {
    const seen: Record<string, unknown> = {};
    const first: AsOfUnit = { id: 'first', reads: ['laps'], asOf: () => 41 };
    const second: AsOfUnit = {
      id: 'second',
      reads: ['laps', { calculator: 'first' }],
      asOf: (v) => {
        seen['second'] = v.outputs.get('first');
        return (v.outputs.get('first') as number) + 1;
      },
    };
    // given in the wrong order: the order comes from `reads`
    const outputs = runAsOf([second, first], viewWith());
    expect(seen['second']).toBe(41);
    expect(outputs.get('first')).toBe(41);
    expect(outputs.get('second')).toBe(42);
  });

  it('runAsOf: a chain of three in any given order, each sees its upstream; the view\'s own outputs are visible too', () => {
    const units: AsOfUnit[] = [
      { id: 'c', reads: [{ calculator: 'b' }], asOf: (v) => `${v.outputs.get('b') as string}c` },
      { id: 'a', reads: [{ calculator: 'given' }], asOf: (v) => `${v.outputs.get('given') as string}a` },
      { id: 'b', reads: [{ calculator: 'a' }], asOf: (v) => `${v.outputs.get('a') as string}b` },
    ];
    const outputs = runAsOf(units, viewWith(new Map([['given', '>']])));
    expect([outputs.get('a'), outputs.get('b'), outputs.get('c')]).toEqual(['>a', '>ab', '>abc']);
  });

  it('runAsOf hands every unit the same cut: projection, situation and frame', () => {
    const view = { ...viewWith(), frame: 17 };
    const views: AsOfView[] = [];
    runAsOf(
      [
        { id: 'a', reads: [], asOf: (v) => views.push(v) },
        { id: 'b', reads: [{ calculator: 'a' }], asOf: (v) => views.push(v) },
      ],
      view,
    );
    expect(views).toHaveLength(2);
    for (const v of views) expect([v.history, v.situation, v.frame, v.at]).toEqual([view.history, view.situation, 17, view.at]);
  });
});

describe('asOfStored', () => {
  it("asOfStored gives the whole stored projection with frame 'now'", () => {
    const projection = history({ laps: [], spans: { 'car-driver': [] } });
    const track = known({} as TrackData, 0);
    const session: StoredDriverSession = {
      session: { sessionUid: '7' as SessionUid, weekendId: 'w', feedCar: carId(0) },
      carId: carId(3),
      startedAt: '2026-11-05T19:00:00Z',
      phase: { kind: 'race', format: 'grandPrix' },
      aiDifficulty: known(95, 0),
      totalLaps: known(50, 0),
      projection,
      humanSpans: [{ startFrame: 1 }],
      track,
    };
    const config = { 'driver-noise': { shrinkLaps: 8 } };
    const v = asOfStored(session, { config, overrides: {} });
    expect(v.frame).toBe('now');
    expect(v.history).toBe(projection);
    // every span of a stored session is closed (C34): nothing open, the session's weekend phase
    expect(v.situation).toEqual({ weekendPhase: session.phase, byMachine: {} });
    expect(v.config).toBe(config);
    expect(v.track).toBe(track);
    expect(v.weekend).toBeUndefined();
    expect([...v.outputs.keys()]).toEqual([]);
  });
});
