// The projection reads no sub-machine code (contract C6, C15, C28): it is reader-side (`@pitwall/engine/readers`) and
// sub-machines may import protocol types, so it reads each machine's scope from domain (`scopeOf`), never from the
// registry. Walked here: every module the projection loads at run time, directly or through another engine module.
// Type-only imports (`import type`, `export type`) load nothing; an import with inline `type` specifiers still loads its
// module (verbatimModuleSyntax), so it counts.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_SRC = join(import.meta.dirname, '..', '..', 'src');
const PROJECTION = join(ENGINE_SRC, 'log', 'projection.ts');

/** The relative modules `file` loads at run time: its imports and re-exports that are not type-only. */
const valueImports = (file: string): string[] => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly !== true) specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier) specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
  }
  return specifiers.filter((s) => s.startsWith('.')).map((s) => resolve(dirname(file), s));
};

/** Every engine module `entry` loads at run time, itself included, as paths relative to `src/`. */
const loadedFrom = (entry: string): string[] => {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of valueImports(file)) if (existsSync(next)) visit(next);
  };
  visit(entry);
  return [...seen].map((f) => relative(ENGINE_SRC, f)).sort();
};

describe('the projection module (C15, C28)', () => {
  it('the projection imports no sub-machine code', () => {
    const loaded = loadedFrom(PROJECTION);
    expect(loaded).toContain(join('log', 'projection.ts'));
    expect(loaded.filter((f) => f.startsWith('situations/'))).toEqual([]);
  });

  it('the walk sees a value import: the projection loads the log module', () => {
    expect(loadedFrom(PROJECTION)).toContain(join('log', 'log.ts'));
  });
});
