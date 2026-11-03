// Membership (contract C20, C26, C28): computed only by the projection module, from frame numbers. `situationAt` gives
// every visible span covering a frame, the closed ones of the projection and the open ones of the situation (a span
// covers the frames from the one it opened on up to, not including, the one it closed on); `membershipOf` gives a
// fact's session-scoped spans and, for a car's fact, its car's spans, never a zone's. Both are readers' API
// (`@pitwall/engine/readers`). The registry here is the test machines (`test/support/test-machines.ts`): `test-session`
// is session-scoped, `test-car` car-scoped, `test-zone` zone-scoped; the clock counts as session-scoped.
import { carId as car, type MachineId, type OpenSpan } from '@pitwall/domain';
import { describe, expect, it, vi } from 'vitest';
import { createLog, logWriter } from '../../src/log/log.ts';
import { ProjectionTracker } from '../../src/log/projection.ts';
import { membershipOf, situationAt, type MembershipSource } from '../../src/readers.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { event, openSpan, situation, span } from '../support/log-facts.ts';

vi.mock('../../src/situations/index.generated.ts', async () => {
  const { TEST_MACHINES } = await import('../support/test-machines.ts');
  return { MACHINES: TEST_MACHINES };
});

// The session green over frames 1-9, neutralised from 10 (open). Car 0 on track over frames 1-4, in the pit lane from 5
// (open); car 1 on track from 1 (open). Zone 0 yellow over frames 3-7, clear from 8 (open). The clock paused over frame 6.
const green = span('test-session', 0, 'green', 0, 900, { startFrame: 1, endFrame: 10 });
const neutralised = openSpan('test-session', 1, 'neutralised', 900, { startFrame: 10 });
const carZeroTrack = span('test-car', 0, 'track', 0, 400, { startFrame: 1, endFrame: 5, carId: car(0) });
const carZeroPit = openSpan('test-car', 1, 'pit', 400, { startFrame: 5, carId: car(0) });
const carOneTrack = openSpan('test-car', 0, 'track', 0, { startFrame: 1, carId: car(1) });
const yellow = { ...span('test-zone', 0, 'yellow', 200, 700, { startFrame: 3, endFrame: 8 }), detail: { zone: 0 } };
const clear = { ...openSpan('test-zone', 1, 'clear', 700, { startFrame: 8 }), detail: { zone: 0 } };
const paused = span('clock', 0, 'paused', 500, 500, { startFrame: 6, endFrame: 7 });

/** The view's two sources of spans: the projection of a log holding the closed spans, and the situation of the open ones. */
const source = (): MembershipSource => {
  const log = createLog();
  const writer = logWriter(log);
  writer.append('spans:test-session', green);
  writer.append('spans:test-car', carZeroTrack);
  writer.append('spans:test-zone', yellow);
  writer.append('spans:clock', paused);
  const open = situation(neutralised, carZeroPit, carOneTrack, clear);
  const tracker = new ProjectionTracker(log);
  tracker.update(open);
  return { history: tracker.projection, situation: open };
};

/** The spans of each machine ordered by car, so the order of closed and open spans within one machine does not matter. */
const byCar = (spans: Readonly<Record<MachineId, readonly DeepReadonly<OpenSpan>[]>>) =>
  Object.fromEntries(Object.entries(spans).map(([machine, list]) => [machine, [...list].sort((a, b) => (a.carId ?? -1) - (b.carId ?? -1))]));

describe('situationAt (C26)', () => {
  it('situationAt gives the spans covering a frame, open and closed, half-open at the end', () => {
    const at = source();
    expect(byCar(situationAt(at, 4))).toEqual({ 'test-session': [green], 'test-car': [carZeroTrack, carOneTrack], 'test-zone': [yellow] });
    // frame 5: car 0's track span closed on it, its pit span opened on it
    expect(byCar(situationAt(at, 5))).toEqual({ 'test-session': [green], 'test-car': [carZeroPit, carOneTrack], 'test-zone': [yellow] });
    expect(byCar(situationAt(at, 6))).toEqual({ clock: [paused], 'test-session': [green], 'test-car': [carZeroPit, carOneTrack], 'test-zone': [yellow] });
    // frame 10: green closed on it, so neutralised alone covers it
    expect(byCar(situationAt(at, 10))).toEqual({ 'test-session': [neutralised], 'test-car': [carZeroPit, carOneTrack], 'test-zone': [clear] });
    // no span covers a frame before the first: no machine is in the result
    expect(situationAt(at, 0)).toEqual({});
  });

  it('a stored projection has closed spans only: its situation at a frame comes from them alone', () => {
    const { history } = source();
    expect(byCar(situationAt({ history }, 4))).toEqual({ 'test-session': [green], 'test-car': [carZeroTrack], 'test-zone': [yellow] });
    expect(situationAt({ history }, 12)).toEqual({});
  });
});

describe('membershipOf (C26)', () => {
  it('membershipOf gives session spans and the fact’s car’s spans, never zone spans', () => {
    const at = source();
    expect(membershipOf(at, event(300, 4))).toEqual({ 'test-session': green });
    expect(membershipOf(at, event(300, 4, car(0)))).toEqual({ 'test-session': green, 'test-car': carZeroTrack });
    expect(membershipOf(at, event(500, 6, car(1)))).toEqual({ clock: paused, 'test-session': green, 'test-car': carOneTrack });
    expect(membershipOf(at, { frame: 12, carId: car(0) })).toEqual({ 'test-session': neutralised, 'test-car': carZeroPit });
    // car 2 has no span: its fact belongs to the session's spans only
    expect(membershipOf(at, { frame: 12, carId: car(2) })).toEqual({ 'test-session': neutralised });
    expect(membershipOf(at, { frame: 0 })).toEqual({});
  });
});
