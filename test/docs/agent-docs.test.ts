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
  it('has the original nine ADRs and every ADR has status, context, decision and consequences', () => {
    const adrs = readdirSync(join(ROOT, 'docs/decisions')).filter((f) => f.endsWith('.md')).sort();
    const original = ['0001-stack-and-native-type-stripping.md', '0002-fixtures-outside-git.md', '0003-shared-domain-package.md',
      '0004-better-sqlite3-over-node-sqlite.md', '0005-feature-registry-via-generated-index.md', '0006-gpl-code-and-data-allowed.md',
      '0007-one-file-per-topic.md', '0008-calculator-config.md', '0009-second-car-later.md'];
    for (const f of original) expect(adrs, f).toContain(f);
    for (const f of adrs) expect(f, `${f}: name`).toMatch(/^\d{4}-[a-z0-9-]+\.md$/);
    const numbers = adrs.map((f) => f.slice(0, 4));
    expect(new Set(numbers).size, 'unique ADR numbers').toBe(numbers.length);
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
