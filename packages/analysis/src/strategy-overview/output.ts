// The output of `strategy-overview`, in its own module so the calculator and the unit's index both import it without a cycle.
import type { CarId, StrategyOverview } from '@pitwall/domain';

/** The output: per our car its `strategyOverview.car` value (a car not competing has none). */
export type StrategyOverviewOutput = { cars: Record<CarId, StrategyOverview> };
