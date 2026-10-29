import { describe, expect, it } from 'vitest';
import { severityRole } from './emphasis.ts';

describe('severityRole', () => {
  it('is critical for critical', () => {
    expect(severityRole('critical')).toBe('critical');
  });

  it('is warning for advisory', () => {
    expect(severityRole('advisory')).toBe('warning');
  });

  it('is undefined (grey) for info', () => {
    expect(severityRole('info')).toBeUndefined();
  });
});
