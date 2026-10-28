import { CONTRACT_VERSION, type ServerMessage } from '@pitwall/contracts';
import { addLaps, carId, emptyCurrentLaps, feedId, unknown, type LapRecord } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import { lapsFold } from '../../src/kit/folds.ts';
import { FakeConnection } from './fake-connection.ts';

const FEED = feedId('f1');
const lap = (car: number, lapNumber: number, status: LapRecord['status'], lapTimeMs = 70_000): LapRecord => ({
  carId: carId(car),
  lapNumber,
  lapTimeMs,
  sectorTimesMs: [20_000, 25_000, lapTimeMs - 45_000],
  valid: { lap: true, sectors: [true, true, true] },
  actualCompound: 'C4',
  visualCompound: 'soft',
  tyreAgeAtStart: 0,
  fuelAtStartKg: unknown('notReceived'),
  fuelAtEndKg: unknown('notReceived'),
  scShare: 0,
  vscShare: 0,
  inLap: false,
  outLap: false,
  positionAtEnd: 1,
  status,
  completedAt: lapNumber * 70_000,
});

const setup = () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  return { connection, store };
};
const json = (v: unknown) => JSON.stringify(v);
const overview = (n: number) => ({ n }) as never;

describe('TopicStore subscriptions', () => {
  it('two acquires of equal keys send one subscribe, with id s1', () => {
    const { connection, store } = setup();
    store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    expect(connection.subscribes()).toEqual([{ type: 'subscribe', id: 's1', topic: 'laps', params: {}, feedId: FEED }]);
  });

  it('params are compared by canonical JSON: key order does not matter', () => {
    const { connection, store } = setup();
    store.acquire({ topic: 'car.detail', params: { carId: carId(3), x: 1 } as never, feedId: FEED });
    store.acquire({ topic: 'car.detail', params: { x: 1, carId: carId(3) } as never, feedId: FEED });
    expect(connection.subscribes()).toHaveLength(1);
  });

  it('different params, topics or feeds are different subscriptions with ids s1, s2, s3', () => {
    const { connection, store } = setup();
    store.acquire({ topic: 'car.detail', params: { carId: carId(1) }, feedId: FEED });
    store.acquire({ topic: 'car.detail', params: { carId: carId(2) }, feedId: FEED });
    store.acquire({ topic: 'laps', params: {}, feedId: feedId('f2') });
    expect(connection.subscribes().map((m) => m.id)).toEqual(['s1', 's2', 's3']);
    expect(connection.subscribes()[2]?.feedId).toBe('f2');
  });

  it('releasing one of two holders keeps the subscription; releasing both sends one unsubscribe', () => {
    const { connection, store } = setup();
    const a = store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    const b = store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    a.release();
    expect(connection.unsubscribes()).toEqual([]);
    b.release();
    expect(connection.unsubscribes()).toEqual([{ type: 'unsubscribe', id: 's1' }]);
  });

  it('a key acquired again after full release subscribes under a new id', () => {
    const { connection, store } = setup();
    store.acquire({ topic: 'laps', params: {}, feedId: FEED }).release();
    store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    expect(connection.subscribes().map((m) => m.id)).toEqual(['s1', 's2']);
  });

  it('send passes a client message to the connection', () => {
    const { connection, store } = setup();
    store.send({ type: 'heartbeat' });
    expect(connection.sent).toEqual([{ type: 'heartbeat' }]);
  });
});

describe('TopicStore values', () => {
  it('starts waiting with no value, then a snapshot makes it ok', () => {
    const { connection, store } = setup();
    const h = store.acquire({ topic: 'cars.overview', params: {}, feedId: FEED });
    expect(h.state).toEqual({ status: 'waiting', value: undefined });
    connection.push({ type: 'snapshot', id: 's1', value: [overview(1)] });
    expect(h.state.status).toBe('ok');
    expect(json(h.state.value)).toBe(json([overview(1)]));
  });

  it('an update replaces state.value; both holders of a shared key see it', () => {
    const { connection, store } = setup();
    const a = store.acquire({ topic: 'cars.overview', params: {}, feedId: FEED });
    const b = store.acquire({ topic: 'cars.overview', params: {}, feedId: FEED });
    connection.push({ type: 'snapshot', id: 's1', value: [overview(1)] });
    connection.push({ type: 'update', id: 's1', value: [overview(2)] });
    expect(json(a.state.value)).toBe(json([overview(2)]));
    expect(json(b.state.value)).toBe(json([overview(2)]));
  });

  it('messages for another id do not touch this entry', () => {
    const { connection, store } = setup();
    const a = store.acquire({ topic: 'cars.overview', params: {}, feedId: FEED });
    connection.push({ type: 'snapshot', id: 's99', value: [overview(1)] });
    expect(a.state.status).toBe('waiting');
  });

  it('topicStatus noData and errored set the status', () => {
    const { connection, store } = setup();
    const h = store.acquire({ topic: 'cars.overview', params: {}, feedId: FEED });
    connection.push({ type: 'topicStatus', id: 's1', status: 'noData' });
    expect(h.state.status).toBe('noData');
    connection.push({ type: 'topicStatus', id: 's1', status: 'errored' });
    expect(h.state.status).toBe('errored');
    connection.push({ type: 'snapshot', id: 's1', value: [] });
    expect(h.state.status).toBe('ok');
  });

  it('an append topic without a fold keeps the entries it received', () => {
    const { connection, store } = setup();
    const h = store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    connection.push({ type: 'snapshot', id: 's1', entries: [lap(0, 1, 'confirmed')] });
    connection.push({ type: 'append', id: 's1', entries: [lap(0, 2, 'confirmed')] });
    // Without a fold the value is the entries array, but the default V = TopicValue<'laps'> is one record
    // (topic mode is not a literal type), so the cast goes through unknown.
    expect((h.state.value as unknown as LapRecord[]).map((l) => l.lapNumber)).toEqual([1, 2]);
  });

  it('an append folds into the result of the fold', () => {
    const { connection, store } = setup();
    const h = store.acquire({ topic: 'laps', params: {}, feedId: FEED }, lapsFold);
    connection.push({ type: 'snapshot', id: 's1', entries: [] });
    connection.push({ type: 'append', id: 's1', entries: [lap(0, 1, 'provisional', 70_100)] });
    connection.push({ type: 'append', id: 's1', entries: [lap(0, 1, 'confirmed', 70_000), lap(1, 1, 'provisional')] });
    connection.push({ type: 'append', id: 's1', entries: [lap(0, 1, 'provisional', 99_999)] });
    expect(h.state.value?.[0]?.[1]).toMatchObject({ status: 'confirmed', lapTimeMs: 70_000 });
    expect(h.state.value?.[1]?.[1]).toMatchObject({ status: 'provisional' });
  });

  it('a snapshot after appends equals a fresh fold of the snapshot entries', () => {
    const { connection, store } = setup();
    const h = store.acquire({ topic: 'laps', params: {}, feedId: FEED }, lapsFold);
    connection.push({ type: 'snapshot', id: 's1', entries: [lap(0, 1, 'confirmed'), lap(0, 2, 'confirmed')] });
    connection.push({ type: 'append', id: 's1', entries: [lap(0, 3, 'confirmed'), lap(5, 1, 'confirmed')] });
    const fresh = [lap(2, 1, 'confirmed')];
    connection.push({ type: 'snapshot', id: 's1', entries: fresh });
    expect(json(h.state.value)).toBe(json(addLaps(emptyCurrentLaps(), fresh)));
  });
});

describe('TopicStore contract and reconnect', () => {
  const hello = (contractVersion: number): ServerMessage => ({ type: 'hello', contractVersion, feeds: [] });

  it('a matching hello leaves contractMismatch false; a mismatching one sets it', () => {
    const { connection, store } = setup();
    expect(store.contractMismatch).toBe(false);
    connection.push(hello(CONTRACT_VERSION));
    expect(store.contractMismatch).toBe(false);
    connection.push(hello(CONTRACT_VERSION + 1));
    expect(store.contractMismatch).toBe(true);
  });

  it('the store exposes the connection state', () => {
    const { connection, store } = setup();
    expect(store.connection).toBe('open');
    connection.close();
    expect(store.connection).toBe('closed');
    connection.reopen();
    expect(store.connection).toBe('open');
  });

  it('after a reconnect every live key is subscribed once more under a new id, not the released ones', () => {
    const { connection, store } = setup();
    store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    store.acquire({ topic: 'cars.overview', params: {}, feedId: FEED });
    store.acquire({ topic: 'car.detail', params: { carId: carId(1) }, feedId: FEED }).release();
    const before = connection.subscribes().length;
    connection.close();
    expect(connection.subscribes()).toHaveLength(before);
    connection.reopen();
    const again = connection.subscribes().slice(before);
    expect(again.map((m) => m.topic).sort()).toEqual(['cars.overview', 'laps']);
    expect(new Set(again.map((m) => m.id)).size).toBe(2);
    const used = connection.subscribes().slice(0, before).map((m) => m.id);
    for (const m of again) expect(used).not.toContain(m.id);
  });

  it('a snapshot after reconnect replaces the state, including the fold state', () => {
    const { connection, store } = setup();
    const h = store.acquire({ topic: 'laps', params: {}, feedId: FEED }, lapsFold);
    connection.push({ type: 'snapshot', id: 's1', entries: [lap(0, 1, 'confirmed')] });
    connection.close();
    connection.reopen();
    const id = connection.subscribes().at(-1)?.id as string;
    expect(id).not.toBe('s1');
    connection.push({ type: 'snapshot', id, entries: [lap(3, 1, 'confirmed')] });
    connection.push({ type: 'append', id, entries: [lap(3, 2, 'confirmed')] });
    expect(json(h.state.value)).toBe(json(addLaps(emptyCurrentLaps(), [lap(3, 1, 'confirmed'), lap(3, 2, 'confirmed')])));
    expect(h.state.value?.[0]).toBeUndefined();
  });

  it('release after a reconnect unsubscribes the new id', () => {
    const { connection, store } = setup();
    const h = store.acquire({ topic: 'laps', params: {}, feedId: FEED });
    connection.close();
    connection.reopen();
    const id = connection.subscribes().at(-1)?.id;
    h.release();
    expect(connection.unsubscribes().at(-1)).toEqual({ type: 'unsubscribe', id });
  });
});

describe('TopicStore session clock', () => {
  it('now is undefined until session.info arrives, then follows session.updatedAt per feed', () => {
    const { connection, store } = setup();
    expect(store.now(FEED)).toBeUndefined();
    store.acquire({ topic: 'session.info', params: {}, feedId: FEED });
    expect(store.now(FEED)).toBeUndefined();
    connection.push({ type: 'snapshot', id: 's1', value: { feedId: FEED, session: { updatedAt: 1_000 } } });
    expect(store.now(FEED)).toBe(1_000);
    connection.push({ type: 'update', id: 's1', value: { feedId: FEED, session: { updatedAt: 2_500 } } });
    expect(store.now(FEED)).toBe(2_500);
    expect(store.now(feedId('other'))).toBeUndefined();
  });
});

describe('TopicStore properties', () => {
  const lapArb = fc
    .record({
      car: fc.integer({ min: 0, max: 3 }),
      n: fc.integer({ min: 1, max: 5 }),
      status: fc.constantFrom('provisional', 'confirmed' as const),
      t: fc.integer({ min: 60_000, max: 90_000 }),
    })
    .map((r) => lap(r.car, r.n, r.status as LapRecord['status'], r.t));

  it('for any provisional and confirmed laps split into any append batches, the fold equals addLaps over all', () => {
    fc.assert(
      fc.property(fc.array(fc.array(lapArb, { maxLength: 6 }), { maxLength: 8 }), (batches) => {
        const { connection, store } = setup();
        const h = store.acquire({ topic: 'laps', params: {}, feedId: FEED }, lapsFold);
        connection.push({ type: 'snapshot', id: 's1', entries: [] });
        for (const entries of batches) connection.push({ type: 'append', id: 's1', entries });
        expect(json(h.state.value)).toBe(json(addLaps(emptyCurrentLaps(), batches.flat())));
      }),
    );
  });

  type Op =
    | { kind: 'snapshotLaps'; laps: LapRecord[] }
    | { kind: 'appendLaps'; laps: LapRecord[] }
    | { kind: 'snapshotCars'; n: number }
    | { kind: 'updateCars'; n: number };
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('snapshotLaps' as const), laps: fc.array(lapArb, { maxLength: 4 }) }),
    fc.record({ kind: fc.constant('appendLaps' as const), laps: fc.array(lapArb, { maxLength: 4 }) }),
    fc.record({ kind: fc.constant('snapshotCars' as const), n: fc.nat(9) }),
    fc.record({ kind: fc.constant('updateCars' as const), n: fc.nat(9) }),
  );

  const subscribeBoth = (store: TopicStore) => ({
    laps: store.acquire({ topic: 'laps', params: {}, feedId: FEED }, lapsFold),
    cars: store.acquire({ topic: 'cars.overview', params: {}, feedId: FEED }),
  });

  it('after any messages, a disconnect, a reconnect and fresh snapshots, the store equals one that saw only the snapshots', () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { maxLength: 12 }),
        fc.array(lapArb, { maxLength: 6 }),
        fc.nat(9),
        (ops, freshLaps, freshCars) => {
          const a = setup();
          const ha = subscribeBoth(a.store);
          for (const op of ops) {
            if (op.kind === 'snapshotLaps') a.connection.push({ type: 'snapshot', id: 's1', entries: op.laps });
            else if (op.kind === 'appendLaps') a.connection.push({ type: 'append', id: 's1', entries: op.laps });
            else if (op.kind === 'snapshotCars') a.connection.push({ type: 'snapshot', id: 's2', value: [overview(op.n)] });
            else a.connection.push({ type: 'update', id: 's2', value: [overview(op.n)] });
          }
          a.connection.close();
          a.connection.reopen();
          const resub = a.connection.subscribes().slice(2);
          expect(resub).toHaveLength(2);
          const idOf = (topic: string) => resub.find((m) => m.topic === topic)?.id as string;
          a.connection.push({ type: 'snapshot', id: idOf('laps'), entries: freshLaps });
          a.connection.push({ type: 'snapshot', id: idOf('cars.overview'), value: [overview(freshCars)] });

          const b = setup();
          const hb = subscribeBoth(b.store);
          b.connection.push({ type: 'snapshot', id: 's1', entries: freshLaps });
          b.connection.push({ type: 'snapshot', id: 's2', value: [overview(freshCars)] });

          expect(a.store.connection).toBe('open');
          expect(json(ha.laps.state)).toBe(json(hb.laps.state));
          expect(json(ha.cars.state)).toBe(json(hb.cars.state));
        },
      ),
    );
  });
});
