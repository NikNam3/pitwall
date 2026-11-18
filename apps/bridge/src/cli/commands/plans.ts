// `pitwall plans` (C62d, C72, SP4.3e spec §4.3): the planning round of a running bridge from the command line.
// `pitwall plans` lists the team's saved plans as `plans.prepared` publishes them; `pitwall plans open` opens a planning
// round on a qualifying and a practice basis (`plans.round.open`) and, with `--laps` and `--sets`, sets its race
// assumptions (`plans.race.set`). A refusal prints the bridge's message and exits 1 (C73). The feed is `--feed`, else
// the bridge's only one.
import { IMPORTED, type RaceAssumptions } from '@pitwall/domain';
import type { CliIo } from '../io.ts';
import { UsageError } from '../usage.ts';
import { chooseFeed, sendAction, withBridge } from './bridge-client.ts';
import { parsePractice, parseSessionRef, savedPlans } from './sessions.ts';

export type PlansValues = { feed?: string | undefined; practice?: string[] | undefined; qualifying?: string | undefined; laps?: string | undefined; sets?: string | undefined };

const usage = (message: string): never => {
  throw new UsageError(message);
};

/** `--laps n --sets carried|fresh`, both or neither. */
function raceOf(values: PlansValues): RaceAssumptions | undefined {
  if (values.laps === undefined && values.sets === undefined) return undefined;
  if (values.laps === undefined || values.sets === undefined) throw new UsageError('plans open takes --laps and --sets together');
  if (!/^\d+$/.test(values.laps) || Number(values.laps) < 1) throw new UsageError(`--laps is a whole number of at least 1, got "${values.laps}"`);
  if (values.sets !== 'carried' && values.sets !== 'fresh') throw new UsageError(`--sets is carried or fresh, got "${values.sets}"`);
  return { laps: Number(values.laps), sets: values.sets, conditions: IMPORTED };
}

/** `pitwall plans [open --qualifying <session> [--practice <session>|none …] [--laps n --sets carried|fresh]] [--feed id]`. */
export async function run(positionals: string[], values: PlansValues, io: CliIo): Promise<number> {
  const [verb, ...rest] = positionals;
  if (rest.length > 0) throw new UsageError(`plans takes no argument "${rest[0]}"`);
  if (verb !== undefined && verb !== 'open') throw new UsageError(`unknown plans command "${verb}"`);
  // A usage error before any connection.
  const open =
    verb === 'open'
      ? {
          qualifying: values.qualifying === undefined ? usage('plans open needs --qualifying <session>') : parseSessionRef(values.qualifying, '--qualifying'),
          practice: parsePractice(values.practice ?? []),
          race: raceOf(values),
        }
      : undefined;
  return withBridge(io, 'pitwall plans', async (bridge) => {
    const chosen = chooseFeed(bridge, values.feed);
    if ('error' in chosen) {
      io.err(`pitwall: ${chosen.error}`);
      return 1;
    }
    const { feed } = chosen;
    const team = bridge.feeds.find((f) => f.feedId === feed)?.team ?? null;
    if (open === undefined) {
      const saved = await savedPlans(bridge, feed);
      if (saved === undefined) io.out('no planning round open: open one ("pitwall plans open") to list the saved plans');
      else if (saved.length === 0) io.out('no saved plans');
      for (const plan of saved ?? []) io.out(`${plan.id}  ${plan.name}  ${plan.savedAt}`);
      return 0;
    }
    if (team === null) {
      io.err(`pitwall: feed ${feed} has no team yet (Participants not received); open a round once it has`);
      return 1;
    }
    const refusal =
      (await sendAction(bridge, { kind: 'plans.round.open', feedId: feed, team, qualifying: open.qualifying, practice: open.practice }, 'plans-round-open')) ??
      (open.race === undefined ? undefined : await sendAction(bridge, { kind: 'plans.race.set', feedId: feed, race: open.race }, 'plans-race-set'));
    if (refusal === undefined) return 0;
    io.err(`pitwall: ${refusal}`);
    return 1;
  });
}
