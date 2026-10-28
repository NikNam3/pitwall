/* eslint-disable @typescript-eslint/no-explicit-any -- `any` is the wildcard of the type-level contract (variance of Component and Fold) */
// The widget contract (spec 4.2): data declarations, `declareWidget` and `registerWidget`.
// No Svelte or DOM here: Node scripts import every widget.ts. Everything recorded is plain data plus functions.
import type { Fold, TopicName, TopicValue } from '@pitwall/contracts';
import type {
  AnyDataDecl, ComponentLoader, DataDecl, OptionDecl, OptionalDecl, ParamsArg, RegisteredWidget, SizeMode, WidgetDecl,
} from './types.ts';

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** A state topic. Append topics are read through `folded()` only, so a widget never sees raw `append` messages. */
export function topic<T extends TopicName>(name: T, ...[params]: ParamsArg<T>): DataDecl<T, TopicValue<T>> {
  return { topic: name, kind: 'state', params, fold: undefined };
}

/** An append topic, folded into one value `R` by `fold`. */
export function folded<T extends TopicName, R>(
  name: T,
  fold: Fold<TopicValue<T>, R>,
  ...[params]: ParamsArg<T>
): DataDecl<T, R> {
  return { topic: name, kind: 'folded', params, fold };
}

/** Marks an entry the widget renders without; it arrives as `undefined` until it has data. */
export function optional<D extends AnyDataDecl>(decl: D): OptionalDecl<D> {
  return { ...decl, optional: true };
}

/** Declares a widget. Called at import time, so a mistake fails the generator and the tests. */
export function declareWidget<D extends Record<string, AnyDataDecl>, O extends Record<string, OptionDecl<unknown>> = Record<never, never>>(w: {
  name: string;
  title: string;
  data: D;
  options?: O;
  sizes: Record<string, SizeMode>;
}): WidgetDecl<D, O> {
  if (!KEBAB_CASE.test(w.name)) throw new Error(`widget name "${w.name}" is not kebab-case`);
  const modes = Object.entries(w.sizes);
  if (modes.length === 0) throw new Error(`widget "${w.name}" declares no sizes`);
  for (const [mode, size] of modes) {
    if (!(size.minCols >= 1 && size.minRows >= 1)) {
      throw new Error(`widget "${w.name}" size "${mode}" needs minCols and minRows of at least 1`);
    }
  }
  return { name: w.name, title: w.title, data: w.data, options: w.options ?? ({} as O), sizes: w.sizes };
}

/** Pairs a declaration with its lazily loaded component; the component's props must be the declaration's `WidgetProps`. */
export function registerWidget<W extends WidgetDecl<any, any>>(decl: W, component: ComponentLoader<NoInfer<W>>): RegisteredWidget {
  return { decl, component };
}
