// Registration by convention: every folder under apps/ui/src/widgets with a register.ts is a widget.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRegisterFolders, renderRegisterIndex, writeIndex } from './gen-registry.ts';

const DEFAULT_WIDGETS_DIR = join(import.meta.dirname, '..', 'apps', 'ui', 'src', 'widgets');

/** The names of the widget folders in `widgetsDir` that hold a `register.ts`, sorted by code unit; throws on a folder with TypeScript files but no `register.ts`. */
export function findWidgetFolders(widgetsDir: string): string[] {
  return findRegisterFolders(widgetsDir, 'widget');
}

/** The source of `index.generated.ts` for these widget folders: one import per `register.ts` and the `WIDGETS` list. */
export function renderWidgetsIndex(folders: readonly string[]): string {
  return renderRegisterIndex(folders, {
    generator: 'gen-widgets.ts',
    typeImport: "import type { RegisteredWidget } from '../kit/types.ts';",
    typeName: 'RegisteredWidget',
    listName: 'WIDGETS',
    importPrefix: 'widget',
  });
}

/** Writes `outFile` (default: the index inside the widgets folder) from the widget folders found in `widgetsDir`. */
export function generateWidgets(
  widgetsDir: string = DEFAULT_WIDGETS_DIR,
  outFile: string = join(widgetsDir, 'index.generated.ts'),
): void {
  writeIndex(outFile, renderWidgetsIndex(findWidgetFolders(widgetsDir)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) generateWidgets();
