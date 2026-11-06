// Shared by the decision tests (contract C10, C27a, C62a, C76): a decision as the bridge hands it to the runner, priors
// snapshots and the run's priors, and `applyWith`, which gives the runner a frame with the decisions committed at it.
import { known, type DecisionRecord, type Known, type PriorsSnapshot, type RunPriors } from '@pitwall/domain';
import type { DeepReadonly, Frame, OnResult, SessionRunner } from '../../src/index.ts';

/** A decision as the bridge hands it to the runner: without the frame, which the decision recorder adds (C10). */
export type GivenDecision = Omit<DecisionRecord, 'frame'>;

/** `calibrationChosen` of set `setId` with its snapshot `snapshot`; both `null` for `defaults` (C62a, spec 3.3). */
export const chosen = (setId: string | null, snapshot: string | null): GivenDecision => ({ kind: 'calibrationChosen', setId, snapshot });

/** The choice of `defaults`: no set, no snapshot. */
export const DEFAULTS: GivenDecision = chosen(null, null);

/** A priors snapshot named by its fingerprint `fingerprint`, of set `set-<fingerprint>`, with one entry. */
export const snapshot = (fingerprint: string, entry = 1): PriorsSnapshot => ({
  fingerprint,
  setId: `set-${fingerprint}`,
  setName: `Set ${fingerprint}`,
  sources: 1,
  entries: { 'probe.entry': known(entry, 0) },
});

export const SNAP_A = snapshot('A', 1);
export const SNAP_B = snapshot('B', 2);
/** The choice of set `set-B` and its snapshot `B`. */
export const PICK_B = chosen(SNAP_B.setId, SNAP_B.fingerprint);
/** The choice of set `set-A` and its snapshot `A`. */
export const PICK_A = chosen(SNAP_A.setId, SNAP_A.fingerprint);

/** The run's priors: the session started on `start`; every snapshot of the run (A and B), by fingerprint. */
export const runPriors = (start: string | null): RunPriors => ({ start, snapshots: { A: SNAP_A, B: SNAP_B } });

/** What a `Known` priors snapshot says: the snapshot, or the reason it is unknown. The time it carries is not compared. */
export const priorsValue = (priors: Known<DeepReadonly<PriorsSnapshot>> | undefined): DeepReadonly<PriorsSnapshot> | string | undefined =>
  priors === undefined ? undefined : priors.known ? priors.value : priors.reason;

/** `SessionRunner.apply` with the decisions the user committed at the frame (C10, C76; spec 3.4). */
type ApplyWithDecisions = (frame: Frame, onResult?: OnResult, decisions?: readonly GivenDecision[]) => void;

/** Applies `frame` with `decisions` (none when absent), handing each applied frame's result to `onResult`. */
export const applyWith = (runner: SessionRunner, frame: Frame, decisions?: readonly GivenDecision[], onResult?: OnResult): void => {
  const apply: ApplyWithDecisions = runner.apply.bind(runner);
  apply(frame, onResult, decisions);
};
