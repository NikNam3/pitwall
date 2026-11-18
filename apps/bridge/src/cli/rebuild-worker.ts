// The rebuild service's worker thread (C61; SP4.3e spec §4.3 item 3a "One writer, short transactions"): it only replays.
// A rebuild replays one recording as `pitwall reprocess` does (`processRecording`, C38: the same recording with its
// sidecars gives the same log) into a database of its own, in memory, and posts each session it yields to the main
// thread: its row, then its log in parts of at most `PART_SIZE` facts, then its end. The main thread, the only writer of
// the pitwall database, stages the parts and swaps them in (`storage/rebuild-service.ts`). A planning replay (C62d)
// replays a recording to its end and stores nothing; its planning result is SP4.3e Task 7b's.
import { parentPort } from 'node:worker_threads';
import { effectiveConfig, loadFeatureConfig, recordingConfig, type FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import { createLogger, type Logger } from '../log.ts';
import { openDatabase, type Db, type SessionKey } from '../storage/db.ts';
import type { FactRow } from '../storage/log-rows.ts';
import { PART_SIZE, type FallbackConfig, type WorkerJob, type WorkerReply } from '../storage/rebuild-messages.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';
import { processRecording } from './process-recording.ts';

const port = parentPort;
if (port === null) throw new Error('rebuild-worker must run as a worker thread');

const post = (reply: WorkerReply): void => port.postMessage(reply);

/** The worker's warnings, as JSON lines the main thread logs. */
const log: Logger = createLogger({ level: 'warn', destination: { write: (line: string) => post({ type: 'log', line }) } });

type KeyRow = { session_uid: string; weekend_id: string; player_car: number };
type FactSql = { list: string; seq: number; car_id: number | null; record: string };

const fallbackOf = ({ config, root }: FallbackConfig): FeatureConfig =>
  config ?? (root === undefined ? effectiveConfig(FEATURES) : loadFeatureConfig(root, FEATURES));

/** Replays `pwrecPath` into a database of the worker's own (in memory), as `pitwall reprocess` processes it. */
async function replayed(pwrecPath: string, fallback: FallbackConfig, rulesVersion: string): Promise<Db> {
  const db = openDatabase(':memory:');
  try {
    const config = recordingConfig(pwrecPath, FEATURES, fallbackOf(fallback), log);
    await processRecording(pwrecPath, db, log, new AbortController().signal, config, rulesVersion);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Posts every session of `db`: its row, its log in parts, its end. */
function postSessions(id: number, db: Db): void {
  const repo = new WeekendRepository(db);
  const keys = db.prepare('SELECT session_uid, weekend_id, player_car FROM sessions ORDER BY started_at, session_uid, player_car').all() as KeyRow[];
  const facts = db.prepare('SELECT list, seq, car_id, record FROM facts WHERE session_uid = ? AND weekend_id = ? AND player_car = ? ORDER BY list, seq');
  for (const k of keys) {
    const key = { sessionUid: k.session_uid, weekendId: k.weekend_id, playerCar: k.player_car } as SessionKey;
    const row = repo.sessionOf(key);
    if (row === undefined) continue;
    post({ id, type: 'session', row });
    const rows = (facts.all(k.session_uid, k.weekend_id, k.player_car) as FactSql[]).map((f): FactRow => ({ list: f.list, seq: f.seq, carId: f.car_id, record: f.record }));
    for (let at = 0; at < rows.length; at += PART_SIZE) post({ id, type: 'part', key, rows: rows.slice(at, at + PART_SIZE) });
    post({ id, type: 'sessionEnd', key });
  }
}

async function run(job: WorkerJob): Promise<void> {
  try {
    const path = job.kind === 'rebuild' ? job.pwrecPath : job.job.pwrecPath;
    const db = await replayed(path, job.fallback, job.rulesVersion);
    try {
      if (job.kind === 'rebuild') postSessions(job.id, db);
    } finally {
      db.close();
    }
    post({ id: job.id, type: 'done', value: undefined });
  } catch (error) {
    post({ id: job.id, type: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

// One job at a time: the main thread hands the next only once this one is done.
port.on('message', (job: WorkerJob) => void run(job));
