// Test harness for ReplayController: a real pipeline and hub, and a fake sleep the test releases by hand.
// ASSUMED injection point: `new ReplayController({ path, feedId, makePipeline, hub, sleep })`, where the optional
// `sleep(ms, signal)` has the semantics of `PwrecSourceOptions.sleep` and is what the controller's pacer waits with
// (`gap / speed` ms while playing). Also assumed: `controller.stop(): Promise<void>` (stops the source and pipeline).
import type { ReplayStatus, ServerMessage, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ReplayController } from '../../src/replay/replay-controller.ts';

export const FEED = 'replay' as FeedId;

/** A sleep that resolves only when the test releases it (or when its signal aborts). Records every requested duration. */
export function fakeSleep() {
  const requested: number[] = [];
  let pending: Array<() => void> = [];
  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      requested.push(ms);
      pending.push(resolve);
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  const releaseAll = (): void => { const now = pending; pending = []; for (const r of now) r(); };
  return { sleep, requested, releaseAll };
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function until(cond: () => boolean, onTick: () => void = () => {}, timeoutMs = 60_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('until: timeout');
    onTick();
    await tick();
  }
}

export function harness(path: string) {
  let clock = 0;
  let pipeline: FeedPipeline | undefined;
  const hub = new TopicHub({ now: () => (clock += 10_000), onDemandChange: () => pipeline?.demandChanged() });
  const gate = fakeSleep();
  const controller = new ReplayController({
    path,
    feedId: FEED,
    hub,
    sleep: gate.sleep,
    makePipeline: (source) => (pipeline = new FeedPipeline({ feedId: FEED, source, hub, features: FEATURES, log: createLogger({ level: 'silent' }) })),
  } as ConstructorParameters<typeof ReplayController>[0] & { sleep: typeof gate.sleep });
  let n = 0;
  /** The topic's current value, as a fresh subscriber sees it (`undefined` when there is none). */
  const read = <T = unknown>(topic: TopicName): T | undefined => {
    const clientId = `reader-${++n}`;
    const got: ServerMessage[] = [];
    hub.addClient(clientId, { send: (m) => got.push(m), bufferedAmount: () => 0 });
    hub.subscribe({ clientId, id: 'x', topic, params: {}, feedId: FEED });
    hub.tick();
    hub.unsubscribe(clientId, 'x');
    hub.removeClient(clientId);
    const last = got.filter((m) => m.type === 'snapshot' || m.type === 'update').at(-1);
    return last !== undefined && 'value' in last ? (last.value as T) : undefined;
  };
  const status = (): ReplayStatus | undefined => read<ReplayStatus>('replay.status');
  /** Releases the pending sleeps round after round until `cond` holds. */
  const pumpUntil = (cond: () => boolean) => until(cond, gate.releaseAll);
  const pump = async (rounds: number): Promise<void> => { for (let i = 0; i < rounds; i++) { gate.releaseAll(); await tick(); } };
  return { hub, controller, gate, read, status, pumpUntil, pump, stop: () => controller.stop() };
}
