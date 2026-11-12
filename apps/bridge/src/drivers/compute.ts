// Runs the units' declared profile entries over a person's linked stored sessions (C62c, SP4.3a spec 4) and caches what
// the aggregates give in `profiles.sqlite`. The units judge (C43): the store only resolves the linked slots from the
// stored projections (C34), calls the declared aggregates and stores their results. The cache holds per (person, key)
// one result with its aggregate's version and the fingerprint of its inputs (the person's links, the linked sessions
// and their rules versions, exclusions, overrides and config); a mismatch recomputes it, and deleting the file loses
// nothing.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonicalJson } from '@pitwall/contracts';
import { known, unknown, type DriverPerson, type Known, type ProfileEntry } from '@pitwall/domain';
import type { ProfileCtx, ProfileEntryDecl, ProfilesDecl, StoredDriverSession } from '@pitwall/engine/readers';
import type { Logger } from '../log.ts';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** What an aggregate gives: the entry's value and the laps it rests on. */
type Aggregated = { value: Known<number>; laps: number };

/** The cache of computed profile entries (`profiles.sqlite`). */
export class ProfilesCache {
  readonly #db: Database.Database;
  readonly #get;
  readonly #put;

  constructor(path: string) {
    this.#db = new Database(path);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS entries (
      person TEXT NOT NULL, key TEXT NOT NULL, version INTEGER NOT NULL, fingerprint TEXT NOT NULL, value_json TEXT NOT NULL,
      PRIMARY KEY (person, key))`);
    this.#get = this.#db.prepare('SELECT version, fingerprint, value_json FROM entries WHERE person = ? AND key = ?');
    this.#put = this.#db.prepare('INSERT OR REPLACE INTO entries (person, key, version, fingerprint, value_json) VALUES (?, ?, ?, ?, ?)');
  }

  /** The cached result, if it was computed by `version` from inputs with `fingerprint`. */
  get(person: string, key: string, version: number, fingerprint: string): Aggregated | undefined {
    const row = this.#get.get(person, key) as { version: number; fingerprint: string; value_json: string } | undefined;
    return row !== undefined && row.version === version && row.fingerprint === fingerprint ? (JSON.parse(row.value_json) as Aggregated) : undefined;
  }

  put(person: string, key: string, version: number, fingerprint: string, result: Aggregated): void {
    this.#put.run(person, key, version, fingerprint, JSON.stringify(result));
  }

  close(): void {
    if (this.#db.open) this.#db.close();
  }
}

/** One linked session of a person as the runner gets it: what the aggregates read, and the rules version it was stored with. */
export type LinkedSession = { stored: StoredDriverSession; rulesVersion: string };

/** Runs the declared aggregates; one that throws is a bug of its unit: logged, its value unknown (C48). */
export class ProfileRunner {
  readonly #decls: readonly ProfilesDecl[];
  readonly #cache: ProfilesCache;
  readonly #config: ProfileCtx['config'];
  readonly #log: Logger;

  constructor(decls: readonly ProfilesDecl[], cache: ProfilesCache, config: ProfileCtx['config'], log: Logger) {
    this.#decls = decls;
    this.#cache = cache;
    this.#config = config;
    this.#log = log;
  }

  /** The declaration of the entry `key`; `undefined` for a key no unit declares. */
  entryDecl(key: string): ProfileEntryDecl | undefined {
    for (const decl of this.#decls) if (Object.hasOwn(decl.entries, key)) return decl.entries[key];
    return undefined;
  }

  /**
   * The person's entries over `sessions` (their linked, not excluded sessions with a human span), each from the cache
   * when its version and inputs are unchanged; an override takes its key's value, the laps and sessions stay the
   * computed ones.
   */
  entries(person: DriverPerson, sessions: readonly LinkedSession[]): Record<string, ProfileEntry> {
    const ctx: ProfileCtx = { config: this.#config, overrides: person.overrides };
    const stored = sessions.map((s) => s.stored);
    const fingerprint = sha256(canonicalJson({
      links: person.links,
      sessions: sessions.map((s) => ({ session: s.stored.session, carId: s.stored.carId, rulesVersion: s.rulesVersion })),
      excluded: person.excluded,
      overrides: person.overrides,
      config: this.#config,
    }));
    const newestSession = stored.reduce((newest, s) => (s.startedAt > newest ? s.startedAt : newest), '');
    const entries: Record<string, ProfileEntry> = {};
    for (const decl of this.#decls) {
      for (const [key, entry] of Object.entries(decl.entries)) {
        let result = this.#cache.get(person.id, key, entry.version, fingerprint);
        if (result === undefined) {
          result = this.#call(decl, key, () => entry.aggregate(stored, ctx));
          if (result !== undefined) this.#cache.put(person.id, key, entry.version, fingerprint, result);
        }
        const override = person.overrides[key];
        entries[key] = {
          value: override !== undefined ? known(override, 0) : (result?.value ?? unknown('notApplicable')),
          laps: result?.laps ?? 0,
          sessions: stored.length,
          newestSession,
        };
      }
    }
    return entries;
  }

  #call<T>(decl: ProfilesDecl, what: string, run: () => T): T | undefined {
    try {
      return run();
    } catch (error) {
      this.#log.error({ err: error, unit: decl.unit, what }, 'a profile aggregate failed: its value is unknown');
      return undefined;
    }
  }
}
