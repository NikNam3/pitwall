// Membership of the flag sub-machines' spans (contract C26, Task 13): `situationAt` gives a marshal zone's flag span
// and a car's flag span covering a frame; `membershipOf` gives a fact of that car its car-flags span and never a
// zone-flags span (a zone is no session and no car), a session-wide fact neither. The projection reads each machine's
// scope from its span declaration in domain (`carFlagsSpans`, `zoneFlagsSpans`), not from the registry.
import { carId as car, type OpenSpan } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { createLog, logWriter } from '../../src/log/log.ts';
import { ProjectionTracker } from '../../src/log/projection.ts';
import { membershipOf, situationAt, type MembershipSource } from '../../src/readers.ts';
import { event, openSpan, situation, span } from '../support/log-facts.ts';

// Car 0 shows yellow over frames 3-8, then (open) noFlag from 8; zone 2 shows yellow over frames 2-9, then (open) green from 9.
const carYellow = span('car-flags', 1, 'yellow', 200, 700, { startFrame: 3, endFrame: 8, carId: car(0) });
const carRest = openSpan('car-flags', 2, 'noFlag', 700, { startFrame: 8, carId: car(0) });
const zoneYellow = { ...span('zone-flags', 4, 'yellow', 100, 800, { startFrame: 2, endFrame: 9 }), detail: { zone: 2, startFraction: 0.5 } };
const zoneGreen: OpenSpan = { ...openSpan('zone-flags', 5, 'green', 800, { startFrame: 9 }), detail: { zone: 2, startFraction: 0.5 } };

const source = (): MembershipSource => {
  const log = createLog();
  const writer = logWriter(log);
  writer.append('spans:car-flags', carYellow);
  writer.append('spans:zone-flags', zoneYellow);
  const open = situation(carRest, zoneGreen);
  const tracker = new ProjectionTracker(log);
  tracker.update(open);
  return { history: tracker.projection, situation: open };
};

describe('membership of the flag spans (C26)', () => {
  it('situationAt gives the car’s flag span and the zone’s flag span covering a frame, closed and open', () => {
    const at = source();
    expect(situationAt(at, 5)).toEqual({ 'car-flags': [carYellow], 'zone-flags': [zoneYellow] });
    expect(situationAt(at, 8)).toEqual({ 'car-flags': [carRest], 'zone-flags': [zoneYellow] });
    expect(situationAt(at, 9)).toEqual({ 'car-flags': [carRest], 'zone-flags': [zoneGreen] });
    expect(situationAt(at, 1)).toEqual({});
  });
  it('membershipOf gives a car’s fact its car-flags span and no zone-flags span, though a zone’s span covers the frame', () => {
    const at = source();
    expect(membershipOf(at, event(300, 5, car(0)))).toEqual({ 'car-flags': carYellow });
    expect(membershipOf(at, event(750, 8, car(0)))).toEqual({ 'car-flags': carRest });
    expect(membershipOf(at, event(750, 10, car(0)))).toEqual({ 'car-flags': carRest });
  });
  it('a fact of a car without a flag span, and a session-wide fact, belong to no flag span', () => {
    const at = source();
    expect(membershipOf(at, event(300, 5, car(1)))).toEqual({});
    expect(membershipOf(at, event(300, 5))).toEqual({});
    expect(membershipOf(at, event(850, 9))).toEqual({});
  });
});
