import type { LinkGroup } from '../ui/types.ts';
import { defineTopic, type NoParams } from '../topic-def.ts';

/** The link groups every window shares (spec 7.5). */
export default defineTopic<NoParams, LinkGroup[]>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
