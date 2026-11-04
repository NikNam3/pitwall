// Feed status's presentation table (contract C66): the weekend phase's kind (`situation.weekendPhase`), with its detail's
// format, to the session's name its session line shows beside the track. A sprint shootout (its short and one-shot
// variants included) reads "sprint shootout", the race with format `sprint` "sprint". `none` (a time trial or an unknown
// session type) shows no name.
import type { OpenSpan, PracticeFormat, QualifyingFormat, RaceFormat, weekendPhaseSpans } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import * as text from './text.ts';

type PhaseKind = (typeof weekendPhaseSpans)['kinds'][number];

/** A weekend phase's row: the session's name by its detail's format; none for `none`. */
export type PhaseRow<F extends string = string> = { readonly byFormat: Readonly<Record<F, string>> } | { readonly byFormat: undefined };

type FeedTable = PresentationTable & {
  situations: {
    'weekend-phase': {
      practice: PhaseRow<PracticeFormat>;
      qualifying: PhaseRow<QualifyingFormat>;
      race: PhaseRow<RaceFormat>;
      none: PhaseRow;
    } & Readonly<Record<PhaseKind, PhaseRow>>;
  };
};

export const presentation: FeedTable = {
  situations: {
    'weekend-phase': {
      practice: { byFormat: { practice: text.phase.practice, shortPractice: text.phase.practice } },
      qualifying: {
        byFormat: {
          grandPrix: text.phase.qualifying,
          short: text.phase.qualifying,
          oneShot: text.phase.qualifying,
          sprintShootout: text.phase.sprintShootout,
          shortSprintShootout: text.phase.sprintShootout,
          oneShotSprintShootout: text.phase.sprintShootout,
        },
      },
      race: { byFormat: { grandPrix: text.phase.race, sprint: text.phase.sprint } },
      none: { byFormat: undefined },
    },
  },
};

/** The session's name from the weekend phase's open span; none while the phase is pending (no open span) or the topic has no value. */
export function phaseLabel(span: OpenSpan | undefined): string | undefined {
  if (span === undefined) return undefined;
  const names: Readonly<Record<string, string>> | undefined = presentation.situations['weekend-phase'][span.kind as PhaseKind]?.byFormat;
  const format = (span.detail as { format?: string } | undefined)?.format;
  return names === undefined || format === undefined ? undefined : names[format];
}
