import { createSocket } from 'node:dgram';
import type { FeedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { RawPacket } from '../../src/input/packet-source.ts';
import { UdpSource } from '../../src/input/udp-source.ts';

const FEED = 'feed-udp' as FeedId;

describe('UdpSource', () => {
  it('binds an ephemeral port and delivers datagrams with the injected clock', async () => {
    const src = new UdpSource({ feedId: FEED, port: 0, host: '127.0.0.1', clock: () => 1234 });
    expect(src.boundPort).toBeUndefined();
    const received = new Promise<RawPacket>((resolve) => src.start(resolve));
    await src.listening;
    expect(src.boundPort).toBeGreaterThan(0);
    const client = createSocket('udp4');
    client.send(Uint8Array.from([1, 2, 3]), src.boundPort!, '127.0.0.1');
    const p = await received;
    expect(p.feedId).toBe(FEED);
    expect(p.receivedAtMs).toBe(1234);
    expect(p.bytes).toBeInstanceOf(Uint8Array);
    expect([...p.bytes]).toEqual([1, 2, 3]);
    client.close();
    await src.stop();
    await expect(src.done).resolves.toBeUndefined();
  });
  it('rejects listening and done with EADDRINUSE when the port is busy', async () => {
    const a = new UdpSource({ feedId: FEED, port: 0, host: '127.0.0.1' });
    a.start(() => {});
    await a.listening;
    const b = new UdpSource({ feedId: FEED, port: a.boundPort!, host: '127.0.0.1' });
    b.start(() => {});
    await expect(b.listening).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await expect(b.done).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await a.stop();
  });
});

describe('UdpSource lifecycle', () => {
  it('start after stop throws and binds nothing', async () => {
    const src = new UdpSource({ feedId: FEED, port: 0, host: '127.0.0.1' });
    await src.stop();
    expect(() => src.start(() => {})).toThrow();
    await expect(src.done).resolves.toBeUndefined();
    await expect(src.listening).rejects.toThrow(/before it was listening/);
    expect(src.boundPort).toBeUndefined();
  });
  it('start twice throws', async () => {
    const src = new UdpSource({ feedId: FEED, port: 0, host: '127.0.0.1' });
    src.start(() => {});
    await src.listening;
    expect(() => src.start(() => {})).toThrow();
    await src.stop();
  });
});
