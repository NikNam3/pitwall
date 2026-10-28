import { describe, expect, it, vi } from 'vitest';
import { ensureBridge } from '../src/bridge-process.ts';

// Seam: ensureBridge({ port, probe, spawn, args? }) -> Promise<{ attached: boolean; stop(): void }>
//   probe(url: string, timeoutMs: number): Promise<boolean>   true = something answers
//   spawn(command: string, args: string[]): { kill(): void }
//   args: the command after `--` (command first); default is ['pitwall', 'live']
const setup = (probeResult: boolean, extra: { args?: string[] } = {}) => {
  const child = { kill: vi.fn() };
  const spawn = vi.fn(() => child);
  const probe = vi.fn(async () => probeResult);
  return { child, spawn, probe, run: () => ensureBridge({ port: 4567, probe, spawn, ...extra }) };
};

describe('ensureBridge', () => {
  it('probes ws://127.0.0.1:<port> with a 500 ms timeout', async () => {
    const t = setup(true);
    await t.run();
    expect(t.probe).toHaveBeenCalledWith('ws://127.0.0.1:4567', 500);
  });

  it('spawns `pitwall live` when the probe fails', async () => {
    const t = setup(false);
    const bridge = await t.run();
    expect(t.spawn).toHaveBeenCalledTimes(1);
    expect(t.spawn).toHaveBeenCalledWith('pitwall', ['live']);
    expect(bridge.attached).toBe(false);
  });

  it('spawns nothing and attaches when the probe succeeds', async () => {
    const t = setup(true);
    const bridge = await t.run();
    expect(t.spawn).not.toHaveBeenCalled();
    expect(bridge.attached).toBe(true);
  });

  it('spawns the args after `--` instead of `pitwall live`', async () => {
    const t = setup(false, { args: ['pitwall', 'replay', 'x.pwrec', '--realtime'] });
    await t.run();
    expect(t.spawn).toHaveBeenCalledWith('pitwall', ['replay', 'x.pwrec', '--realtime']);
  });

  it('stops a spawned bridge on stop()', async () => {
    const t = setup(false);
    const bridge = await t.run();
    expect(t.child.kill).not.toHaveBeenCalled();
    bridge.stop();
    expect(t.child.kill).toHaveBeenCalledTimes(1);
  });

  it('never kills an attached bridge it did not start', async () => {
    const t = setup(true);
    const bridge = await t.run();
    bridge.stop();
    expect(t.child.kill).not.toHaveBeenCalled();
  });
});
