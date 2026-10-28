// Registration by convention: every folder under apps/bridge/src/features with a register.ts is a feature.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRegisterFolders, renderRegisterIndex, writeIndex } from './gen-registry.ts';

const DEFAULT_FEATURES_DIR = join(import.meta.dirname, '..', 'apps', 'bridge', 'src', 'features');

/** The names of the feature folders in `featuresDir` that hold a `register.ts`, sorted by code unit; throws on a folder with TypeScript files but no `register.ts`. */
export function findFeatureFolders(featuresDir: string): string[] {
  return findRegisterFolders(featuresDir, 'feature');
}

/** The source of `index.generated.ts` for these feature folders: one import per `register.ts` and the `FEATURES` list. */
export function renderFeaturesIndex(folders: readonly string[]): string {
  return renderRegisterIndex(folders, {
    generator: 'gen-features.ts',
    typeImport: "import type { Feature } from './feature.ts';",
    typeName: 'Feature',
    listName: 'FEATURES',
    importPrefix: 'feature',
  });
}

/** Writes `outFile` (default: the index inside the features folder) from the feature folders found in `featuresDir`. */
export function generateFeatures(
  featuresDir: string = DEFAULT_FEATURES_DIR,
  outFile: string = join(featuresDir, 'index.generated.ts'),
): void {
  writeIndex(outFile, renderFeaturesIndex(findFeatureFolders(featuresDir)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) generateFeatures();
