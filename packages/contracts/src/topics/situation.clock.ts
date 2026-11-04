// The `clock` sub-machine's open spans, as they are (C54); bound with `bindSituation` (C55).
import type { MachineSpans } from '../situation-spans.ts';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, MachineSpans>({ owner: 'core', mode: 'state', maxHz: 4 });
