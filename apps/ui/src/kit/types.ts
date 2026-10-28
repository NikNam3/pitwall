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
/** The params function of an entry: required when the topic's params have keys. */
export type ParamsArg<T extends TopicName> = TopicParams<T> extends Record<string, never>
  ? [params?: (ctx: ParamContext) => TopicParams<T>]
  : [params: (ctx: ParamContext) => TopicParams<T>];

export type AnyDataDecl = DataDecl<any, any>;

/** A data entry the widget can render without: it arrives as `undefined` until it has data. */
export type OptionalDecl<D extends AnyDataDecl> = D & { readonly optional: true };

type OptionBase<V> = { readonly label: string; readonly default: V; readonly _value?: () => V };

export type BoolOption = OptionBase<boolean> & { readonly kind: 'bool' };
export type CarOption = OptionBase<CarRef | undefined> & { readonly kind: 'car' };
export type ChoiceOption<C extends string> = OptionBase<C> & { readonly kind: 'choice'; readonly choices: readonly C[] };
export type NumberOption = OptionBase<number> & { readonly kind: 'number'; readonly range: { min: number; max: number; step: number } };

/** One per-panel setting, UI-only, discriminated on `kind`: `choices` only on choice options, `range` only on number options. */
export type OptionDecl<V> =
  | (OptionBase<V> & { readonly kind: 'bool' | 'car' })
  | (OptionBase<V> & { readonly kind: 'choice'; readonly choices: readonly string[] })
  | (OptionBase<V> & { readonly kind: 'number'; readonly range: { min: number; max: number; step: number } });

export type SizeMode = { minCols: number; minRows: number };

/** The result of `declareWidget`: the static description of a widget. */
export type WidgetDecl<D extends Record<string, AnyDataDecl>, O extends Record<string, OptionDecl<unknown>>> = {
  readonly name: string;
  readonly title: string;
  readonly data: D;
  readonly options: O;
  readonly sizes: Record<string, SizeMode>;
};

/** The size a component gets (spec 4.4): the mode, cells, pixels and device pixel ratio. */
export type WidgetSize = { mode: string; cols: number; rows: number; px: { width: number; height: number }; dpr: number };

type ValueOf<D> = D extends { readonly _value?: () => infer R } ? R : never;

type DataValue<E> = E extends { readonly optional: true } ? ValueOf<E> | undefined : ValueOf<E>;

/** Maps each data entry of a declaration to the value the component gets, adding `| undefined` for `optional`. */
export type DataValues<W extends { data: Record<string, AnyDataDecl> }> = { [K in keyof W['data']]: DataValue<W['data'][K]> };

/** Maps each option of a declaration to its value type. */
export type OptionValues<W extends { options: Record<string, OptionDecl<unknown>> }> = { [K in keyof W['options']]: ValueOf<W['options'][K]> };

/**
 * The props of a widget component, derived from its declaration: each data entry typed as its value (`| undefined` when
 * optional) and each option as its value type (the same mapping as `DataValues` and `OptionValues`). The maps are written inline on purpose: through a generic alias, TypeScript
 * compares declarations instead of props and would accept a component that expects an optional value to be present.
 */
export type WidgetProps<W extends WidgetDecl<any, any>> = W extends WidgetDecl<infer D, infer O>
  ? { data: { [K in keyof D]: DataValue<D[K]> }; options: { [K in keyof O]: ValueOf<O[K]> }; size: WidgetSize; link: ResolvedLink }
  : never;

/** The lazy loader of a widget component. */
export type ComponentLoader<W extends WidgetDecl<any, any>> = () => Promise<{ default: Component<WidgetProps<W>> }>;

/** A declaration paired with its lazy component: what `register.ts` exports and the generated index collects. */
export type RegisteredWidget = {
  readonly decl: WidgetDecl<any, any>;
  readonly component: () => Promise<{ default: Component<any> }>;
};
