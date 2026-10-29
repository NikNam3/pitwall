import { describe, expect, it } from 'vitest';
import sessionRemaining from '../../../src/features/session-remaining/register.ts';

describe('session-remaining feature', () => {
  it('registers the calculator session-remaining and binds no topic', () => {
    expect(sessionRemaining.name).toBe('session-remaining');
    expect(sessionRemaining.calculators.map((c) => c.id)).toEqual(['session-remaining']);
    expect(sessionRemaining.topics).toEqual([]);
  });
});
