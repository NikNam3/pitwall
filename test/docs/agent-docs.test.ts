import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('agent docs', () => {
  it('CLAUDE.md is a short map that carries the git rule verbatim', () => {
    const md = read('CLAUDE.md');
    expect(md.trimEnd().split('\n').length).toBeLessThanOrEqual(150);
    expect(md).toContain('Claude manages git: workers commit on their own branches; supervisor may merge to main and push without asking; never force-push main');
    for (const ref of ['docs/architecture.md', 'docs/decisions/', 'docs/tasks/_template.md', 'pnpm check', 'PITWALL_WORKER_SCOPE', 'PITWALL_PHASE', 'PITWALL_FIXTURES_DIR'])
      expect(md).toContain(ref);
  });
  it('has the five ADRs, each with status, context, decision and consequences', () => {
    const adrs = readdirSync(join(ROOT, 'docs/decisions')).filter((f) => f.endsWith('.md')).sort();
    expect(adrs).toEqual(['0001-stack-and-native-type-stripping.md', '0002-fixtures-outside-git.md', '0003-shared-domain-package.md',
      '0004-better-sqlite3-over-node-sqlite.md', '0005-feature-registry-via-generated-index.md']);
    for (const f of adrs) for (const h of ['## Status', '## Context', '## Decision', '## Consequences']) expect(read(`docs/decisions/${f}`), `${f}: ${h}`).toContain(h);
  });
  it('architecture.md states every allowed dependency edge', () => {
    const md = read('docs/architecture.md');
    for (const edge of ['contracts → domain', 'engine → protocol, domain', 'strategy → engine, domain', 'bridge → all packages', 'ui → contracts, domain'])
      expect(md).toContain(edge);
  });
  it('the task template asks for scope, interfaces, tests and the report format', () => {
    const md = read('docs/tasks/_template.md');
    for (const h of ['## Scope', '## Interfaces', '## Tests to pass', '## Phase', '## Report', 'Requested changes to supervisor-owned files']) expect(md).toContain(h);
  });
});
