// The stored sessions' unlinked human slots with their suggested persons (C54, C62c, SP4.3a spec 4): the bridge's user state, published by its profile module (C55).
import type { DriversLinksValue } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, DriversLinksValue>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
