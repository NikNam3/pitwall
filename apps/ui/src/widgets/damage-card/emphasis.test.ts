import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { DamageJump } from '@pitwall/domain';
import { jumpRole } from './emphasis.ts';

const jump = (over: Partial<DamageJump> = {}): DamageJump => ({
  at: 100_000, lap: 14, parts: ['frontLeftWingPct'], deltaPct: 12, lossMsPerLap: unknown('insufficientData'), ...over,
});

describe('jumpRole', () => {
  it('is critical for the newest jump while its loss is still being measured', () => {
    expect(jumpRole(jump(), true)).toBe('critical');
  });

  it('is undefined for the newest jump once its loss is measured', () => {
    expect(jumpRole(jump({ lossMsPerLap: known(120, 5) }), true)).toBeUndefined();
  });

  it('is undefined for an older jump, even with the loss still being measured', () => {
    expect(jumpRole(jump(), false)).toBeUndefined();
  });

  it('is undefined for the newest jump whose loss is hidden for another reason', () => {
    expect(jumpRole(jump({ lossMsPerLap: unknown('realism') }), true)).toBeUndefined();
  });
});
