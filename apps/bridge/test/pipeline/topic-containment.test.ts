// A feature binding that throws is contained: the other topics of the frame still go out, and a `select` the hub only
// evaluates later (throttled, on tick) never throws out of the hub. Also: drivers stored after a buffer-cap start.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import type { CarDynamics, FeedId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { PacketId } from '@pitwall/protocol';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { bindState, defineFeature, type Feature } from '../../src/features/feature.ts';
import history from '../../src/features/history/register.ts';
import sessionInfo from '../../src/features/session-info/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';

const F = 'test' as FeedId;
const prepared = (b: ScenarioBuilder): PreparedPacket[] =>
  b.packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
const scenario = () => prepared(new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(5, () => {})
  .event({ code: 'FTLP', vehicleIdx: 0, lapTime: 80 }).frames(5, () => {}));

/** `car.telemetry` from a calculator that runs every frame, through `select`. */
const telemetryCalc: QuickCalculator<number> = { kind: 'quick', id: 'telemetry-select', reads: ['timing'], cadence: 'frame', compute: () => 1 };
const telemetryFeature = (select: () => CarDynamics | undefined): Feature => defineFeature({
  name: 'telemetry-select',
  calculators: [telemetryCalc],
  topics: [bindState('car.telemetry', telemetryCalc, select)],
});

async function replay(o: { features: Feature[]; now: () => number; packets?: PreparedPacket[]; storage?: object }) {
  const hub = new TopicHub({ now: o.now });
  const sent: ServerMessage[] = []; const logs: Array<Record<string, unknown>> = [];
  hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
  for (const [topic, params] of [['session.info', {}], ['events', {}], ['car.telemetry', { carId: 0 }]] as const) {
    hub.subscribe({ clientId: 'c', id: topic, topic, params, feedId: F });
  }
  const log = createLogger({ level: 'debug', destination: new Writable({ write(c, _e, cb) { logs.push(JSON.parse(String(c))); cb(); } }) });
  const pipeline = new FeedPipeline({ feedId: F, source: new ArraySource(F, o.packets ?? scenario()), hub, features: o.features, log,
    ...(o.storage ? { storage: o.storage as never } : {}) });
  pipeline.start(); await pipeline.done;
  const of = (id: string) => sent.filter((m) => 'id' in m && m.id === id);
  return { hub, of, logs };
}

describe('FeedPipeline: a throwing select', () => {
  it('on an unthrottled topic: the other topics and the history of the same frame still go out', async () => {
    let t = 0;
    const boom = telemetryFeature(() => { throw new Error('select failed'); });
    const r = await replay({ features: [sessionInfo, history, boom], now: () => (t += 1000) });
    expect(r.of('events').flatMap((m) => ('entries' in m ? m.entries ?? [] : []))).toMatchObject([{ kind: 'fastestLap' }]);
    expect(r.of('session.info').some((m) => m.type === 'update')).toBe(true);
    expect(r.of('car.telemetry').at(-1)).toEqual({ type: 'topicStatus', id: 'car.telemetry', status: 'errored' });
    expect(r.logs.some((l) => l['level'] === 50 && l['topic'] === 'car.telemetry' && JSON.stringify(l).includes('select failed'))).toBe(true);
  });

  it('on a throttled topic: hub.tick() does not throw, the topic is marked errored and logged once', async () => {
    let now = 0; let calls = 0;
    // The first value goes out at once; every later one is throttled (the clock stands still) and selected on tick.
    const flaky = telemetryFeature(() => {
      if (++calls > 1) throw new Error('select failed later');
      return { speedKmh: 1 } as unknown as CarDynamics;
    });
    const r = await replay({ features: [sessionInfo, flaky], now: () => now });
    expect(r.of('car.telemetry').filter((m) => m.type === 'update')).toHaveLength(1);
    now = 1000;
    expect(() => r.hub.tick()).not.toThrow();
    expect(r.of('car.telemetry').at(-1)).toEqual({ type: 'topicStatus', id: 'car.telemetry', status: 'errored' });
    now = 2000;
    expect(() => r.hub.tick()).not.toThrow();
    const logged = r.logs.filter((l) => l['level'] === 50 && l['topic'] === 'car.telemetry');
    expect(logged).toHaveLength(1); expect(JSON.stringify(logged[0])).toContain('select failed later');
  });
});

describe('FeedPipeline: a session started by the buffer cap', () => {
  it('stores its drivers once Participants arrives', async () => {
    const all = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().frames(610, () => {}).participants().frames(5, () => {}).packets();
    const first = all.findIndex((p) => p.packet.header.packetId === PacketId.participants);
    const packets = all.filter((_, i) => i !== first).map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'cap-')), 'cap.db'));
    let t = 0;
    await replay({ features: FEATURES, now: () => (t += 1000), packets, storage: { db } });
    const [row] = new WeekendRepository(db).sessionsOf('0');
    expect(row!.drivers.map((d) => d.carId)).toEqual([0, 1]);
  });
});
