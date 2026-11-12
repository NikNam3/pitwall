// `tyre-life` "as of frame N" (SP4.3a spec 6.1, Task 15c): the calculator's output from the projection cut at N and the
// situation at N, with the run's fixed inputs; the scheduled run calls it at the current frame (`asOfNow`).
import type { AsOfView } from '@pitwall/engine/readers';
import type { TyreLifeOutput } from './types.ts';

/** `tyre-life`'s output as of the view's frame. */
export function tyreLifeAsOf(_view: AsOfView): TyreLifeOutput {
  throw new Error('not implemented');
}
