import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const FIXTURES = join(import.meta.dirname, 'fixtures/ui');
const fixture = (rel: string) => readFileSync(join(FIXTURES, rel), 'utf8');

// ---------------------------------------------------------------- dependency-cruiser

/** One probe file placed at a repo-relative path (fixtures end in `.txt` so the repo's own gates ignore them). */
interface Probe { at: string; fixture: string }
interface Violation { rule: { name: string }; from: string; to: string }

const created: string[] = [];
/** Writes probes (never over an existing file) and remembers the topmost directory it had to create. */
function place(probes: Probe[]): void {
  for (const p of probes) {
    const file = join(ROOT, p.at);
    if (existsSync(file)) continue; // e.g. a generated index that exists in a built tree
    let top = dirname(file);
    while (!existsSync(dirname(top))) top = dirname(top);
    const firstNew = existsSync(top) ? undefined : top;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, fixture(p.fixture));
    created.push(file);
    if (firstNew) created.push(firstNew);
  }
}
afterEach(() => {
  for (const path of created.splice(0).reverse()) rmSync(path, { recursive: true, force: true });
});

/** Runs the repo's depcruise config on the probe entry files and returns every violation. */
function cruise(entries: string[]): Violation[] {
  const r = spawnSync('pnpm', ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', '--output-type', 'json', ...entries], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const report = JSON.parse(r.stdout) as { summary: { violations: Violation[] } };
  return report.summary.violations;
}
const hits = (violations: Violation[], rule: string, from: string) =>
  violations.filter((v) => v.rule.name === rule && v.from === from);

const W = 'apps/ui/src/widgets';
const leaf = (at: string): Probe => ({ at, fixture: 'depcruise/leaf.ts.txt' });

interface DepCase {
  rule: string;
  bad: { entry: string; fixture: string; support?: Probe[] };
  ok: { entry: string; fixture: string; support?: Probe[] };
}
const depCases: DepCase[] = [
  {
    rule: 'ui-widgets-isolated',
    bad: { entry: `${W}/__probe-a__/x.ts`, fixture: 'ui-widgets-isolated.bad', support: [leaf(`${W}/__probe-b__/leaf.ts`)] },
    ok: { entry: `${W}/__probe-a__/x.ts`, fixture: 'ui-widgets-isolated.ok', support: [leaf(`${W}/__probe-a__/leaf.ts`), leaf('apps/ui/src/kit/__probe__/leaf.ts')] },
  },
  {
    rule: 'ui-kit-no-shell',
    bad: { entry: 'apps/ui/src/kit/__probe__/x.ts', fixture: 'ui-kit-no-shell.bad', support: [leaf('apps/ui/src/shell/__probe__/leaf.ts')] },
    ok: { entry: 'apps/ui/src/kit/__probe__/x.ts', fixture: 'ui-kit-no-shell.ok', support: [leaf('apps/ui/src/theme/__probe__/leaf.ts')] },
  },
  {
    rule: 'ui-connection-only-contracts-domain',
    bad: { entry: 'apps/ui/src/connection/__probe__/x.ts', fixture: 'ui-connection-only-contracts-domain.bad', support: [leaf('apps/ui/src/kit/__probe__/leaf.ts')] },
    ok: { entry: 'apps/ui/src/connection/__probe__/x.ts', fixture: 'ui-connection-only-contracts-domain.ok' },
  },
  {
    rule: 'ui-widget-index-only-shell',
    bad: { entry: 'apps/ui/src/kit/__probe__/x.ts', fixture: 'ui-widget-index-only-shell', support: [leaf(`${W}/index.generated.ts`)] },
    ok: { entry: 'apps/ui/src/shell/__probe__/x.ts', fixture: 'ui-widget-index-only-shell', support: [leaf(`${W}/index.generated.ts`)] },
  },
  {
    rule: 'ui-gallery-files-only-gallery',
    bad: { entry: 'apps/ui/src/shell/__probe__/x.ts', fixture: 'ui-gallery-files-only-gallery', support: [leaf(`${W}/__probe-a__/gallery.ts`)] },
    ok: { entry: 'apps/ui/src/gallery/__probe__/x.ts', fixture: 'ui-gallery-files-only-gallery', support: [leaf(`${W}/__probe-a__/gallery.ts`)] },
  },
  {
    rule: 'ui-dockview-only-docking',
    bad: { entry: 'apps/ui/src/kit/__probe__/x.ts', fixture: 'ui-dockview-only-docking' },
    ok: { entry: 'apps/ui/src/shell/docking/__probe__/x.ts', fixture: 'ui-dockview-only-docking' },
  },
  {
    rule: 'desktop-imports-nothing',
    bad: { entry: 'apps/desktop/src/__probe__/x.ts', fixture: 'desktop-imports-nothing.bad' },
    ok: { entry: 'apps/desktop/src/__probe__/x.ts', fixture: 'desktop-imports-nothing.ok', support: [leaf('apps/desktop/src/__probe__/leaf.ts')] },
  },
];

describe('dependency-cruiser rules inside apps/ui', { timeout: 120_000 }, () => {
  describe.each(depCases)('$rule', ({ rule, bad, ok }) => {
    it('rejects the violating file', () => {
      place([...(bad.support ?? []), { at: bad.entry, fixture: `depcruise/${bad.fixture}.ts.txt` }]);
      expect(hits(cruise([bad.entry]), rule, bad.entry)).not.toEqual([]);
    });
    it('accepts the allowed file', () => {
      place([...(ok.support ?? []), { at: ok.entry, fixture: `depcruise/${ok.fixture}.ts.txt` }]);
      const violations = cruise([ok.entry]);
      expect(hits(violations, rule, ok.entry)).toEqual([]);
      // an allowed file trips none of the UI rules either
      expect(violations.filter((v) => v.from === ok.entry && /^(ui-|desktop-)/.test(v.rule.name))).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- ESLint

const eslint = new ESLint({ cwd: ROOT });
/** Lints a fixture as if it lived at `virtualPath` (repo-relative) and returns the rule messages (lines they sit on). */
async function lint(fixtureFile: string, virtualPath: string) {
  const [result] = await eslint.lintText(fixture(`eslint/${fixtureFile}`), { filePath: join(ROOT, virtualPath) });
  return result!.messages;
}
/** Asserts that every one of the given 1-based lines carries a rule violation, and nothing is a parse error. */
async function expectRejected(fixtureFile: string, virtualPath: string, lines: number[]) {
  const messages = await lint(fixtureFile, virtualPath);
  expect(messages.filter((m) => m.fatal)).toEqual([]);
  const flagged = new Set(messages.filter((m) => m.ruleId !== null).map((m) => m.line));
  for (const line of lines) expect(flagged, `line ${line} of ${fixtureFile} at ${virtualPath}`).toContain(line);
}
const expectAccepted = async (fixtureFile: string, virtualPath: string) =>
  expect(await lint(fixtureFile, virtualPath)).toEqual([]);

const S = 'apps/ui/src';

describe('ESLint: no colour literals outside theme/', { timeout: 60_000 }, () => {
  it('rejects hex, rgb(, hsl( and oklch( in kit/x.ts', async () => {
    await expectRejected('colour-literals.ts.txt', `${S}/kit/x.ts`, [1, 2, 3, 4, 5]);
  });
  it('accepts them in theme/roles.ts', async () => {
    await expectAccepted('colour-literals.ts.txt', `${S}/theme/roles.ts`);
  });
  it('rejects colour literals in a widget .svelte style', async () => {
    await expectRejected('colour-literals.svelte.bad.svelte.txt', `${S}/widgets/demo/Demo.svelte`, [3]);
  });
  it('accepts var(--pw-*) colours in a .svelte style', async () => {
    await expectAccepted('colour-literals.svelte.ok.svelte.txt', `${S}/widgets/demo/Demo.svelte`);
  });
});

describe('ESLint: font-family only var(--pw-font)', { timeout: 60_000 }, () => {
  it('rejects another font-family', async () => {
    await expectRejected('font-family.bad.svelte.txt', `${S}/kit/Demo.svelte`, [3]);
  });
  it('accepts var(--pw-font)', async () => {
    await expectAccepted('font-family.ok.svelte.txt', `${S}/kit/Demo.svelte`);
  });
});

describe('ESLint: WebSocket and fetch only in connection/', { timeout: 60_000 }, () => {
  it('rejects them in kit/x.ts', async () => {
    await expectRejected('network.ts.txt', `${S}/kit/x.ts`, [1, 2]);
  });
  it('accepts them in connection/x.ts', async () => {
    await expectAccepted('network.ts.txt', `${S}/connection/x.ts`);
  });
});

describe('ESLint: window host calls only in shell/host/', { timeout: 60_000 }, () => {
  it('rejects window.open, moveTo, resizeTo and screen in kit/x.ts', async () => {
    await expectRejected('window-host.ts.txt', `${S}/kit/x.ts`, [1, 2, 3, 4]);
  });
  it('accepts them in shell/host/x.ts', async () => {
    await expectAccepted('window-host.ts.txt', `${S}/shell/host/x.ts`);
  });
});

describe('ESLint: number formatting only in kit/values/format.ts', { timeout: 60_000 }, () => {
  it('rejects toFixed, toPrecision, toLocaleString, Intl.NumberFormat and Intl.DateTimeFormat in kit/x.ts', async () => {
    await expectRejected('number-format.ts.txt', `${S}/kit/x.ts`, [1, 2, 3, 4, 5]);
  });
  it('rejects them in a widget too', async () => {
    await expectRejected('number-format.ts.txt', `${S}/widgets/demo/emphasis.ts`, [1, 2, 3, 4, 5]);
  });
  it('accepts them in kit/values/format.ts', async () => {
    await expectAccepted('number-format.ts.txt', `${S}/kit/values/format.ts`);
  });
});

describe('ESLint: no margin, padding, gap or line-height in widgets/**/*.svelte styles', { timeout: 60_000 }, () => {
  it.each(['margin', 'padding', 'gap', 'line-height'])('rejects %s', async (property) => {
    await expectRejected(`widget-spacing.${property}.bad.svelte.txt`, `${S}/widgets/demo/Demo.svelte`, [3]);
  });
  it('accepts a widget style without spacing declarations', async () => {
    await expectAccepted('widget-spacing.ok.svelte.txt', `${S}/widgets/demo/Demo.svelte`);
  });
  it('accepts spacing declarations in kit/ components', async () => {
    await expectAccepted('widget-spacing.margin.bad.svelte.txt', `${S}/kit/Demo.svelte`);
  });
});

// ---------------------------------------------------------------- scans of the real tree

function walk(dir: string, accept: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, accept) : accept(p) ? [p] : [];
  });
}

describe('scans of apps/ui/src', () => {
  it('no real widget style declares margin, padding, gap or line-height', () => {
    const files = walk(join(ROOT, S, 'widgets'), (f) => f.endsWith('.svelte'));
    const offenders = files.filter((f) => {
      const styles = [...readFileSync(f, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
      return /(^|[\s;{])(margin|padding|gap|row-gap|column-gap|line-height)(-[a-z]+)?\s*:/.test(styles);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
  it('ligatures are off globally (font-variant-ligatures: none)', () => {
    const files = walk(join(ROOT, 'apps/ui'), (f) => /\.(css|svelte|html)$/.test(f) && !f.includes('node_modules'));
    const sources = files.map((f) => readFileSync(f, 'utf8'));
    expect(sources.some((s) => /font-variant-ligatures\s*:\s*none/.test(s))).toBe(true);
  });
});

describe('apps/ui scaffold', () => {
  it('folder skeleton exists with a one-line README each', () => {
    for (const d of ['connection', 'shell', 'kit', 'theme', 'emphasis', 'widgets', 'gallery']) {
      const readme = join(ROOT, S, d, 'README.md');
      expect(existsSync(readme), `${d}/README.md`).toBe(true);
      expect(readFileSync(readme, 'utf8').trim().split('\n').length, `${d}/README.md is one line`).toBe(1);
    }
  });
  it('JetBrains Mono is bundled with its OFL licence', () => {
    const dir = join(ROOT, S, 'theme/font');
    expect(existsSync(join(dir, 'JetBrainsMono[wght].woff2'))).toBe(true);
    expect(readdirSync(dir).some((f) => /OFL/i.test(f))).toBe(true);
  });
  it('pnpm --filter @pitwall/ui build succeeds', { timeout: 300_000 }, () => {
    // pnpm exits 0 when the filter matches nothing, so require the package first
    expect(JSON.parse(readFileSync(join(ROOT, 'apps/ui/package.json'), 'utf8')).name).toBe('@pitwall/ui');
    const r = spawnSync('pnpm', ['--filter', '@pitwall/ui', 'build'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stderr + r.stdout).toContain('');
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
