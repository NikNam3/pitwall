import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

export type LoggerOptions = {
  /** A pino level name, or `silent`. Default `info`. */
  level?: string;
  /** Where the JSON lines go. Default stdout. */
  destination?: DestinationStream;
};

/** The bridge's structured logger: one JSON object per line; an `err` field is serialised with message and stack. */
export function createLogger(opts: LoggerOptions = {}): Logger {
  return pino({ level: opts.level ?? 'info' }, opts.destination);
}
