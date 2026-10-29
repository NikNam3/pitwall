// A clock that stands still, for gallery cells that print the time of day (the inspector's `updated` column).

/** 12:00:00 local time: the same text on every machine and in every time zone. */
const FIXED = new Date(2026, 0, 1, 12, 0, 0).getTime();

/** Makes `new Date()` and `Date.now()` return a fixed moment until the returned function is called. Nothing else in the UI reads the wall clock. */
export function freezeClock(): () => void {
  const Real = globalThis.Date;
  class Frozen extends Real {
    constructor(...args: [] | [number | string | Date]) {
      if (args.length === 0) super(FIXED);
      else super(args[0] as number);
    }
    static override now(): number {
      return FIXED;
    }
  }
  globalThis.Date = Frozen as DateConstructor;
  return () => {
    globalThis.Date = Real;
  };
}
