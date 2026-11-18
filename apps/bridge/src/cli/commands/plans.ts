// `pitwall plans` (C62d, C72, SP4.3e spec §4.3): the planning round of a running bridge from the command line.
// `pitwall plans` lists the team's saved plans as `plans.prepared` publishes them; `pitwall plans open` opens a planning
// round on a qualifying and a practice basis (`plans.round.open`) and, with `--laps` and `--sets`, sets its race
// assumptions (`plans.race.set`). The round's team is the qualifying's as stored (`plans.sessions`, C62d), never the
// feed's; a qualifying stored for two teams needs `--team`. A refusal prints the bridge's message and exits 1 (C73). The
// feed is `--feed`, else the bridge's only one.
import type { PlansSessions } from '@pitwall/contracts';
import { IMPORTED, type RaceAssumptions, type SessionRef, type TeamId } from '@pitwall/domain';
import type { CliIo } from '../io.ts';
import { UsageError } from '../usage.ts';
import { chooseFeed, sendAction, topicValue, withBridge, type Bridge } from './bridge-client.ts';
import { parsePractice, parseSessionRef, savedPlans } from './sessions.ts';

export type PlansValues = { feed?: string | undefined; practice?: string[] | undefined; qualifying?: string | undefined; team?: string | undefined; laps?: string | undefined; sets?: string | undefined };

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

/** The team `qualifying` is stored for (`plans.sessions`): the one, `--team` among several, or why not. */
async function teamOf(bridge: Bridge, qualifying: SessionRef, asked: TeamId | undefined): Promise<TeamId | string> {
  const stored = (await topicValue(bridge, 'plans.sessions', 'plans-sessions')) as PlansSessions | undefined;
  const teams = [...new Set((stored?.sessions ?? [])
    .filter((s) => s.kind === 'qualifying' && s.ref.sessionUid === qualifying.sessionUid && s.ref.weekendId === qualifying.weekendId)
    .map((s) => s.team))];
  const name = `${qualifying.sessionUid}/${qualifying.weekendId}`;
  if (teams.length === 0) return `qualifying ${name} is not stored`;
  if (asked !== undefined) return teams.includes(asked) ? asked : `qualifying ${name} is not stored for team ${asked} (stored for ${teams.join(', ')})`;
  return teams.length === 1 ? teams[0]! : `qualifying ${name} is stored for teams ${teams.join(', ')}: choose one with --team`;
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
          team: values.team === undefined ? undefined : /^\d+$/.test(values.team) ? Number(values.team) : usage(`--team is a team id, got "${values.team}"`),
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
    if (open === undefined) {
      const saved = await savedPlans(bridge, feed);
      if (saved === undefined) io.out('no planning round open: open one ("pitwall plans open") to list the saved plans');
      else if (saved.length === 0) io.out('no saved plans');
      for (const plan of saved ?? []) io.out(`${plan.id}  ${plan.name}  ${plan.savedAt}`);
      return 0;
    }
    const team = await teamOf(bridge, open.qualifying, open.team);
    if (typeof team === 'string') {
      io.err(`pitwall: ${team}`);
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
