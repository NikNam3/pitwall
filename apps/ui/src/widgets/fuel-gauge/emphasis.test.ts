import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import { marginRole } from './emphasis.ts';

const at = toSessionTime(10);

describe('marginRole', () => {
  it('is critical when the margin is below zero', () => {
    expect(marginRole(known(-0.7, at))).toBe('critical');
    expect(marginRole(known(-0.01, at))).toBe('critical');
  });

  it('is undefined at exactly zero', () => {
    expect(marginRole(known(0, at))).toBeUndefined();
  });

  it('is undefined for a positive margin', () => {
    expect(marginRole(known(1.8, at))).toBeUndefined();
  });

  it('is undefined when the margin is unknown, whatever the reason', () => {
    expect(marginRole(unknown('insufficientData'))).toBeUndefined();
    expect(marginRole(unknown('realism'))).toBeUndefined();
  });
});
