// The value of a situation topic (contract C54, C55): one sub-machine's spans as they are — the open ones (`view.situation`)
// and the closed ones (the projection's `spans[machine]`), each with its frames (C26). Bound with `bindSituation`.
import type { OpenSpan, Span } from '@pitwall/domain';

export type MachineSpans = { open: OpenSpan[]; closed: Span[] };
