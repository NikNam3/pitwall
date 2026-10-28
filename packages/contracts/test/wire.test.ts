import { describe, expect, it } from 'vitest';
import { decodeClientMessage, decodeServerMessage, encodeMessage, type ClientMessage, type ServerMessage, type UiAction } from '../src/index.ts';

const clients: ClientMessage[] = [
  { type: 'subscribe', id: 's1', topic: 'car.detail', params: { carId: 3 } },
  { type: 'subscribe', id: 's2', topic: 'laps', params: {}, feedId: 'udp-20777' as never },
  { type: 'unsubscribe', id: 's1' },
  { type: 'command', id: 'c1', command: { kind: 'boxCall', tyre: 'soft' as never } },
  { type: 'heartbeat' },
];
const servers: ServerMessage[] = [
  { type: 'hello', contractVersion: 4, feeds: [{ feedId: 'udp-20777' as never, kind: 'udp', label: 'UDP 20777' }] },
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

const win = { id: 'w1', geometry: { screen: 1, x: 0, y: 0, width: 800, height: 600 }, fontPx: 14, layout: { any: [1] }, panels: { p: { widget: 'laps', options: { a: 1 }, linkGroup: 2 } } };
const group = { id: 2, feedId: 'udp-20777' as never, primary: 'player' as const, compare: ['teammate' as const, 4 as never], window: { kind: 'range' as const, from: 10, to: 20 } };
const uiActions: UiAction[] = [
  { kind: 'workbook.open', name: 'race' },
  { kind: 'workbook.saveAs', name: 'quali' },
  { kind: 'workbook.updateWindow', window: win },
  { kind: 'workbook.updateWindow', window: { id: 'w2', layout: null, panels: {} } },
  { kind: 'linkGroup.set', group },
  { kind: 'linkGroup.set', group: { id: 1, primary: 3 as never, compare: [], window: { kind: 'live' } } },
  { kind: 'linkGroup.set', group: { id: 3, primary: 'teammate', compare: [], window: { kind: 'lap', lap: 7 } } },
  { kind: 'alert.ack', key: 'k' },
  { kind: 'alert.ackAll', keys: ['a', 'b'] },
  { kind: 'alertGroup.mute', category: 'tyres', muted: true },
  { kind: 'realism.set', enabled: false },
];
const uiClients: ClientMessage[] = uiActions.map((action, i) => ({ type: 'uiAction', id: `u${i}`, action }));
const uiServers: ServerMessage[] = [
  { type: 'actionResult', id: 'u1', ok: true },
  { type: 'actionResult', id: 'u2', ok: false, reason: 'invalid' },
  { type: 'actionResult', id: 'u3', ok: false, reason: 'notSupported' },
];
const ua = (action: unknown) => JSON.stringify({ type: 'uiAction', id: 'u', action });

describe('wire format: uiAction and actionResult', () => {
  it.each(uiClients)('uiAction round trip %o', (m) => { expect(decodeClientMessage(encodeMessage(m))).toEqual(m); });
  it.each(uiServers)('actionResult round trip %o', (m) => { expect(decodeServerMessage(encodeMessage(m))).toEqual(m); });
  it.each([
    ['unknown kind', ua({ kind: 'workbook.delete', name: 'x' })],
    ['no kind', ua({ name: 'x' })],
    ['action not an object', ua('workbook.open')],
    ['missing action', JSON.stringify({ type: 'uiAction', id: 'u' })],
    ['missing id', JSON.stringify({ type: 'uiAction', action: { kind: 'alert.ack', key: 'k' } })],
    ['open without name', ua({ kind: 'workbook.open' })],
    ['saveAs with numeric name', ua({ kind: 'workbook.saveAs', name: 5 })],
    ['updateWindow without window', ua({ kind: 'workbook.updateWindow' })],
    ['updateWindow without id', ua({ kind: 'workbook.updateWindow', window: { layout: {}, panels: {} } })],
    ['updateWindow without panels', ua({ kind: 'workbook.updateWindow', window: { id: 'w', layout: {} } })],
    ['panel options not an object', ua({ kind: 'workbook.updateWindow', window: { id: 'w', layout: {}, panels: { p: { widget: 'x', options: 'no', linkGroup: 1 } } } })],
    ['panel options an array', ua({ kind: 'workbook.updateWindow', window: { id: 'w', layout: {}, panels: { p: { widget: 'x', options: [], linkGroup: 1 } } } })],
    ['panel options null', ua({ kind: 'workbook.updateWindow', window: { id: 'w', layout: {}, panels: { p: { widget: 'x', options: null, linkGroup: 1 } } } })],
    ['panel without widget', ua({ kind: 'workbook.updateWindow', window: { id: 'w', layout: {}, panels: { p: { options: {}, linkGroup: 1 } } } })],
    ['panel without linkGroup', ua({ kind: 'workbook.updateWindow', window: { id: 'w', layout: {}, panels: { p: { widget: 'x', options: {} } } } })],
    ['linkGroup.set without group', ua({ kind: 'linkGroup.set' })],
    ['group without primary', ua({ kind: 'linkGroup.set', group: { id: 1, compare: [], window: { kind: 'live' } } })],
    ['group with unknown window kind', ua({ kind: 'linkGroup.set', group: { id: 1, primary: 'player', compare: [], window: { kind: 'forever' } } })],
    ['group lap window without lap', ua({ kind: 'linkGroup.set', group: { id: 1, primary: 'player', compare: [], window: { kind: 'lap' } } })],
    ['group compare not a list', ua({ kind: 'linkGroup.set', group: { id: 1, primary: 'player', compare: 'teammate', window: { kind: 'live' } } })],
    ['ack without key', ua({ kind: 'alert.ack' })],
    ['ackAll keys not strings', ua({ kind: 'alert.ackAll', keys: [1] })],
    ['mute unknown category', ua({ kind: 'alertGroup.mute', category: 'weather', muted: true })],
    ['mute muted not boolean', ua({ kind: 'alertGroup.mute', category: 'tyres', muted: 'yes' })],
    ['realism enabled not boolean', ua({ kind: 'realism.set', enabled: 1 })],
  ])('rejects uiAction: %s', (_n, s) => { expect(decodeClientMessage(s)).toBeUndefined(); });
  it('rebuilds uiAction from known fields only, at every level', () => {
    const noisy = ua({ kind: 'workbook.updateWindow', extra: 1, window: { ...win, junk: true, panels: { p: { ...win.panels.p, more: 1 } } } });
    expect(decodeClientMessage(noisy)).toEqual({ type: 'uiAction', id: 'u', action: { kind: 'workbook.updateWindow', window: win } });
    expect(decodeClientMessage(ua({ kind: 'alert.ack', key: 'k', x: 1 }))).toEqual({ type: 'uiAction', id: 'u', action: { kind: 'alert.ack', key: 'k' } });
  });
  it.each(['{"type":"actionResult","id":"u"}', '{"type":"actionResult","id":"u","ok":false}', '{"type":"actionResult","id":"u","ok":false,"reason":"weird"}', '{"type":"actionResult","ok":true}'])(
    'rejects malformed server message %s', (s) => { expect(decodeServerMessage(s)).toBeUndefined(); });
});
