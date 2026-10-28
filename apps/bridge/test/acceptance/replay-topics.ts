// Real pipeline, in-memory client; last value per state topic, all entries per append topic, error-level log lines.
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';

export async function replayTopics(path: string, subs: ReadonlyArray<readonly [id: string, topic: TopicName, params: object]>) {
  const F = feedId('acceptance');
  let now = 0;
  const hub = new TopicHub({ now: () => (now += 1000) }); // every publish is due: nothing is throttled away
  const values = new Map<string, unknown>(), lists = new Map<string, unknown[]>(), errored: string[] = [];
  const send = (m: ServerMessage) => {
    if (m.type === 'snapshot') { if (m.entries) lists.set(m.id, [...m.entries]); else values.set(m.id, m.value); }
    else if (m.type === 'update') values.set(m.id, m.value);
    else if (m.type === 'append') { const l = lists.get(m.id) ?? []; for (const e of m.entries) l.push(e); lists.set(m.id, l); }
    else if (m.type === 'topicStatus' && m.status === 'errored') errored.push(m.id);
  };
  hub.addClient('acceptance', { send, bufferedAmount: () => 0 });
  for (const [id, topic, params] of subs) hub.subscribe({ clientId: 'acceptance', id, topic, params, feedId: F });
  const logs: string[] = []; // the pipeline logs bugs instead of throwing them: error-level lines are failures
  const log = createLogger({ level: 'warn', destination: { write: (line: string) => logs.push(line) } });
  const pipeline = new FeedPipeline({ feedId: F, source: new PwrecSource({ feedId: F, path, mode: 'asFastAsPossible' }), hub, features: FEATURES, log });
  pipeline.start();
  await pipeline.done;
  hub.tick();
  const errors = logs.filter((l) => (JSON.parse(l) as { level: number }).level >= 50);
  return { value: (id: string) => values.get(id), entries: (id: string) => lists.get(id) ?? [], errored, errors };
}
