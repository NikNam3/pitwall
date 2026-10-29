import { describe, expect, it } from 'vitest';
import { role, roleOrUndefined } from '../../src/theme/index.ts';

describe('roleOrUndefined', () => {
  it('is the role colour for a role and undefined for none', () => {
    expect(roleOrUndefined('critical')).toBe(role('critical'));
    expect(roleOrUndefined(undefined)).toBeUndefined();
  });
});
