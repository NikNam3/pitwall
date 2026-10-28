import { createLogger, type Logger } from '../log.ts';

export type CliIo = {
  out(line: string): void;
  err(line: string): void;
  env: NodeJS.ProcessEnv;
  /** Aborted on SIGINT and SIGTERM. */
  signal: AbortSignal;
};

/** The exit code of a command stopped by `CliIo.signal` (128 + SIGINT, as a shell reports it). */
export const EXIT_INTERRUPTED = 130;

/** The process's own streams, environment and shutdown signals. */
export function defaultIo(): CliIo {
  const abort = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => abort.abort());
  return { out: (line) => console.log(line), err: (line) => console.error(line), env: process.env, signal: abort.signal };
}

/** Resolves once `signal` is aborted (at once if it already is). */
export function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** A logger that writes its JSON lines to `io.err`, which keeps stdout for the command's own output. */
export function cliLogger(io: CliIo, level: string): Logger {
  return createLogger({ level, destination: { write: (line: string) => io.err(line.trimEnd()) } });
}
