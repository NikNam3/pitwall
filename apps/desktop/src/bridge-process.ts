// Attach to a running bridge or start one (spec 7.1). Pure of Electron; probe and spawn are injected.

/** The command started when no bridge answers and none is given after `--`. */
export const DEFAULT_BRIDGE_COMMAND: readonly string[] = ['pitwall', 'live'];
/** How long a running bridge has to answer before a new one is started. */
const PROBE_TIMEOUT_MS = 500;

export type EnsureBridgeOptions = {
  port: number;
  /** True when something answers at `url` within `timeoutMs`. */
  probe: (url: string, timeoutMs: number) => Promise<boolean>;
  spawn: (command: string, args: string[]) => { kill(): void };
  /** The bridge command, command first; default `pitwall live`. */
  args?: readonly string[] | undefined;
};

export type BridgeHandle = {
  /** True when a bridge was already running. */
  attached: boolean;
  /** Stops a bridge this process started; never one it attached to. */
  stop(): void;
};

/** Attaches to the bridge at `port`, or spawns one and returns a handle that stops it. */
export async function ensureBridge(options: EnsureBridgeOptions): Promise<BridgeHandle> {
  if (await options.probe(`ws://127.0.0.1:${options.port}`, PROBE_TIMEOUT_MS)) {
    return { attached: true, stop: () => {} };
  }
  const [command, ...args] = options.args !== undefined && options.args.length > 0 ? options.args : DEFAULT_BRIDGE_COMMAND;
  const child = options.spawn(command as string, args);
  return { attached: false, stop: () => child.kill() };
}
