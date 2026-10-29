import { describe, expect, it } from 'vitest';
import { role, roleOrUndefined } from '../../src/theme/index.ts';

describe('roleOrUndefined', () => {
  it('is the role colour for a role and undefined for none', () => {
    expect(roleOrUndefined('critical')).toBe(role('critical'));
    expect(roleOrUndefined(undefined)).toBeUndefined();
  });
  it('takes a fallback role for none, so a display never writes `r ? role(r) : role(x)`', () => {
    expect(roleOrUndefined(undefined, 'textDim')).toBe(role('textDim'));
    expect(roleOrUndefined('warning', 'textDim')).toBe(role('warning'));
  });
});
