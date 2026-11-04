// The value of a situation topic (contract C54, C55): one sub-machine's open spans as they are (`view.situation`), each with
// the frame it opened on (C26). Bound with `bindSituation`. Closed spans are not resent at the topic's rate: a display that
// needs a machine's closed spans gets an append topic of its own.
import type { OpenSpan } from '@pitwall/domain';

export type MachineSpans = { open: OpenSpan[] };
