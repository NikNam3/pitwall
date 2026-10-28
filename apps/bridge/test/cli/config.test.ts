// The config in the CLI: `<data dir>/config.json` is validated at startup, each live session leaves
// `<session file>.config.json` next to its file, and `replay` and `reprocess` prefer the config next to a recording.
// No production feature declares config yet, so what the sidecars hold is an empty config; the observable part is
// that they exist, that they are read, and that a broken one stops the command.
import { createSocket } from 'node:dgram';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { runCli, SEGMENT, startCli } from '../helpers/cli.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-cli-config-'));
const BROKEN = JSON.stringify({ 'no.such.key': { threshold: 1 } });

/** A UDP port nobody listens on right now. */
async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

/** Sends the first `count` datagrams of the segment to `port`, a few at a time so the socket buffer keeps up. */
async function sendSegment(port: number, count: number): Promise<void> {
  const socket = createSocket('udp4');
  try {
    let sent = 0;
    for await (const record of readPwrec(SEGMENT)) {
      if (sent === count) break;
      await new Promise<void>((resolve, reject) => socket.send(record.payload, port, '127.0.0.1', (error) => (error ? reject(error) : resolve())));
      if (++sent % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    socket.close();
  }
}

/** A data dir holding a copy of the segment as a recording, plus the recordings directory. */
function withRecording() {
  const root = tmp();
  const { recordings } = dataDir({ PITWALL_DATA_DIR: root });
  mkdirSync(recordings, { recursive: true });
  const recording = join(recordings, basename(SEGMENT));
  copyFileSync(SEGMENT, recording);
  return { root, recordings, recording, sidecar: `${recording}.config.json` };
}

describe('pitwall CLI: config', { timeout: 30_000 }, () => {
  it('live writes <session file>.config.json next to the session file once the session starts', async () => {
    const root = tmp();
    const { recordings } = dataDir({ PITWALL_DATA_DIR: root });
    const udpPort = await freeUdpPort();
    const live = startCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: String(udpPort), PITWALL_DATA_DIR: root });
    await live.waitFor(/listening ws:\/\/127\.0\.0\.1:\d+/);
    await sendSegment(udpPort, 300);
    await vi.waitFor(() => expect(readdirSync(recordings).filter((name) => name.endsWith('.config.json'))).toHaveLength(1), { timeout: 10_000 });
    const files = readdirSync(recordings).sort();
    expect(files).toHaveLength(2);
    const [session, sidecar] = files as [string, string];
    expect(session).toMatch(/\.pwrec\.gz$/);
    expect(sidecar).toBe(`${session}.config.json`);
    expect(JSON.parse(readFileSync(join(recordings, sidecar), 'utf8'))).toEqual({});
    expect(await live.stop()).toBe(0);
  });

  it('live: a config.json with an unknown key stops the start, naming the key', async () => {
    const root = tmp();
    writeFileSync(join(root, 'config.json'), BROKEN);
    const r = await runCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: root });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^pitwall: .*no\.such\.key/m);
    expect(r.stdout).not.toContain('listening');
  });

  it('replay: a config.json with an unknown key stops the start when no config sits next to the recording', async () => {
    const { root, recording } = withRecording();
    writeFileSync(join(root, 'config.json'), BROKEN);
    const r = await runCli(['replay', recording], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: root });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^pitwall: .*no\.such\.key/m);
    expect(r.stdout).not.toContain('listening');
  });

  it('replay reads <recording>.config.json: a broken one stops the start, naming the key', async () => {
    const { root, recording, sidecar } = withRecording();
    writeFileSync(sidecar, BROKEN);
    const r = await runCli(['replay', recording], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: root });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^pitwall: .*no\.such\.key/m);
    expect(r.stdout).not.toContain('listening');
  });

  it('replay with a valid <recording>.config.json serves the recording', async () => {
    const { root, recording, sidecar } = withRecording();
    writeFileSync(sidecar, '{}');
    const replay = startCli(['replay', recording], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: root });
    await replay.waitFor(/listening ws:\/\/127\.0\.0\.1:\d+/);
    expect(await replay.stop()).toBe(0);
  });

  it('reprocess reads <recording>.config.json too: a broken one stops it, naming the key', async () => {
    const { root, sidecar } = withRecording();
    writeFileSync(sidecar, BROKEN);
    const r = await runCli(['reprocess'], { PITWALL_DATA_DIR: root });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^pitwall: .*no\.such\.key/m);
  });

  it('reprocess with a valid config.json and no sidecar rebuilds as before', async () => {
    const { root } = withRecording();
    writeFileSync(join(root, 'config.json'), '{}');
    expect(await runCli(['reprocess'], { PITWALL_DATA_DIR: root })).toMatchObject({ code: 0, stdout: expect.stringContaining('reprocessed 1 recordings') });
  });
});
