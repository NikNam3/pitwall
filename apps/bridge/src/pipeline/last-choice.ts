// The team's last confirmed choice (SP4.3e spec §4.2, Task 7a-1; C62, C62d, C70): bridge user state in
// `PITWALL_DATA_DIR/basis/<team>.json`, one entry per track id. Written atomically; a missing file reads `undefined`, a
// corrupt file or entry `undefined` with a warning (C3).
import { join } from 'node:path';
import type { SessionRef, TeamId, TrackId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { ensureDir, parseJson, readText, writeAtomic } from '../ui-state/ui-files.ts';
import type { LastChoice, LastChoiceStore } from './last-choice-types.ts';

type ChoiceFile = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isRef = (value: unknown): value is SessionRef =>
  isObject(value) && typeof value['sessionUid'] === 'string' && typeof value['weekendId'] === 'string';

function isLastChoice(value: unknown): value is LastChoice {
  if (!isObject(value) || typeof value['trackId'] !== 'number') return false;
  const basis = value['basis'];
  const plan = value['plan'];
  if (!isObject(basis) || !isObject(plan)) return false;
  const practice = basis['practice'];
  const qualifying = basis['qualifying'];
  return (
    (practice === undefined ||
      (isObject(practice) && Array.isArray(practice['refs']) && practice['refs'].every(isRef) && typeof practice['at'] === 'string')) &&
    (qualifying === undefined ||
      (isObject(qualifying) && (qualifying['ref'] === null || isRef(qualifying['ref'])) && typeof qualifying['at'] === 'string')) &&
    (plan['id'] === null || typeof plan['id'] === 'string') &&
    typeof plan['at'] === 'string'
  );
}

export function createLastChoiceStore(dir: string, log: Pick<Logger, 'warn'>): LastChoiceStore {
  const basisDir = join(dir, 'basis');
  const pathOf = (team: TeamId): string => join(basisDir, `${team}.json`);

  /** The team's file as entries per track id; `undefined` when missing or corrupt (the latter warned). */
  function readFile(team: TeamId): ChoiceFile | undefined {
    const path = pathOf(team);
    const text = readText(path);
    if (text === undefined) return undefined;
    const parsed = parseJson(text);
    if (!parsed.ok || !isObject(parsed.value)) {
      log.warn({ path, reason: parsed.ok ? 'not an object' : parsed.message }, 'last choice file is corrupt; ignored');
      return undefined;
    }
    return parsed.value;
  }

  return {
    read(team, trackId: TrackId) {
      const file = readFile(team);
      if (file === undefined) return undefined;
      const entry = file[String(trackId)];
      if (entry === undefined) return undefined;
      if (!isLastChoice(entry) || entry.trackId !== trackId) {
        log.warn({ path: pathOf(team), trackId }, 'last choice entry is corrupt; ignored');
        return undefined;
      }
      return entry;
    },
    write(team, choice) {
      ensureDir(basisDir);
      const file = readFile(team) ?? {};
      writeAtomic(pathOf(team), `${JSON.stringify({ ...file, [String(choice.trackId)]: choice }, null, 2)}\n`);
    },
  };
}
