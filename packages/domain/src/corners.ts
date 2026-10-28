/** One value per wheel, by name. */
export type Corners<T> = { fl: T; fr: T; rl: T; rr: T };

/** Names the game's wheel order RL, RR, FL, FR; the only place that order is translated (spec 6.2). */
export const cornersFromGameOrder = <T>([rl, rr, fl, fr]: readonly [T, T, T, T]): Corners<T> => ({ fl, fr, rl, rr });
