// The slot names of a car's saved plans (SP4.3d spec §5); `plans.ts` re-exports them.

/** The plan slots of one car (SP4.3d spec §5): two alternatives, a third, and two game-plan slots. */
export const PLAN_SLOTS = ['A', 'B', 'C', 'G1', 'G2'] as const;
export type Slot = (typeof PLAN_SLOTS)[number];
