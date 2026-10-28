/* eslint-disable @typescript-eslint/no-explicit-any -- `any` is the wildcard of the widget contract's WidgetDecl */
// A new panel of a widget: its option defaults, following the default link group.
import type { PanelSpec } from '@pitwall/contracts';
import type { OptionDecl, WidgetDecl } from '../../kit/types.ts';

/** Group 1 is the default for every new panel, so out of the box it acts like one global selection (spec 7.5). */
export const DEFAULT_LINK_GROUP = 1;

/** The spec of a new panel of `decl`. Undefined defaults (a car option following the link) stay absent. */
export function defaultPanel(decl: WidgetDecl<any, any>): PanelSpec {
  const options: Record<string, unknown> = {};
  for (const [name, option] of Object.entries(decl.options as Record<string, OptionDecl<unknown>>)) {
    if (option.default !== undefined) options[name] = option.default;
  }
  return { widget: decl.name, options, linkGroup: DEFAULT_LINK_GROUP };
}
