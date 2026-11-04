// The open span of a situation topic (contract C20, C65). Contract of `openSpanOf(spans, carId?)` in src/kit/situation.ts
// (pure, selection only):
//  - the open span whose `carId` is `carId` (a car sub-machine); without `carId`, the open span without one (a session
//    sub-machine);
//  - `undefined` while the topic has no value, or when no such span is open (the topic carries open spans only).
import type { MachineSpans } from '@pitwall/contracts';
import { carId, type OpenSpan } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { openSpanOf } from '../../src/kit/situation.ts';

const open = (kind: string, car?: number): OpenSpan => ({
  machine: 'm', id: 0, kind, start: 0 as OpenSpan['start'], confirmed: true, detail: undefined, startFrame: 1,
  ...(car === undefined ? {} : { carId: carId(car) }),
});

describe('openSpanOf', () => {
  it("picks a car's open span", () => {
    const spans: MachineSpans = { open: [open('track', 0), open('pitLane', 3)] };
    expect(openSpanOf(spans, carId(3))).toBe(spans.open[1]);
    expect(openSpanOf(spans, carId(0))).toBe(spans.open[0]);
  });

  it("picks the session's open span without a car", () => {
    const spans: MachineSpans = { open: [open('racing')] };
    expect(openSpanOf(spans)).toBe(spans.open[0]);
  });

  it('is undefined without a value, and without an open span of the car', () => {
    expect(openSpanOf(undefined, carId(1))).toBeUndefined();
    expect(openSpanOf(undefined)).toBeUndefined();
    expect(openSpanOf({ open: [open('track', 0)] }, carId(1))).toBeUndefined();
    expect(openSpanOf({ open: [open('track', 0)] })).toBeUndefined();
  });
});
