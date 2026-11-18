// The messages between the rebuild service (`rebuild-service.ts`, the main thread, the database's only writer) and its
// worker thread (`cli/rebuild-worker.ts`, which only replays). Storage sees only domain types here (C6): the worker,
// which replays recordings through the engine, lives outside storage and is loaded by its URL.
import type { ConfigValue } from '@pitwall/engine/readers';
import type { SessionKey, StoredSessionRow } from './db.ts';
import type { FactRow } from './log-rows.ts';
import type { ReplayJob } from './rebuild-service-types.ts';

/** The worker thread's module. */
export const REBUILD_WORKER = new URL('../cli/rebuild-worker.ts', import.meta.url);

/** The most facts one part carries: each part is one short transaction on the main thread. */
export const PART_SIZE = 1_000;

/**
 * The config a recording without its own config sidecar runs with (C47): `config` when given (`pitwall live` has it
 * loaded), else `<root>/config.json`, else the declared defaults.
 */
export type FallbackConfig = { config?: Record<string, Record<string, ConfigValue>>; root?: string };

/** A job the main thread hands the worker. */
export type WorkerJob =
  | { id: number; kind: 'rebuild'; pwrecPath: string; fallback: FallbackConfig; rulesVersion: string }
  /** `dbPath`: the pitwall database, which the planning replay reads its basis from (read only); none in memory. */
  | { id: number; kind: 'replay'; job: ReplayJob; fallback: FallbackConfig; rulesVersion: string; dbPath: string | undefined };

/** What the worker posts, in order per job: per session its row, its parts and its end; then the job's end. */
export type WorkerReply =
  | { id: number; type: 'session'; row: StoredSessionRow }
  | { id: number; type: 'part'; key: SessionKey; rows: FactRow[] }
  | { id: number; type: 'sessionEnd'; key: SessionKey }
  | { id: number; type: 'done'; value: unknown }
  | { id: number; type: 'failed'; error: string }
  | { type: 'log'; line: string };
