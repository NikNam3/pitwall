import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { BandReading } from '@pitwall/domain';
import { bandRole } from './emphasis.ts';

const reading = (over: Partial<BandReading> = {}): BandReading => ({
  value: known(90, 0), state: known('in', 0), band: { lo: 80, hi: 100 }, outForFullLap: false, ...over,
});

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
});
