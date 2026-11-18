// @vitest-environment jsdom
// SP4.3e Task 8 (C72, C73; planner report 6a): the planning-round save on the teammate's board. It lives in the shell's
// panel folder: it drives the panel path (a widget test may not import the shell, C69). Contract assumed:
//  - the teammate's board is a plan board in a real `Panel` whose link group has primary `teammate`, resolved by the
//    shell's `resolveLink` (the teammate's own feed when the bridge has it); the panel's `invoke` is a real
//    `CommandRegistry`'s with the planning commands registered (`planningCommands(send)`), as WindowShell wires it;
//  - saving a DP line to a slot (`→ slot`, then the slot) invokes `plans.prepare.save` through the registry, which sends
//    `{ kind: 'plans.prepare.save', feedId: <the teammate's feed>, carId: <the teammate>, slot, policy }`;
//  - the bridge's rejection (`{ ok: false, reason, message }`) is shown on the board: an element in the warning role
//    (`data-role="warning"`, the board's `rejectedRole`) carries the bridge's message as its text or hover (C73: an
//    invalid action answers with a rejection the UI shows; never a silent nothing).
import type { ActionOutcome, FeedInfo, LinkGroup, PanelSpec, SessionInfo, UiAction } from '@pitwall/contracts';
import { carId, feedId, type CarId, type FeedId, type SessionUid } from '@pitwall/domain';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeConnection } from '../../../test/connection/fake-connection.ts';
import { TopicStore } from '../../connection/topic-store.svelte.ts';
import { KUH, KUH_NUMBER, preview, round } from '../../widgets/plan-board/fixtures.ts';
import planBoard from '../../widgets/plan-board/register.ts';
import { planningCommands } from '../commands/default-commands.ts';
import { CommandRegistry } from '../commands/registry.ts';
import { resolveLink } from '../link-groups/resolve.ts';
import Panel from './Panel.svelte';

const FEED = feedId('20777');
const TEAMMATE_FEED = feedId('20778');
/** The teammate next to our KUH. */
const TEAMMATE = carId(1);
const UID = '548397152' as SessionUid;
const TEAM = 0;
const MESSAGE = 'car 1 has no planning round';

const session = (feed: FeedId, playerCar: CarId, teammateCar: CarId): SessionInfo => ({
  feedId: feed,
  sessionUid: UID,
  playerCar,
  teammateCar,
  session: {} as SessionInfo['session'],
  realism: false,
});
const feedInfo = (feed: FeedId): FeedInfo => ({ feedId: feed, kind: 'udp', label: String(feed), sessionUid: UID, team: TEAM });
const GROUP: LinkGroup = { id: 2, primary: 'teammate', compare: [], window: { kind: 'live' } };
const SPEC: PanelSpec = { widget: 'plan-board', options: { source: 'planning' }, linkGroup: 2 };

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width: 1600, height: 800 } }]);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {}, matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const testid = (c: Element, id: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('plan board: the teammate\'s board in the planning round', () => {
  it('the teammate\'s board (link group primary teammate) invokes plans.prepare.save through the registry and shows a rejection\'s message', async () => {
    const link = resolveLink(GROUP, session(FEED, KUH, TEAMMATE), FEED, [
      { info: feedInfo(FEED), session: session(FEED, KUH, TEAMMATE) },
      { info: feedInfo(TEAMMATE_FEED), session: session(TEAMMATE_FEED, TEAMMATE, KUH) },
    ]);
    expect(link).toEqual({ group: 2, feedId: TEAMMATE_FEED, primary: TEAMMATE, compare: [], window: { kind: 'live' } });

    const sent: UiAction[] = [];
    const send = (action: UiAction): Promise<ActionOutcome> => {
      sent.push(action);
      return Promise.resolve({ ok: false, reason: 'invalid', message: MESSAGE });
    };
    const registry = new CommandRegistry();
    for (const command of planningCommands(send)) registry.registerWithArgs(command);

    const connection = new FakeConnection();
    const store = new TopicStore(connection);
    const { container: c } = render(Panel, { store, spec: SPEC, widget: planBoard, link, send, invoke: (id, args) => registry.invoke(id, args) });
    const push = async (topic: string, value: unknown): Promise<void> => {
      for (const s of connection.subscribes().filter((x) => x.topic === topic)) connection.push({ type: 'snapshot', id: s.id, value });
      await tick();
    };
    await vi.waitFor(() => expect(connection.subscribes().some((s) => s.topic === 'plans.preview')).toBe(true));
    // the round: KUH's G1 prepared, the teammate nothing yet
    const open = round();
    await push('feed.status', { feedId: TEAMMATE_FEED, connected: true, stale: false, betweenSessions: false });
    await push('plans.prepared', { ...open, cars: { ...(open.open ? open.cars : {}), [TEAMMATE]: { raceNumber: KUH_NUMBER + 51, slots: {}, active: null } } });
    await push('plans.preview', preview());
    await vi.waitFor(() => expect(c.querySelector('[data-testid^="to-slot-"]')).not.toBeNull());

    // `→ slot` on a DP line, then G2
    await fireEvent.click(c.querySelector<HTMLElement>('[data-testid^="to-slot-"]')!);
    await fireEvent.click(testid(c, 'pick-G2')!);
    await tick();

    const saves = sent.filter((a) => a.kind === 'plans.prepare.save');
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ kind: 'plans.prepare.save', feedId: TEAMMATE_FEED, carId: TEAMMATE, slot: 'G2' });
    await vi.waitFor(() => {
      const warned = [...c.querySelectorAll('[data-role="warning"]')];
      expect(warned.some((e) => (e.getAttribute('title') ?? '').includes(MESSAGE) || (e.textContent ?? '').includes(MESSAGE))).toBe(true);
    });
  });
});
