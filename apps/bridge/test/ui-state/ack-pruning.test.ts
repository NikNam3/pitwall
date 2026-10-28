// Wiring of acknowledgement pruning (A-I1, R1): a resolve prunes only the acknowledgement of the occurrence that ended
// (same feed, key and raisedAt); a replay re-run (resetFeed and the same sequence again) keeps acknowledgements of
// occurrences that are active again.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import { feedId, type Insight } from '@pitwall/domain';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { pruneEndedAcknowledgements } from '../../src/ui-state/ack-pruning.ts';
import { UiState } from '../../src/ui-state/ui-state.ts';

const FEED = feedId('replay');
const opened: UiState[] = [];
afterEach(() => { for (const s of opened.splice(0)) s.close(); });

const insight = (key: string, raisedAt: number): Insight =>
  ({ key, severity: 'critical', category: 'damage', feedId: FEED, kind: 'k', params: {}, raisedAt }) as Insight;

function setup() {
  const hub = new TopicHub({ now: () => 0 });
  const state = UiState.open(join(mkdtempSync(join(tmpdir(), 'ack-')), 'ui'), hub, createLogger({ level: 'silent' }));
  opened.push(state);
  let acknowledged: string[] = [];
  hub.addClient('ui', { send: (m: ServerMessage) => { if ((m.type === 'snapshot' || m.type === 'update') && 'value' in m) acknowledged = (m.value as { acknowledged: string[] }).acknowledged; }, bufferedAmount: () => 0 });
  hub.subscribe({ clientId: 'ui', id: 'alerts', topic: 'ui.alerts', params: {}, feedId: undefined });
  hub.tick();
  pruneEndedAcknowledgements(hub, [FEED], state);
  const publish = (...entries: unknown[]) => { hub.publishAppend(FEED, 'insights', entries); hub.tick(); };
  return { hub, state, publish, acked: () => { hub.tick(); return [...acknowledged]; } };
}
const raised = (key: string, at: number) => ({ type: 'raised', insight: insight(key, at) });
const resolved = (key: string, at = 99) => ({ type: 'resolved', key, at });

describe('pruneEndedAcknowledgements', () => {
  it('resolving another insight keeps the acknowledgement; resolving its own occurrence prunes it', () => {
    const { state, publish, acked } = setup();
    publish(raised('a', 10), raised('b', 20));
    state.apply({ kind: 'alert.ack', key: 'replay:b:20' });
    publish(resolved('a'));
    expect(acked()).toEqual(['replay:b:20']);
    publish(resolved('b'));
    expect(acked()).toEqual([]);
  });

  it('a replay re-run (resetFeed, same sequence again) keeps the acknowledgement while b is active again, and prunes it when b resolves', () => {
    const { hub, state, publish, acked } = setup();
    publish(raised('a', 10), raised('b', 20));
    state.apply({ kind: 'alert.ack', key: 'replay:b:20' });
    publish(resolved('a'));
    hub.resetFeed(FEED);
    hub.tick();
    publish(raised('a', 10), raised('b', 20));
    publish(resolved('a'));
    expect(acked()).toEqual(['replay:b:20']);
    publish(resolved('b'));
    expect(acked()).toEqual([]);
  });

  it('only the resolved occurrence goes: another occurrence of the same key stays acknowledged', () => {
    const { state, publish, acked } = setup();
    publish(raised('b', 20));
    state.apply({ kind: 'alert.ackAll', keys: ['replay:b:20', 'replay:b:5'] });
    publish(raised('c', 30), resolved('c'));
    expect(acked().sort()).toEqual(['replay:b:20']);
  });
});
