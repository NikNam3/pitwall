// `pitwall basis` (C62, C72, SP4.3e spec §4.2): the CLI picker of a running bridge's basis. `pitwall basis` prints the
// feed's basis from `basis.active` (per kind each session with its date, the chosen plan); `pitwall basis choose` sends
// one `basis.choose` uiAction (C76) and prints the bridge's refusal, if any, with exit code 1 (C73). A session is
// written `<sessionUid>/<weekendId>`; `--practice` repeats (`none` alone: none), `--qualifying` takes one or `none`,
// `--plan` an id, a saved plan's exact name or `none` (absent: the plan stays). The feed is `--feed`, else the bridge's
// only one.
import type { TopicValue } from '@pitwall/contracts';
import { basisKey, type FeedId, type SessionBasis, type SessionRef } from '@pitwall/domain';
import type { CliIo } from '../io.ts';
import { UsageError } from '../usage.ts';
import { chooseFeed, sendAction, topicValue, withBridge, type Bridge } from './bridge-client.ts';
import { parsePractice, parseQualifying, savedPlans, sessionText } from './sessions.ts';

export type BasisValues = { feed?: string | undefined; practice?: string[] | undefined; qualifying?: string | undefined; plan?: string | undefined };

type BasisActive = TopicValue<'basis.active'>;

const KIND_WIDTH = 'qualifying'.length + 2;
const row = (label: string, text: string): string => `${label.padEnd(KIND_WIDTH)}${text}`;

function sessionLine(active: BasisActive, kind: string, ref: SessionRef): string {
  const known = active.sessions[`${ref.sessionUid}@${ref.weekendId}`];
  return row(kind, `${sessionText(ref)}  ${known?.date ?? 'date unknown'}`);
}

function basisLines(active: BasisActive, basis: SessionBasis): string[] {
  const lines = basis.practice.length === 0 ? [row('practice', 'none')] : basis.practice.map((p) => sessionLine(active, 'practice', p));
  lines.push(basis.qualifying === null ? row('qualifying', 'none') : sessionLine(active, 'qualifying', basis.qualifying));
  return lines;
}

function activeLines(feed: FeedId, active: BasisActive): string[] {
  const lines = [`feed ${feed}`, ...basisLines(active, active.basis)];
  const race = active.raceLaps === null ? '' : `; race ${active.raceLaps} laps`;
  lines.push(row('plan', active.plan === null ? `none${race}` : `${active.plan.name}  ${active.plan.id}  (computed for ${active.plan.laps} laps${race})`));
  if (active.rebuilding !== null) lines.push(`rebuilding the chosen sessions: ${active.rebuilding.done} of ${active.rebuilding.total}`);
  if (basisKey(active.start) !== basisKey(active.basis)) lines.push('', 'session start:', ...basisLines(active, active.start));
  return lines;
}

/** The plan `--plan` names: `none` (null), a saved plan's id, else a saved plan's exact name; a message when it names none or several. */
async function resolvePlan(bridge: Bridge, feed: FeedId, text: string): Promise<{ plan: string | null } | { error: string }> {
  if (text === 'none') return { plan: null };
  const saved = await savedPlans(bridge, feed);
  // Without a published list the text is passed on as an id, and the bridge validates it.
  if (saved === undefined || saved.some((p) => p.id === text)) return { plan: text };
  const named = saved.filter((p) => p.name === text);
  if (named.length === 1 && named[0] !== undefined) return { plan: named[0].id };
  return { error: named.length === 0 ? `no saved plan has the id or name "${text}"` : `${named.length} saved plans are named "${text}"; name one by its id (${named.map((p) => p.id).join(', ')})` };
}

function need<T>(value: T | undefined, option: string): T {
  if (value === undefined) throw new UsageError(`basis choose needs ${option}`);
  return value;
}

/** `pitwall basis [choose --practice <session>|none … --qualifying <session>|none [--plan <id|name>|none]] [--feed id]`. */
export async function run(positionals: string[], values: BasisValues, io: CliIo): Promise<number> {
  const [verb, ...rest] = positionals;
  if (rest.length > 0) throw new UsageError(`basis takes no argument "${rest[0]}"`);
  if (verb !== undefined && verb !== 'choose') throw new UsageError(`unknown basis command "${verb}"`);
  // A usage error before any connection.
  const basis: SessionBasis | undefined =
    verb === 'choose' ? { practice: parsePractice(need(values.practice, '--practice <session> or none')), qualifying: parseQualifying(need(values.qualifying, '--qualifying <session> or none')) } : undefined;
  return withBridge(io, 'pitwall basis', async (bridge) => {
    const chosen = chooseFeed(bridge, values.feed);
    if ('error' in chosen) {
      io.err(`pitwall: ${chosen.error}`);
      return 1;
    }
    const { feed } = chosen;
    if (basis === undefined) {
      const active = (await topicValue(bridge, 'basis.active', 'basis-active', feed)) as BasisActive | undefined;
      if (active === undefined) {
        io.err(`pitwall: feed ${feed} publishes no basis yet (no session with its team known)`);
        return 1;
      }
      for (const line of activeLines(feed, active)) io.out(line);
      return 0;
    }
    let plan: string | null | undefined;
    if (values.plan !== undefined) {
      const resolved = await resolvePlan(bridge, feed, values.plan);
      if ('error' in resolved) {
        io.err(`pitwall: ${resolved.error}`);
        return 1;
      }
      plan = resolved.plan;
    }
    const refusal = await sendAction(bridge, { kind: 'basis.choose', feedId: feed, basis, plan }, 'basis-choose');
    if (refusal === undefined) return 0;
    io.err(`pitwall: ${refusal}`);
    return 1;
  });
}
