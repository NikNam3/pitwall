// The one import of dockview-core (spec 4.6). Its ESM build ships no stylesheet; the UMD bundle injects the library's
// CSS when it loads, so the shell loads that bundle and gets the same API with its styles.
export {
  createDockview,
  positionToDirection,
  themeDark,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewTheme,
  type IContentRenderer,
  type ITabRenderer,
  type Position,
  type SerializedDockview,
} from 'dockview-core/dist/dockview-core.js';
