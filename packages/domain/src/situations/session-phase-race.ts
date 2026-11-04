// The race's session-phase sub-machine's span declaration (contract C14, C15, C17): session-scoped, the phases of a
// race or sprint from the grid to the post-session.
import { defineSpans } from '../facts.ts';
import type { SessionTime } from '../ids.ts';
import type { Known } from '../known.ts';

/** The stages of a neutralisation, in the game's SCAR order; a VSC has no `returned`. */
export type NeutralisedStage = 'deployed' | 'returning' | 'returned' | 'resume';

/** The detail of a `neutralised` span: the neutralising car and the stages seen so far, each with its race-clock time. */
export type NeutralisedDetail = { car: 'SC' | 'VSC'; stages: Array<{ stage: NeutralisedStage; at: SessionTime }> };

/** The detail of a `suspended` span (every weekend phase): how the session restarts, known once its restart is seen. */
export type SuspendedDetail = { restart: Known<'standing' | 'rolling'> };

/** The race's session phases (`spans:session-phase-race`); the other kinds have no detail. */
export const spans = defineSpans({
  machine: 'session-phase-race',
  scope: 'session',
  kinds: ['grid', 'formation', 'startLights', 'racing', 'neutralised', 'suspended', 'finished', 'postSession'],
});
