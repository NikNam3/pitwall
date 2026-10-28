import { spawn } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';

/** What the replay child reports every 500 ms over IPC (`pitwall replay --dev`). */
export type PositionMessage = { type: 'position'; sessionTimeMs: number; paused: boolean; speed: number };

/** A running bridge child process, as the supervisor sees it. */
export interface ChildHandle {
  onMessage(cb: (msg: unknown) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

/** Starts `pitwall <args>` as a child; injected so tests need no process. */
export type SpawnChild = (args: string[]) => ChildHandle;

export type DevSupervisorOptions = {
  /** The recording to replay. */
  file: string;
  /** Directories watched recursively. */
  watch: string[];
  spawn: SpawnChild;
  /** Quiet time after the last change before the restart (default 200). */
  debounceMs?: number;
  /** Runs before each restart (not the first start); default `pnpm gen`. */
  gen?: () => Promise<void> | void;
  /** Extra replay flags for the first child only (`--at-lap n`, `--at-time ms`). */
  firstArgs?: string[];
};

/** How long a child gets to exit after SIGTERM before it is killed. */
const KILL_AFTER_MS = 2000;

const isPosition = (msg: unknown): msg is PositionMessage =>
  typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'position';

type Running = { handle: ChildHandle; reported: boolean; stopping: boolean; exited: boolean; whenExited: Promise<void> };

/**
 * Restarts the replay child when source files change (spec 8.4), at the replay moment the old child last reported.
 * A child that dies before its first position is reported once on stderr; the supervisor then waits for the next change.
 */
export class DevSupervisor {
  readonly #o: DevSupervisorOptions;
  readonly #watchers: FSWatcher[] = [];
  #timer: NodeJS.Timeout | undefined;
  #running: Running | undefined;
  #last: PositionMessage | undefined;
  #stopped = false;
  /** Restarts run one after another. */
  #queue: Promise<void> = Promise.resolve();

  constructor(opts: DevSupervisorOptions) {
    this.#o = opts;
  }

  start(): void {
    this.#spawn(this.#o.firstArgs ?? []);
    for (const dir of this.#o.watch) {
      this.#watchers.push(watch(dir, { recursive: true }, (_event, name) => this.#changed(name)));
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    for (const watcher of this.#watchers.splice(0)) watcher.close();
    await this.#queue;
    await this.#terminate();
  }

  #changed(name: string | Buffer | null): void {
    const file = String(name ?? '');
    // Only TypeScript sources count: not the generated indexes `pnpm gen` writes, and not directory events.
    if (this.#stopped || !file.endsWith('.ts') || file.endsWith('.generated.ts')) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#queue = this.#queue.then(() => this.#restart());
    }, this.#o.debounceMs ?? 200);
  }

  async #restart(): Promise<void> {
    await this.#terminate();
    if (this.#stopped) return;
    try {
      await (this.#o.gen ?? runGen)();
    } catch (error) {
      process.stderr.write(`pitwall dev: pnpm gen failed (${error instanceof Error ? error.message : String(error)}); waiting for the next change\n`);
      return;
    }
    if (this.#stopped) return;
    const at = this.#last;
    this.#spawn(at ? ['--at-time', String(at.sessionTimeMs), ...(at.paused ? ['--paused'] : []), '--speed', String(at.speed)] : []);
  }

  #spawn(extra: string[]): void {
    const handle = this.#o.spawn(['replay', this.#o.file, '--dev', ...extra]);
    let markExited: () => void = () => {};
    const whenExited = new Promise<void>((resolve) => (markExited = resolve));
    const running: Running = { handle, reported: false, stopping: false, exited: false, whenExited };
    this.#running = running;
    handle.onMessage((msg) => {
      if (!isPosition(msg)) return;
      running.reported = true;
      this.#last = msg;
    });
    handle.onExit((code) => {
      running.exited = true;
      if (this.#running === running) this.#running = undefined;
      if (!running.stopping && !running.reported) {
        process.stderr.write(`pitwall dev: the bridge exited with code ${code ?? 'null'} before it reported a position; waiting for the next change\n`);
      }
      markExited();
    });
  }

  /** SIGTERM the child, SIGKILL after 2 s; resolves once it has exited. */
  async #terminate(): Promise<void> {
    const running = this.#running;
    if (running === undefined || running.exited) return;
    running.stopping = true;
    const hard = setTimeout(() => running.handle.kill('SIGKILL'), KILL_AFTER_MS);
    running.handle.kill('SIGTERM');
    await running.whenExited;
    clearTimeout(hard);
  }
}

/** `pnpm gen` in the repository root. */
function runGen(): Promise<void> {
  return new Promise((resolve, reject) => {
    const root = new URL('../../../../', import.meta.url);
    const child = spawn('pnpm', ['-s', 'gen'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
  });
}
