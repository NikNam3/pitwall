// Feed status's presentation table (contract C66): the weekend phase's kind (`situation.weekendPhase`) to the word its
// session line shows beside the track. `none` (a time trial or an unknown session type) shows no word.
import type { OpenSpan, weekendPhaseSpans } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import * as text from './text.ts';

type PhaseKind = (typeof weekendPhaseSpans)['kinds'][number];

/** A weekend phase's row: the word on the session line, or none. */
export type PhaseRow = { readonly label: string | undefined };

export const presentation = {
  situations: {
    'weekend-phase': {
      practice: { label: text.phase.practice },
      qualifying: { label: text.phase.qualifying },
      race: { label: text.phase.race },
      none: { label: undefined },
    },
  },
} as const satisfies PresentationTable & { situations: { 'weekend-phase': Readonly<Record<PhaseKind, PhaseRow>> } };

/** The word of the weekend phase's open span; none while the phase is pending (no open span) or the topic has no value. */
export const phaseLabel = (span: OpenSpan | undefined): string | undefined =>
  span === undefined ? undefined : presentation.situations['weekend-phase'][span.kind as PhaseKind]?.label;
