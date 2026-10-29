import type { Insight } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** The theme role of an insight's severity: critical is red, advisory amber, info stays grey (undefined). */
export function severityRole(severity: Insight['severity']): Role | undefined {
  if (severity === 'critical') return 'critical';
  if (severity === 'advisory') return 'warning';
  return undefined;
}
