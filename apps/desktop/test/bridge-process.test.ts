import { EventEmitter } from 'node:events';
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

// Fix round 1 seams:
//   spawn returns an EventEmitter-like handle { pid?: number; kill(): void; on('error', cb) }
//   options.killTree?: (pid: number) => void   stops the whole process tree; stop() calls it with child.pid
//   (the default in main.ts does process.kill(-pid) on a detached child; only the injected seam is tested)
//   A spawn failure ('error' emitted on a later tick, e.g. ENOENT) makes ensureBridge REJECT with an Error whose
//   message contains the command and the original error message. Implementation must wait one macrotask
//   (setImmediate) after spawn before resolving.
class FakeChild extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
}

describe('ensureBridge spawn failures and tree kill', () => {
  it('rejects with a clear error when the child emits ENOENT', async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => child.emit('error', new Error('spawn pitwall ENOENT')));
      return child;
    });
    const p = ensureBridge({ port: 1, probe: async () => false, spawn });
    await expect(p).rejects.toThrow(/pitwall/);
    await expect(p).rejects.toThrow(/ENOENT/);
  });

  it('does not throw when the child errors after ensureBridge resolved', async () => {
    const child = new FakeChild();
    await ensureBridge({ port: 1, probe: async () => false, spawn: () => child });
    expect(() => child.emit('error', new Error('late'))).not.toThrow();
  });

  it('stop() kills the whole process tree through killTree(pid)', async () => {
    const child = new FakeChild();
    const killTree = vi.fn();
    const bridge = await ensureBridge({ port: 1, probe: async () => false, spawn: () => child, killTree });
    bridge.stop();
    expect(killTree).toHaveBeenCalledTimes(1);
    expect(killTree).toHaveBeenCalledWith(4242);
  });

  it('stop() on an attached bridge never calls killTree', async () => {
    const killTree = vi.fn();
    const bridge = await ensureBridge({ port: 1, probe: async () => true, spawn: () => new FakeChild(), killTree });
    bridge.stop();
    expect(killTree).not.toHaveBeenCalled();
  });
});
