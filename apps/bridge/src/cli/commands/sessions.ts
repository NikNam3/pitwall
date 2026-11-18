// What `pitwall basis` and `pitwall plans` share: a stored session as the command line writes it,
// `<sessionUid>/<weekendId>`, and the saved plans as `plans.prepared` publishes them. Not a command of its own.
import type { SessionRef } from '@pitwall/domain';
import { UsageError } from '../usage.ts';
import { topicValue, type Bridge } from './bridge-client.ts';
import type { FeedId } from '@pitwall/domain';

export const sessionText = (s: SessionRef): string => `${s.sessionUid}/${s.weekendId}`;

/** `<sessionUid>/<weekendId>`. */
export function parseSessionRef(text: string, option: string): SessionRef {
  const [sessionUid, weekendId] = /^(\d+)\/(\d+)$/.exec(text)?.slice(1) ?? [];
  if (sessionUid === undefined || weekendId === undefined) throw new UsageError(`${option} takes <sessionUid>/<weekendId> or none, got "${text}"`);
  return { sessionUid, weekendId };
}

/** `--practice` repeated: each a session, or `none` alone for none (ruling R12). */
export function parsePractice(texts: readonly string[]): SessionRef[] {
  if (texts.includes('none')) {
    if (texts.length > 1) throw new UsageError('--practice none stands alone');
    return [];
  }
  return texts.map((t) => parseSessionRef(t, '--practice'));
}

/** `--qualifying`: a session, or `none`. */
export const parseQualifying = (text: string): SessionRef | null => (text === 'none' ? null : parseSessionRef(text, '--qualifying'));

/** A saved plan as `plans.prepared` lists it while a planning round is open (`PlanningRoundState.saved`). */
export type SavedPlanEntry = { id: string; name: string; savedAt: string };

/** The feed's saved plans from `plans.prepared`; `undefined` while it publishes no list (no round open). */
export async function savedPlans(bridge: Bridge, feed: FeedId): Promise<SavedPlanEntry[] | undefined> {
  const value = (await topicValue(bridge, 'plans.prepared', 'plans-prepared', feed)) as { open: boolean; saved?: SavedPlanEntry[] } | undefined;
  return value?.open === true && Array.isArray(value.saved) ? value.saved : undefined;
}
