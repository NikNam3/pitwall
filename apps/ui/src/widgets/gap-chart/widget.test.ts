// The gap-chart declaration's ghost data (SP4.2 spec 4, Task 13): `ghosts` reads `rejoin.ghostLines` with the gapper's
// params (the reference the panel chose), `rejoin` reads `rejoin.car` of the link's primary car; both optional, so
// without them the chart is drawn as before.
import { describe, expect, it } from 'vitest';
import { carId, feedId } from '@pitwall/domain';
import type { ParamContext } from '../../kit/types.ts';
import { widget } from './widget.ts';

const ctx = (options: Record<string, unknown>): ParamContext =>
  ({ link: { group: 1, feedId: feedId('f'), primary: carId(3), compare: [], window: { kind: 'session' } }, options }) as unknown as ParamContext;

describe('gap-chart declaration: the ghost lines', () => {
  it('reads the gapper, the cars, the session, the ghost lines and the rejoin of the primary car', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      gapper: 'gaps.gapper',
      cars: 'cars.overview',
      session: 'session.info',
      ghosts: 'rejoin.ghostLines',
      rejoin: 'rejoin.car',
    });
  });

  it('reads the ghost lines and the rejoin as optional data', () => {
    expect([widget.data.ghosts.optional, widget.data.rejoin.optional]).toEqual([true, true]);
  });

  it("asks for the ghost lines in the gapper's params, whatever reference the panel chose", () => {
    for (const options of [{}, { reference: 'carAverage', referenceCar: 5 }, { reference: 'fixed', fixedLapS: 91.2 }]) {
      expect(widget.data.ghosts.params?.(ctx(options))).toEqual(widget.data.gapper.params?.(ctx(options)));
    }
  });

  it("asks for the rejoin of the link's primary car", () => {
    expect(widget.data.rejoin.params?.(ctx({}))).toEqual({ carId: carId(3) });
  });
});
