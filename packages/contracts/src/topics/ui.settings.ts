import { defineTopic, type NoParams } from '../topic-def.ts';

/** `keys` is `keys.json` as parsed; the UI reads it leniently. `realismNextSession` applies at the next session start. */
export type UiSettings = { realismNextSession: boolean; keys: Record<string, unknown> };

export default defineTopic<NoParams, UiSettings>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
