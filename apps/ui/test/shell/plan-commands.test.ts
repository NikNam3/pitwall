// SP4.3b Task 17, delegated (C72, C73, C76; spec §8.2): the plan decision's commands in the shell's one registry.
// Seam: `planCommands(cars, ctx)` in `src/shell/commands/default-commands.ts`, with `planCommitId(carId)` (`plan.commit.<carId>`)
// and `planClearId(carId)` (`plan.clear.<carId>`). Per car given, `plan.clear.<carId>` sends `plan.clear { feedId, carId }`;
// `plan.commit.<carId>` exists only for a car given a policy and sends `plan.commit { feedId, carId, policy }` with that
// policy whole; `feedId` is the window's feed (`ctx.feedId`, as `calibrationCommands` takes it). Each command has a title and a group from `kit/text.ts` (C68). The window keeps no copy (C73): the plan takes
// effect when the bridge records it. The strategy table's buttons that invoke them come in 4.3b2.
import type { UiAction } from '@pitwall/contracts';
import { carId, feedId, type CarId, type FeedId, type Policy } from '@pitwall/domain';
import { describe, expect, it, vi } from 'vitest';
import * as defaults from '../../src/shell/commands/default-commands.ts';
import { CommandRegistry, type Command } from '../../src/shell/commands/registry.ts';

/** The seam this task adds to `default-commands.ts`; read through the module so the file compiles before it exists. */
type PlanSeam = {
  planCommitId: (carId: CarId) => string;
  planClearId: (carId: CarId) => string;
  planCommands: (cars: readonly { carId: CarId; policy: Policy | null }[], ctx: { send: (action: UiAction) => void; feedId: FeedId }) => Command[];
};
const FEED = feedId('udp-20777');
const { planCommitId, planClearId, planCommands } = defaults as unknown as PlanSeam;

const POLICY: Policy = {
  stops: [{ lap: 18, compound: 'hard' }],
  triggers: [{ kind: 'neutralised', condition: 'sc', fromLap: 8, toLap: 30, action: { box: 'medium' } }],
};

describe('the plan commands (C72)', () => {
  it('plan.commit.<carId> and plan.clear.<carId> send the plan uiActions', () => {
    expect(planCommitId(carId(0))).toBe('plan.commit.0');
    expect(planClearId(carId(1))).toBe('plan.clear.1');
    const send = vi.fn();
    const commands = planCommands([{ carId: carId(0), policy: POLICY }, { carId: carId(1), policy: null }], { send, feedId: FEED });
    expect(commands.map((c) => c.id).sort()).toEqual(['plan.clear.0', 'plan.clear.1', 'plan.commit.0']);
    for (const c of commands) {
      expect(c.title, c.id).toMatch(/\S/);
      expect(c.group, c.id).toMatch(/\S/);
    }
    const registry = new CommandRegistry();
    for (const c of commands) registry.register(c);
    registry.run('plan.commit.0');
    expect(send).toHaveBeenLastCalledWith({ kind: 'plan.commit', feedId: FEED, carId: 0, policy: POLICY });
    registry.run('plan.clear.1');
    expect(send).toHaveBeenLastCalledWith({ kind: 'plan.clear', feedId: FEED, carId: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
