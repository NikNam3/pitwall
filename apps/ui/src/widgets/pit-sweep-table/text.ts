// STUB (test phase, SP4.3b2 Task 14): the shape the tests assume of the pit-sweep table's wording (mockup gen.mjs
// `TEXT.sweep`); every value but the option's label throws `not implemented` until the implement phase writes it.
// No sentence in the panel; hovers may be phrases.

/** A stand-in that throws `not implemented` when read (so each test fails on its own, not at import). */
const notImplemented = <T>(): T => {
  const fail = (): never => {
    throw new Error('not implemented');
  };
  return new Proxy(fail, { get: fail, apply: fail, has: fail }) as T;
};

/** The compound option's label (the declaration reads it at import; gen.mjs `option`). */
export const compound = 'compound';
/** The option's choice labels: `auto`, then the compound letters `S`, `M`, `H`, `I`, `W`. */
export const compoundChoice: Record<'auto' | 'soft' | 'medium' | 'hard' | 'inter' | 'wet', string> = notImplemented();
/** Column headers after the compound cell: `REJ`, `TRF`, `E[POS]`, `P(GAIN)`, `LIFE`. */
export const headers: { rej: string; trf: string; ePos: string; pGain: string; life: string } = notImplemented();
/** The compound cell's hover: resolved by `auto` (pit-window's next compound) or set in the panel options. */
export const compoundHover: { auto: string; set: string } = notImplemented();
/** The LIFE mark `■` and its hover. */
export const lifeMark: string = notImplemented();
export const lifeHover: string = notImplemented();
