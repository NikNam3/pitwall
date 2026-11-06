import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { BandReading } from '@pitwall/domain';
import { bandRole } from './emphasis.ts';

const reading = (over: Partial<BandReading> = {}): BandReading => ({
  value: known(90, 0), state: known('in', 0), band: known({ lo: 80, hi: 100 }, 0), outForFullLap: false, lapState: unknown('insufficientData'), ...over,
});
/** A channel without a live state (the tyre surface, the brakes). */
const NO_LIVE = unknown('notApplicable');

describe('bandRole', () => {
  it('is undefined for a value in band', () => {
    expect(bandRole(reading())).toBeUndefined();
  });

  it('is warning above the band', () => {
    expect(bandRole(reading({ state: known('above', 0) }))).toBe('warning');
  });

  it('is warning below the band', () => {
    expect(bandRole(reading({ state: known('below', 0) }))).toBe('warning');
  });

  it('is critical when out for a full lap and out of band now', () => {
    expect(bandRole(reading({ state: known('above', 0), outForFullLap: true }))).toBe('critical');
  });

  it('is critical when the last lap was out entirely, even if back in band now', () => {
    expect(bandRole(reading({ outForFullLap: true }))).toBe('critical');
  });

  it('is undefined when the state is unknown and no full lap was out', () => {
    expect(bandRole(reading({ value: unknown('realism'), state: unknown('realism') }))).toBeUndefined();
  });

  it('is critical for a full lap out even when the state is unknown', () => {
    expect(bandRole(reading({ state: unknown('notReceived'), outForFullLap: true }))).toBe('critical');
  });

  // C43: the judged lap's lapState is the one judgement the band advisory raises on; the cell shows it as the advisory does
  it('is warning when the judged lap is above or below the band, on a channel without a live state (the surface, the brakes)', () => {
    expect(bandRole(reading({ state: NO_LIVE, lapState: known('above', 0) }))).toBe('warning');
    expect(bandRole(reading({ state: NO_LIVE, lapState: known('below', 0) }))).toBe('warning');
  });

  it('is warning when the judged lap is out though the live value is back in band', () => {
    expect(bandRole(reading({ state: known('in', 0), lapState: known('above', 0) }))).toBe('warning');
  });

  it('is undefined when the judged lap is in band or unknown and the live state is in or unknown', () => {
    expect(bandRole(reading({ state: NO_LIVE, lapState: known('in', 0) }))).toBeUndefined();
    expect(bandRole(reading({ state: NO_LIVE, lapState: unknown('insufficientData') }))).toBeUndefined();
    expect(bandRole(reading({ state: known('in', 0), lapState: known('in', 0) }))).toBeUndefined();
  });

  it('is still warning when the live state is out and the judged lap in band', () => {
    expect(bandRole(reading({ state: known('above', 0), lapState: known('in', 0) }))).toBe('warning');
  });

  it('is critical when out for a full lap, whatever the lapState', () => {
    const lapStates: BandReading['lapState'][] = [known('above', 0), known('in', 0), unknown('insufficientData')];
    for (const lapState of lapStates) {
      expect(bandRole(reading({ state: NO_LIVE, outForFullLap: true, lapState }))).toBe('critical');
    }
  });
});
