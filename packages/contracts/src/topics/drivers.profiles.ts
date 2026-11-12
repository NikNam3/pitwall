// Every person with their driver profile, links and exclusions (C54, C62c, SP4.3a spec 4): the bridge's user state, published by its profile module (C55).
import type { DriversProfilesValue } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, DriversProfilesValue>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
