// `bindSituation` (C55): a core topic of a sub-machine's spans (C54), open and closed, as they are. The open ones come
// from the view's situation (C20), the closed ones from the projection (C28). Checked twice: `pnpm typecheck` compiles
// this file, so the `@ts-expect-error` lines are the compiler tests; vitest runs the same calls and a pipeline.
//
// The topic `session.clock` (core, state, value `{ open: OpenSpan[]; closed: Span[] }`) is the one this task adds for
// the binding (brief ruling 5): the clock's spans, every session has them.
import { Writable } from 'node:stream';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ServerMessage, TopicValue } from '@pitwall/contracts';
import type { FeedId, OpenSpan, Span } from '@pitwall/domain';
import { situationOf } from '@pitwall/engine';
import { packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { gridStart, run, script, scriptPackets, type Beat } from '../../../../packages/engine/test/situations/script.ts';
import { bindHistory, bindSituation, defineFeature, type TopicBinding } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ArraySource } from '../helpers/array-source.ts';

const A = 'feed-a' as FeedId;
const silent = createLogger({ level: 'silent', destination: new Writable({ write: (_c, _e, cb) => cb() }) });

/** An online race the game pauses from race frame 50 to race frame 100: the clock runs, pauses, runs again (C7). */
const PAUSED: readonly Beat[] = gridStart(150, (k) => (k === 50 ? { session: { gamePaused: 1 } } : k === 100 ? { session: { gamePaused: 0 } } : {}));
const ONLINE = { session: { networkGame: 1 } } as const;

/** Runs PAUSED through a pipeline whose one feature binds `session.clock` to the clock's spans; a client subscribed throughout. */
async function published() {
  let now = 0;
  const hub = new TopicHub({ now: () => (now += 1000) });
  const inbox: Array<{ message: ServerMessage; asSent: ServerMessage }> = [];
  hub.addClient('c', { send: (message) => inbox.push({ message, asSent: structuredClone(message) }), bufferedAmount: () => 0 });
  hub.subscribe({ clientId: 'c', id: 'clock', topic: 'session.clock', params: {}, feedId: A });
  const packets = scriptPackets(PAUSED, ONLINE).map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
  const feature = defineFeature({ name: 'situation-probe', calculators: [], topics: [bindSituation('session.clock', 'clock')] });
  const pipeline = new FeedPipeline({ feedId: A, source: new ArraySource(A, packets), hub, features: [feature], log: silent });
  pipeline.start();
  await pipeline.done;
  const values = inbox.flatMap(({ message: m }) => ((m.type === 'snapshot' || m.type === 'update') && m.id === 'clock' && 'value' in m ? [m.value as TopicValue<'session.clock'>] : []));
  return { inbox, values };
}

const kinds = (value: TopicValue<'session.clock'>) => [value.open.map((s) => s.kind), value.closed.map((s) => s.kind)];

describe('bindSituation: the topic must carry a sub-machine\'s spans (C55)', () => {
  it('a topic whose value is a machine\'s open and closed spans compiles, and the binding names the topic and the machine', () => {
    expectTypeOf<TopicValue<'session.clock'>>().toEqualTypeOf<{ open: OpenSpan[]; closed: Span[] }>();
    const binding = bindSituation('session.clock', 'clock');
    expectTypeOf(binding).toEqualTypeOf<TopicBinding>();
    expect(binding).toEqual({ topic: 'session.clock', fromSituation: 'clock' });
    expect(bindSituation('session.clock', 'session-phase-race')).toEqual({ topic: 'session.clock', fromSituation: 'session-phase-race' });
  });

  it('a topic of another value does not compile', () => {
    // @ts-expect-error laps carries LapRecords, not a machine's spans
    const laps = bindSituation('laps', 'clock');
    // @ts-expect-error session.info carries SessionInfo
    const info = bindSituation('session.info', 'clock');
    // @ts-expect-error flagPhases carries the legacy flag phases, not spans
    const flags = bindSituation('flagPhases', 'session-phase-race');
    expect([laps, info, flags].map((b) => b.topic)).toEqual(['laps', 'session.info', 'flagPhases']);
  });

  it('Feature.topics accepts it beside the other helpers, but no hand-written situation binding', () => {
    const feature = defineFeature({ name: 'typed', calculators: [], topics: [bindSituation('session.clock', 'clock'), bindHistory('laps', 'laps')] });
    expect(feature.topics.map((t) => t.topic)).toEqual(['session.clock', 'laps']);
    const handWritten = defineFeature({
      name: 'hand-written-situation',
      calculators: [],
      // @ts-expect-error a binding must come from a helper
      topics: [{ topic: 'session.clock', fromSituation: 'clock' }],
    });
    expect(handWritten.topics).toHaveLength(1);
  });
});

describe('bindSituation publishes a machine\'s open and closed spans (C20, C54)', () => {
  it('a subscriber sees the clock\'s spans as they open and close: running, then paused, then running again', async () => {
    const { values } = await published();
    expect(values.length).toBeGreaterThan(0);
    const changes = values.map(kinds).filter((k, i, all) => i === 0 || JSON.stringify(k) !== JSON.stringify(all[i - 1]));
    expect(changes).toEqual([
      [['running'], []],
      [['paused'], ['running']],
      [['running'], ['running', 'paused']],
    ]);
  });

  it('after the last frame the value is the machine\'s open spans of the situation and its closed spans of the projection, as they are', async () => {
    const { values } = await published();
    const { runner } = run(script(PAUSED, ONLINE));
    expect(values).toContainEqual({ open: situationOf(runner.state).byMachine['clock'], closed: runner.state.history.spans['clock'] });
  });

  it('a value sent never changes afterwards, while the spans move on', async () => {
    const { inbox, values } = await published();
    expect(values.length).toBeGreaterThan(2);
    for (const { message, asSent } of inbox) expect(message).toEqual(asSent);
  });
});
