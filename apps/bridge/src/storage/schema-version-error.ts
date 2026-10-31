/**
 * A database of another schema version than this bridge's. Its own module without the SQLite import, so the CLI can
 * classify it without loading the storage (review 7 R7-5); `db.ts` throws it and re-exports it.
 */
export class SchemaVersionError extends Error {
  override readonly name = 'SchemaVersionError';
  readonly found: number;
  readonly expected: number;

  constructor(found: number, expected: number) {
    super(`database schema version ${found}, expected ${expected}`);
    this.found = found;
    this.expected = expected;
  }
}
