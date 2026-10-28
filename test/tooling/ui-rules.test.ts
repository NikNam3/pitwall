import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

let sandbox: string | undefined;
/**
 * Copies probes into a fresh temp directory (same relative paths), so nothing is written into the repo and a
 * parallel repo-wide depcruise run never sees them. node_modules are symlinked so workspace imports resolve.
 */
function place(probes: Probe[]): string {
  sandbox ??= mkdtempSync(join(tmpdir(), 'pitwall-ui-rules-'));
  writeFileSync(join(sandbox, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowImportingTsExtensions: true, noEmit: true, module: 'nodenext' } }));
  for (const [link, target] of [['node_modules', join(ROOT, 'node_modules')], ['apps/ui/node_modules', join(ROOT, 'apps/ui/node_modules')]] as const) {
    if (!existsSync(target) || existsSync(join(sandbox, link))) continue;
    mkdirSync(dirname(join(sandbox, link)), { recursive: true });
    symlinkSync(target, join(sandbox, link), 'dir');
  }
  for (const p of probes) {
    const file = join(sandbox, p.at);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, fixture(p.fixture));
  }
  return sandbox;
}
afterEach(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  sandbox = undefined;
});

/** Runs the repo's depcruise config on the probe entry files and returns every violation. */
function cruise(cwd: string, entries: string[]): Violation[] {
  const r = spawnSync('pnpm', ['exec', 'depcruise', '--config', join(ROOT, '.dependency-cruiser.cjs'), '--output-type', 'json', ...entries], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
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
      const dir = place([...(bad.support ?? []), { at: bad.entry, fixture: `depcruise/${bad.fixture}.ts.txt` }]);
      expect(hits(cruise(dir, [bad.entry]), rule, bad.entry)).not.toEqual([]);
    });
    it('accepts the allowed file', () => {
      const dir = place([...(ok.support ?? []), { at: ok.entry, fixture: `depcruise/${ok.fixture}.ts.txt` }]);
      const violations = cruise(dir, [ok.entry]);
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

describe('ESLint: colour literals in longer strings, inline styles, and look-alikes', { timeout: 60_000 }, () => {
  it('rejects a colour inside a longer string or template literal', async () => {
    await expectRejected('colour-embedded.ts.txt', `${S}/kit/x.ts`, [1, 2, 3, 4]);
  });
  it('accepts the same embedded colours in theme/', async () => {
    await expectAccepted('colour-embedded.ts.txt', `${S}/theme/x.ts`);
  });
  it('rejects an inline style attribute colour in a .svelte file', async () => {
    await expectRejected('colour-inline.bad.svelte.txt', `${S}/kit/Demo.svelte`, [1]);
  });
  it('accepts look-alikes (#main, URL fragment, rgbaWidget, issue numbers)', async () => {
    await expectAccepted('colour-lookalikes.ts.txt', `${S}/kit/x.ts`);
  });
});

describe('ESLint: widget spacing in inline styles and directives', { timeout: 60_000 }, () => {
  it.each([
    ['inline style attribute', 'spacing-inline.bad.svelte.txt', 1],
    ['style: directive', 'spacing-directive.bad.svelte.txt', 4],
    ['grid-gap', 'spacing-grid-gap.bad.svelte.txt', 3],
    ['row-gap', 'spacing-row-gap.bad.svelte.txt', 3],
    ['column-gap', 'spacing-column-gap.bad.svelte.txt', 3],
  ])('rejects %s in a widget', async (_name, file, line) => {
    await expectRejected(file, `${S}/widgets/demo/Demo.svelte`, [line]);
  });
});

describe('ESLint: font shorthand', { timeout: 60_000 }, () => {
  it('rejects a font: shorthand naming another family', async () => {
    await expectRejected('font-shorthand.bad.svelte.txt', `${S}/kit/Demo.svelte`, [3]);
  });
  it('accepts font-size and font-weight', async () => {
    await expectAccepted('font-shorthand.ok.svelte.txt', `${S}/kit/Demo.svelte`);
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
    // the global stylesheet is the one src/main.ts imports
    const main = readFileSync(join(ROOT, S, 'main.ts'), 'utf8');
    const sheets = [...main.matchAll(/import\s+['"](\.\/[^'"]+\.css)['"]/g)].map((m) => join(ROOT, S, m[1]!));
    expect(sheets, 'main.ts imports a global stylesheet').not.toEqual([]);
    const rootBlocks = sheets.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((m) => m[1]!.split(',').some((sel) => /^(:root|html|body|\*)$/.test(sel.trim())))
        .map((m) => m[2]!),
    );
    expect(rootBlocks.some((body) => /font-variant-ligatures\s*:\s*none\s*;/.test(body))).toBe(true);
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
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
