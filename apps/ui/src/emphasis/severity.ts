import type { Insight } from '@pitwall/domain';
import type { Role } from '../theme/roles.ts';

const BY_SEVERITY: Record<Insight['severity'], Role> = { critical: 'critical', advisory: 'warning', info: 'textDim' };

/** The role of an insight by its severity: critical red, advisory amber, info grey; faint once acknowledged. */
export const severityRole = (severity: Insight['severity'], acknowledged = false): Role => (acknowledged ? 'textFaint' : BY_SEVERITY[severity]);
