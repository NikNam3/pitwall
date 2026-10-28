// Type-level tests: `pnpm typecheck` (apps/ui `check`) is the signal; the `@ts-expect-error` lines fail the build if they compile.
// The component-mismatch case uses a typed stand-in `Component<...>` from svelte, not a .svelte file.
import type { CurrentLaps } from '@pitwall/domain';
import type { SessionInfo } from '@pitwall/contracts';
import { carId } from '@pitwall/domain';
import type { Component } from 'svelte';
import { describe, expectTypeOf, it } from 'vitest';
import { lapsFold } from '../../src/kit/folds.ts';
import { declareWidget, folded, optional, registerWidget, topic } from '../../src/kit/define-widget.ts';
import { boolOption, carOption, choiceOption, numberOption } from '../../src/kit/options.ts';
import type { ResolvedLink, WidgetProps, WidgetSize } from '../../src/kit/types.ts';
import type { CarRef } from '@pitwall/contracts';

const sizes = { compact: { minCols: 28, minRows: 4 } };

const required = declareWidget({ name: 'a', title: 'A', data: { x: topic('session.info') }, sizes });
const optionalDecl = declareWidget({ name: 'b', title: 'B', data: { x: optional(topic('session.info')) }, sizes });
const foldedDecl = declareWidget({ name: 'c', title: 'C', data: { x: folded('laps', lapsFold) }, sizes });
const withOptions = declareWidget({
  name: 'd',
  title: 'D',
  data: { x: topic('session.info') },
  options: {
    flag: boolOption(true, 'Flag'),
    mode: choiceOption(['ahead', 'behind', 'both'] as const, 'both', 'Neighbours'),
    count: numberOption(5, 'Count', { min: 1, max: 10, step: 1 }),
    car: carOption('Car'),
  },
  sizes,
});

describe('WidgetProps', () => {
  it('types a required topic as its value', () => {
    expectTypeOf<WidgetProps<typeof required>['data']['x']>().toEqualTypeOf<SessionInfo>();
  });
  it('adds undefined for optional()', () => {
    expectTypeOf<WidgetProps<typeof optionalDecl>['data']['x']>().toEqualTypeOf<SessionInfo | undefined>();
  });
  it('types folded(laps, lapsFold) as CurrentLaps', () => {
    expectTypeOf<WidgetProps<typeof foldedDecl>['data']['x']>().toEqualTypeOf<CurrentLaps>();
  });
  it('types options from their constructors', () => {
    type O = WidgetProps<typeof withOptions>['options'];
    expectTypeOf<O['flag']>().toEqualTypeOf<boolean>();
    expectTypeOf<O['mode']>().toEqualTypeOf<'ahead' | 'behind' | 'both'>();
    expectTypeOf<O['count']>().toEqualTypeOf<number>();
    expectTypeOf<O['car']>().toEqualTypeOf<CarRef | undefined>();
  });
  it('carries size and link', () => {
    expectTypeOf<WidgetProps<typeof required>['size']>().toEqualTypeOf<WidgetSize>();
    expectTypeOf<WidgetProps<typeof required>['link']>().toEqualTypeOf<ResolvedLink>();
  });
  it('rejects undeclared options and data', () => {
    type P = WidgetProps<typeof withOptions>;
    // @ts-expect-error `missing` is no declared option
    expectTypeOf<P['options']['missing']>().toBeNever();
    // @ts-expect-error `missing` is no declared data entry
    expectTypeOf<P['data']['missing']>().toBeNever();
  });
});

describe('topic names and params', () => {
  it('rejects an unknown topic name', () => {
    // @ts-expect-error no such topic
    topic('no.such.topic');
    // @ts-expect-error no such topic
    folded('no.such.topic', lapsFold);
  });
  it('rejects params of the wrong shape', () => {
    // @ts-expect-error carId must be a CarId, not a string
    topic('car.detail', () => ({ carId: 'x' }));
    topic('car.detail', ({ link }) => ({ carId: link.primary }));
    topic('car.detail', () => ({ carId: carId(1) }));
  });
  it('passes link and options to the params function', () => {
    topic('car.detail', (ctx) => {
      expectTypeOf(ctx.link).toEqualTypeOf<ResolvedLink>();
      expectTypeOf(ctx.options).toEqualTypeOf<Readonly<Record<string, unknown>>>();
      return { carId: ctx.link.primary };
    });
  });
  it('rejects a fold whose entries do not match the topic', () => {
    // @ts-expect-error the lapsFold folds LapRecord entries, not SessionInfo
    folded('session.info', lapsFold);
  });
});

describe('registerWidget', () => {
  it('accepts a component whose props match', () => {
    const ok = async () => ({ default: null as unknown as Component<WidgetProps<typeof required>> });
    registerWidget(required, ok);
  });
  it('rejects a component whose props do not match', () => {
    const bad = async () => ({ default: null as unknown as Component<{ wrong: number }> });
    // @ts-expect-error the component's props are not WidgetProps of the declaration
    registerWidget(required, bad);
  });
});
