// The open span of a situation topic (contract C20, C65). Contract of `openSpanOf(spans, carId?)` in src/kit/situation.ts
// (pure, selection only):
//  - the open span whose `carId` is `carId` (a car sub-machine); without `carId`, the open span without one (a session
//    sub-machine);
//  - `undefined` while the topic has no value, or when no such span is open; closed spans are never picked.
import type { MachineSpans } from '@pitwall/contracts';
import { carId, type OpenSpan, type Span } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { openSpanOf } from '../../src/kit/situation.ts';

const open = (kind: string, car?: number): OpenSpan => ({
  machine: 'm', id: 0, kind, start: 0 as OpenSpan['start'], confirmed: true, detail: undefined, startFrame: 1,
  ...(car === undefined ? {} : { carId: carId(car) }),
});
const closed = (kind: string, car?: number): Span => ({ ...open(kind, car), end: 10 as Span['end'], endFrame: 5 });

describe('openSpanOf', () => {
  it("picks a car's open span", () => {
    const spans: MachineSpans = { open: [open('track', 0), open('pitLane', 3)], closed: [closed('garage', 3)] };
    expect(openSpanOf(spans, carId(3))).toBe(spans.open[1]);
    expect(openSpanOf(spans, carId(0))).toBe(spans.open[0]);
  });

  it("picks the session's open span without a car", () => {
    const spans: MachineSpans = { open: [open('racing')], closed: [closed('formation')] };
    expect(openSpanOf(spans)).toBe(spans.open[0]);
  });

  it('is undefined without a value, without an open span of the car, and never picks a closed span', () => {
    expect(openSpanOf(undefined, carId(1))).toBeUndefined();
    expect(openSpanOf(undefined)).toBeUndefined();
    expect(openSpanOf({ open: [open('track', 0)], closed: [closed('garage', 1)] }, carId(1))).toBeUndefined();
    expect(openSpanOf({ open: [open('track', 0)], closed: [closed('racing')] })).toBeUndefined();
  });
});
