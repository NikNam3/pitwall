import { describe, expect, it } from 'vitest';
import { severityRole } from '../../src/emphasis/index.ts';

describe('severityRole: the one severity -> role map (insight line, alarm list)', () => {
  it.each([
    ['critical', 'critical'],
    ['advisory', 'warning'],
    ['info', 'textDim'],
  ] as const)('an unacknowledged %s insight is %s', (severity, r) => expect(severityRole(severity)).toBe(r));

  it.each(['critical', 'advisory', 'info'] as const)('an acknowledged %s insight is faint', (severity) =>
    expect(severityRole(severity, true)).toBe('textFaint'),
  );
});
