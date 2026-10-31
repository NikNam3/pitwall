// One import of a widget's component for the whole gallery. The gallery shows a widget in hundreds of cells, and the
// cell and its panel each ask for the component. Every call of a built lazy loader runs Vite's preload helper, which
// scans the whole page for a nonce meta tag: a cost per call that grows with the page, so it grew with the square of
// the cell count.
import type { RegisteredWidget } from '../kit/types.ts';

const shared = new WeakMap<RegisteredWidget, RegisteredWidget>();

/** The widget with a loader that imports its component on the first call and hands every later call the same promise. */
export function loadOnce(widget: RegisteredWidget): RegisteredWidget {
  let once = shared.get(widget);
  if (once === undefined) {
    let loaded: ReturnType<RegisteredWidget['component']> | undefined;
    once = { decl: widget.decl, component: () => (loaded ??= widget.component()) };
    shared.set(widget, once);
  }
  return once;
}
