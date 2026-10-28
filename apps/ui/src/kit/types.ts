/* eslint-disable @typescript-eslint/no-explicit-any -- `any` is the wildcard of the type-level contract (variance of Component and Fold) */
// Types of the widget contract (spec 4.2). Type-only: the one svelte import is erased, so Node can import widget.ts.
import type { Component } from 'svelte';
import type { CarRef, Fold, TimeWindow, TopicName, TopicParams, TopicValue } from '@pitwall/contracts';
import type { CarId, FeedId } from '@pitwall/domain';

/** The link group of a panel, resolved to concrete cars and a window. */
export type ResolvedLink = { group: number; feedId: FeedId; primary: CarId; compare: CarId[]; window: TimeWindow };

/** What a params function sees: the panel's resolved link and its option values. */
export type ParamContext = { link: ResolvedLink; options: Readonly<Record<string, unknown>> };

/**
 * One data entry of a widget: plain data (topic, kind, params, fold) that Node scripts can read.
 * `R` is the value the component receives; `_value` exists for the type only.
 */
export type DataDecl<T extends TopicName, R> = {
  readonly topic: T;
  readonly kind: 'state' | 'folded';
  readonly params: ((ctx: ParamContext) => TopicParams<T>) | undefined;
  readonly fold: Fold<TopicValue<T>, R> | undefined;
  readonly _value?: () => R;
};
export type AnyDataDecl = DataDecl<any, any>;

/** A data entry the widget can render without: it arrives as `undefined` until it has data. */
export type OptionalDecl<D extends AnyDataDecl> = D & { readonly optional: true };

/** One per-panel setting, UI-only. `_value` exists for the type only. */
export type OptionDecl<V> = {
  readonly kind: 'bool' | 'choice' | 'number' | 'car';
  readonly label: string;
  readonly default: V;
  readonly choices?: readonly string[];
  readonly range?: { min: number; max: number; step: number };
  readonly _value?: () => V;
};

export type SizeMode = { minCols: number; minRows: number };

/** The result of `declareWidget`: the static description of a widget. */
export type WidgetDecl<D extends Record<string, AnyDataDecl>, O extends Record<string, OptionDecl<any>>> = {
  readonly name: string;
  readonly title: string;
  readonly data: D;
  readonly options: O;
  readonly sizes: Record<string, SizeMode>;
};

/** The size a component gets (spec 4.4): the mode, cells, pixels and device pixel ratio. */
export type WidgetSize = { mode: string; cols: number; rows: number; px: { width: number; height: number }; dpr: number };

type ValueOf<D> = D extends { readonly _value?: () => infer R } ? R : never;

/** Maps each data entry to the value the component gets, adding `| undefined` for `optional`. */
export type DataValues<W extends { data: Record<string, AnyDataDecl> }> = {
  [K in keyof W['data']]: W['data'][K] extends { readonly optional: true } ? ValueOf<W['data'][K]> | undefined : ValueOf<W['data'][K]>;
};

/** Maps each option to its value type. */
export type OptionValues<W extends { options: Record<string, OptionDecl<any>> }> = {
  [K in keyof W['options']]: ValueOf<W['options'][K]>;
};

/** The props of a widget component, derived from its declaration. */
export type WidgetProps<W extends WidgetDecl<any, any>> = {
  data: DataValues<W>;
  options: OptionValues<W>;
  size: WidgetSize;
  link: ResolvedLink;
};

/** The lazy loader of a widget component. */
export type ComponentLoader<W extends WidgetDecl<any, any>> = () => Promise<{ default: Component<WidgetProps<W>> }>;

/** A declaration paired with its lazy component: what `register.ts` exports and the generated index collects. */
export type RegisteredWidget = {
  readonly decl: WidgetDecl<any, any>;
  readonly component: () => Promise<{ default: Component<any> }>;
};

export type { CarRef };
