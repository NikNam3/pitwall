// The priors and decisions sidecars of a recording (C59, C62a, C76; spec 3.3, 3.4). A live session writes the run's
// priors (`RunPriors`: the session-start snapshot and every picked one) as `<file>.priors.json`, at session start and
// again on each pick, and every decision the user committed, with the record index it was committed at, as
// `<file>.decisions.json`. A replay or reprocess feeds both back (`recordingDecisions`); a recording without them runs
// on no priors (`notApplicable`) and no decisions. A sidecar that cannot be read is treated as absent, with one warning.
import { readFileSync, writeFileSync } from 'node:fs';
import type { DecisionRecord, PriorsSnapshot, RunPriors } from '@pitwall/domain';
import type { Logger } from '../log.ts';

/** A decision as the bridge hands it to the runner (C76): without the frame, which the decision recorder adds. */
export type GivenDecision = Omit<DecisionRecord, 'frame'>;

/**
 * One entry of the decisions sidecar: the decision and the record index it was committed at, the number of records of
 * the recording before it (C76): a replay hands it to the runner before that record, so it lands on the same frame.
 */
export type RecordedDecision = { recordIndex: number; decision: GivenDecision };

/** What a recording's sidecars hold for a replay: the run's priors and its decisions in record order. */
export type RecordedRun = { priors: RunPriors; decisions: RecordedDecision[] };

/** Where a recording's priors sidecar lives. */
export const priorsSidecarPath = (recordingPath: string): string => `${recordingPath}.priors.json`;

/** Where a recording's decisions sidecar lives. */
export const decisionsSidecarPath = (recordingPath: string): string => `${recordingPath}.decisions.json`;

/** No snapshot: `view.priors` is `notApplicable`. */
export const noRunPriors = (): RunPriors => ({ start: null, snapshots: {} });

/** Writes a sidecar as indented JSON; throws on a write failure (the caller reports it as a session-file failure). */
export function writeSidecar(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The recording's priors and decisions sidecars; a missing one is empty, one that fails to read or decode too, with a warning. */
export function recordingDecisions(recordingPath: string, log?: Logger): RecordedRun {
  const priors = readSidecar(priorsSidecarPath(recordingPath), decodeRunPriors, log) ?? noRunPriors();
  const decisions = readSidecar(decisionsSidecarPath(recordingPath), decodeDecisions, log) ?? [];
  return { priors, decisions };
}

/** The decoded sidecar at `path`; `undefined` without a file or when it fails (with a warning). */
function readSidecar<T>(path: string, decode: (json: unknown) => T | undefined, log: Logger | undefined): T | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    log?.warn({ path, err: error }, 'sidecar not readable: ignored');
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    log?.warn({ path, err: error }, 'sidecar is no JSON: ignored');
    return undefined;
  }
  const decoded = decode(json);
  if (decoded === undefined) log?.warn({ path }, 'sidecar has an unexpected shape: ignored');
  return decoded;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

const isKnownNumber = (value: unknown): boolean =>
  isObject(value) && (value['known'] === true ? typeof value['value'] === 'number' && typeof value['at'] === 'number' : value['known'] === false && isString(value['reason']));

const isSnapshot = (value: unknown, fingerprint: string): value is PriorsSnapshot =>
  isObject(value) &&
  value['fingerprint'] === fingerprint &&
  isString(value['setId']) &&
  isString(value['setName']) &&
  typeof value['sources'] === 'number' &&
  isObject(value['entries']) &&
  Object.values(value['entries']).every(isKnownNumber);

function decodeRunPriors(json: unknown): RunPriors | undefined {
  if (!isObject(json) || !isStringOrNull(json['start']) || !isObject(json['snapshots'])) return undefined;
  const snapshots = json['snapshots'];
  if (!Object.entries(snapshots).every(([fingerprint, snapshot]) => isSnapshot(snapshot, fingerprint))) return undefined;
  if (json['start'] !== null && snapshots[json['start']] === undefined) return undefined;
  return { start: json['start'], snapshots: snapshots as Record<string, PriorsSnapshot> };
}

function decodeDecision(json: unknown): RecordedDecision | undefined {
  if (!isObject(json) || !Number.isInteger(json['recordIndex']) || (json['recordIndex'] as number) < 0) return undefined;
  const decision = json['decision'];
  if (!isObject(decision) || decision['kind'] !== 'calibrationChosen' || !isStringOrNull(decision['setId']) || !isStringOrNull(decision['snapshot'])) return undefined;
  return { recordIndex: json['recordIndex'] as number, decision: { kind: 'calibrationChosen', setId: decision['setId'], snapshot: decision['snapshot'] } };
}

function decodeDecisions(json: unknown): RecordedDecision[] | undefined {
  if (!Array.isArray(json)) return undefined;
  const decisions: RecordedDecision[] = [];
  for (const item of json) {
    const decision = decodeDecision(item);
    if (decision === undefined) return undefined;
    decisions.push(decision);
  }
  return decisions;
}
