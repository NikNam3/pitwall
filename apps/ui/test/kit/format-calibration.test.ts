// Kit formats the calibration displays need (docs/design/2026-11-06-sp4.1a/README.md, "Follow-ups"; C68):
//  - `formatSigma(s)`: a residual in standard deviations, signed, one decimal, the true minus: `0.4` -> `+0.4σ`,
//    `-1.26` -> `−1.3σ`; a value that rounds to zero is `+0.0σ` (no negative zero); a non-finite value is '';
//  - `formatDay(iso)`: a calendar day of an ISO date as written (`2026-10-15` -> `15 Oct`, the day two digits, no time
//    zone conversion: a full ISO timestamp shows its own date part); a string that is no ISO date is ''. Only for
//    `createdAt`, `lastUsedAt` and a stored session's date, never a race-clock time (C35).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDay, formatSigma, MINUS } from '../../src/kit/values/format.ts';

describe('formatSigma', () => {
  it('a positive residual is +, one decimal, σ', () => {
    expect(formatSigma(0.4)).toBe('+0.4σ');
    expect(formatSigma(2.04)).toBe('+2.0σ');
    expect(formatSigma(12.36)).toBe('+12.4σ');
  });
  it('a negative residual takes the true minus', () => {
    expect(formatSigma(-1.26)).toBe(`${MINUS}1.3σ`);
    expect(formatSigma(-0.4)).toBe(`${MINUS}0.4σ`);
  });
  it('zero, and a value that rounds to zero, is +0.0σ', () => {
    expect(formatSigma(0)).toBe('+0.0σ');
    expect(formatSigma(-0)).toBe('+0.0σ');
    expect(formatSigma(-0.01)).toBe('+0.0σ');
    expect(formatSigma(0.04)).toBe('+0.0σ');
  });
  it('a non-finite value is empty', () => {
    expect(formatSigma(Number.NaN)).toBe('');
    expect(formatSigma(Number.POSITIVE_INFINITY)).toBe('');
  });
  it('never prints an ASCII hyphen', () => {
    fc.assert(fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (s) => !formatSigma(s).includes('-')));
  });
});

describe('formatDay', () => {
  it('an ISO date is its day and month', () => {
    expect(formatDay('2026-10-15')).toBe('15 Oct');
    expect(formatDay('2026-11-06')).toBe('06 Nov');
    expect(formatDay('2026-09-02')).toBe('02 Sep');
  });
  it.each([
    ['01', 'Jan'], ['02', 'Feb'], ['03', 'Mar'], ['04', 'Apr'], ['05', 'May'], ['06', 'Jun'],
    ['07', 'Jul'], ['08', 'Aug'], ['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec'],
  ])('month %s is %s', (month, name) => {
    expect(formatDay(`2026-${month}-28`)).toBe(`28 ${name}`);
  });
  it('a full ISO timestamp shows its own date part, with no time zone conversion', () => {
    expect(formatDay('2026-10-15T23:30:00.000Z')).toBe('15 Oct');
    expect(formatDay('2026-10-15T00:10:00+02:00')).toBe('15 Oct');
  });
  it('a string that is no ISO date is empty', () => {
    expect(formatDay('')).toBe('');
    expect(formatDay('yesterday')).toBe('');
    expect(formatDay('2026-13-01')).toBe('');
  });
});
