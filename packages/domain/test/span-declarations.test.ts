// A sub-machine's scope is declared in domain (contract C15, C63): one file `src/situations/<machine-id>.ts` per
// sub-machine and one for the clock, each exporting its declaration as `spans` (`defineSpans`), collected by the
// generated `SPAN_DECLARATIONS`, sorted by machine id; `scopeOf` reads a machine's scope there, so every reader (the
// projection's membership, C26) can read it without reaching a sub-machine's code.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defineSpans, scopeOf, SPAN_DECLARATIONS, type SpanDeclaration } from '../src/index.ts';

const SITUATIONS_DIR = join(import.meta.dirname, '..', 'src', 'situations');

describe('span declarations (C15)', () => {
  it('defineSpans returns its declaration, its kinds as literals', () => {
    const d = { machine: 'car-location', scope: 'car', kinds: ['garage', 'pitLane', 'track'] } as const;
    const declared: SpanDeclaration<'garage' | 'pitLane' | 'track'> = defineSpans(d);
    expect(declared).toBe(d);
  });

  it('the clock declares its session-scoped kinds, running and paused (C85: its spans tile the session)', () => {
    expect(SPAN_DECLARATIONS.find((d) => d.machine === 'clock')).toEqual({ machine: 'clock', scope: 'session', kinds: ['running', 'paused'] });
  });

  it('SPAN_DECLARATIONS is sorted by machine id, each machine once', () => {
    const machines = SPAN_DECLARATIONS.map((d) => d.machine);
    expect(machines).toEqual([...machines].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(machines).size).toBe(machines.length);
  });

  it('every declaration file of the folder exports its declaration as spans, named after its machine, and is listed', async () => {
    const files = readdirSync(SITUATIONS_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.generated.ts'));
    expect(files).toContain('clock.ts');
    for (const file of files) {
      const { spans } = (await import(pathToFileURL(join(SITUATIONS_DIR, file)).href)) as { spans: SpanDeclaration };
      expect(spans.machine, file).toBe(file.slice(0, -'.ts'.length));
      expect(SPAN_DECLARATIONS, file).toContainEqual(spans);
    }
    expect(SPAN_DECLARATIONS).toHaveLength(files.length);
  });

  it("scopeOf gives a declared machine's scope and undefined for a machine without a declaration", () => {
    expect(scopeOf('clock')).toBe('session');
    for (const d of SPAN_DECLARATIONS) expect(scopeOf(d.machine), d.machine).toBe(d.scope);
    expect(scopeOf('no-such-machine')).toBeUndefined();
  });
});
