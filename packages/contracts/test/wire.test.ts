import { describe, expect, it } from 'vitest';
import { decodeClientMessage, decodeServerMessage, encodeMessage, type ClientMessage, type ServerMessage } from '../src/index.ts';

const clients: ClientMessage[] = [
  { type: 'subscribe', id: 's1', topic: 'car.detail', params: { carId: 3 } },
  { type: 'subscribe', id: 's2', topic: 'laps', params: {}, feedId: 'udp-20777' as never },
  { type: 'unsubscribe', id: 's1' },
  { type: 'command', id: 'c1', command: { kind: 'boxCall', tyre: 'soft' as never } },
  { type: 'heartbeat' },
];
const servers: ServerMessage[] = [
  { type: 'hello', contractVersion: 3, feeds: [{ feedId: 'udp-20777' as never, kind: 'udp', label: 'UDP 20777' }] },
  { type: 'snapshot', id: 's1', value: { sessionUid: '1896528710553860228' } },
  { type: 'snapshot', id: 's2', entries: [] },
  { type: 'update', id: 's1', value: 1 },
  { type: 'append', id: 's2', entries: [{ lapNumber: 1 }] },
  { type: 'topicStatus', id: 's1', status: 'noData' },
  { type: 'commandResult', id: 'c1', ok: false, reason: 'notSupported' },
  { type: 'heartbeat' },
  { type: 'error', reason: 'malformed' },
  { type: 'error', id: 's9', reason: 'unknownFeed' },
];

describe('wire format', () => {
  it.each(clients)('client round trip %o', (m) => { expect(decodeClientMessage(encodeMessage(m))).toEqual(m); });
  it.each(servers)('server round trip %o', (m) => { expect(decodeServerMessage(encodeMessage(m))).toEqual(m); });
  it.each([
    'not json', '42', 'null', '[]', '{}', '{"type":"dance"}',
    '{"type":"subscribe","topic":"laps","params":{}}',                  // missing id
    '{"type":"subscribe","id":"s","topic":"nope","params":{}}',         // unknown topic
    '{"type":"subscribe","id":"s","topic":"laps","params":null}',
    '{"type":"subscribe","id":"s","topic":"laps","params":[]}',
    '{"type":"subscribe","id":"s","topic":"laps","params":{},"feedId":7}',
    '{"type":"unsubscribe","id":5}',
    '{"type":"command","id":"c","command":{"kind":"retire"}}',
    '{"type":"command","id":"c","command":{"kind":"boxCall","tyre":"purple"}}',
    '{"type":"hello","contractVersion":1,"feeds":[]}',                   // server message is not a client message
  ])('rejects malformed client message %s', (s) => { expect(decodeClientMessage(s)).toBeUndefined(); });
  it('drops unknown extra fields', () => {
    expect(decodeClientMessage('{"type":"unsubscribe","id":"s1","x":1}')).toEqual({ type: 'unsubscribe', id: 's1' });
  });
  it.each(['nope', '{"type":"update"}', '{"type":"topicStatus","id":"s","status":"weird"}', '{"type":"hello","feeds":[]}'])(
    'rejects malformed server message %s', (s) => { expect(decodeServerMessage(s)).toBeUndefined(); });
  it('wire DTOs carry sessionUid as a decimal string', () => {
    expect(JSON.parse(encodeMessage(servers[1]!))).toEqual({ type: 'snapshot', id: 's1', value: { sessionUid: '1896528710553860228' } });
  });
});
