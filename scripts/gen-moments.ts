// Captures every named moment of fixtures/moments.json into test-support/moments/<name>.json (gitignored).
// Not part of `pnpm gen`: it replays the committed segments, which takes a few seconds.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureMoment } from '../apps/bridge/src/moments/capture.ts';

const ROOT = join(import.meta.dirname, '..');

type MomentSpec = { segment: string; atMs: number };

/** Writes one JSON file per named moment into `outDir`; the same input gives byte-identical files. */
export async function generateMoments(
  momentsFile: string = join(ROOT, 'fixtures', 'moments.json'),
  segmentsDir: string = join(ROOT, 'fixtures', 'segments'),
  outDir: string = join(ROOT, 'test-support', 'moments'),
): Promise<void> {
  const moments = JSON.parse(readFileSync(momentsFile, 'utf8')) as Record<string, MomentSpec>;
  mkdirSync(outDir, { recursive: true });
  for (const [name, { segment, atMs }] of Object.entries(moments)) {
    const values = await captureMoment(join(segmentsDir, segment), atMs);
    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(values, null, 1)}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generateMoments();
