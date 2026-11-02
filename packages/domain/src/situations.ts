// Special situations (spec docs/history/specs/2026-10-30-situations-design.md): the session phases the engine's
// situation tracker records as spans in the history. Car situations and race control follow in later steps.
import type { SessionTime } from './ids.ts';
import type { Known } from './known.ts';

/** The phase a session is in (spec 3.1); practice and qualifying use `running` where a race uses `racing`. */
export type SessionPhaseKind =
  | 'preStart'
  | 'formation'
  | 'startLights'
  | 'racing'
  | 'running'
  | 'neutralised'
  | 'suspended'
  | 'finished'
  | 'postSession';

/** The stages of a neutralisation, in the game's SCAR order; a VSC has no `returned`. */
export type NeutralisedStage = 'deployed' | 'returning' | 'returned' | 'resume';

/** What a phase adds to its kind: the neutralising car with its stages, or how a suspension restarts. */
export type SessionPhaseDetail =
  | { kind: 'neutralised'; car: 'SC' | 'VSC'; stages: { stage: NeutralisedStage; at: SessionTime }[] }
  | { kind: 'suspended'; restart: Known<'standing' | 'rolling'> };

/**
 * One closed phase. `startLeaderLap` / `endLeaderLap` are the leader's lap in progress at the start and the end.
 * `end` can lie below `start` when the game reset the session clock inside the phase (the formation lap): take
 * durations from leader laps, not from session times, across such a span.
 * `joinedAt` marks a phase the engine joined after it began (its `start` is the first frame the engine saw).
 */
export type SessionPhaseSpan = {
  kind: SessionPhaseKind;
  start: SessionTime;
  end: SessionTime;
  startLeaderLap: number;
  endLeaderLap: number;
  joinedAt?: true;
  detail?: SessionPhaseDetail;
};

/** The phase in progress. */
export type OpenSessionPhase = Omit<SessionPhaseSpan, 'end' | 'endLeaderLap'>;

/** A pause: offline, no packets with a frozen session time (spec 3.1, over 2 s wall time); online, `gamePaused`. */
export type PauseSpan = { start: SessionTime; wallMs: number; kind: 'offline' | 'online' };
