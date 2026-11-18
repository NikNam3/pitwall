// The basis sidecar of a recording (C38, C59, C62; SP4.3e spec §4.2): a live session writes `<file>.basis.json` at its
// first Participants, `{ start, preselected }`: the current sessions it started with, and, for display only, the whole
// preselection. A replay or reprocess starts on its `start`; the basis-chosen decisions come back from the decisions
// sidecar (C76). A recording without one has the session's own weekend's earlier sessions as its basis (C62).
import { decodeUiAction } from '@pitwall/contracts/ui/decode';
import type { BasisSidecar, SessionBasis } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { readSidecar } from './decision-sidecars.ts';

/** Where a recording's basis sidecar lives. */
export const basisSidecarPath = (recordingPath: string): string => `${recordingPath}.basis.json`;

/** A basis by the shape rule of `basis.choose` (the contracts package's decoder, C73). */
const decodeBasis = (json: unknown): SessionBasis | undefined => {
  const action = decodeUiAction({ kind: 'basis.choose', feedId: '', basis: json, plan: undefined });
  return action?.kind === 'basis.choose' ? action.basis : undefined;
};

function decodeBasisSidecar(json: unknown): BasisSidecar | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const { start, preselected } = json as Record<string, unknown>;
  const startBasis = decodeBasis(start);
  const preselectedBasis = decodeBasis(preselected);
  return startBasis === undefined || preselectedBasis === undefined ? undefined : { start: startBasis, preselected: preselectedBasis };
}

/** The recording's basis sidecar; `null` without one, or when it fails to read or decode (with a warning). */
export function recordingBasis(recordingPath: string, log?: Logger): BasisSidecar | null {
  return readSidecar(basisSidecarPath(recordingPath), decodeBasisSidecar, log) ?? null;
}
