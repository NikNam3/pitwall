// The test-only widget set the shell tests pass in place of `WIDGETS`.
import type { RegisteredWidget } from '../../../src/kit/types.ts';
import computed from './computed/register.ts';
import linkProbe from './link-probe/register.ts';
import probe from './probe/register.ts';
import sizeProbe from './size-probe/register.ts';
import stale from './stale/register.ts';

export const TEST_WIDGETS: RegisteredWidget[] = [probe, stale, computed, linkProbe, sizeProbe];
export const TEST_WIDGET_MAP: ReadonlyMap<string, RegisteredWidget['decl']> = new Map(TEST_WIDGETS.map((w) => [w.decl.name, w.decl]));
