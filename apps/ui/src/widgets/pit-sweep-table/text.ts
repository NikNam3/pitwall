// Wording of the pit-sweep-table display (mockup docs/design/2026-11-12-sp4.3b/pit-sweep-table.html, gen.mjs
// `TEXT.sweep`); text shared with the kit lives in kit/text.ts. No sentence in the panel; hovers may be phrases.

/** The compound option's label (gen.mjs `option`). */
export const compound = 'compound';
/** The option's choice labels: `auto`, then the compound letters `S`, `M`, `H`, `I`, `W` (the mockup's popover). */
export const compoundChoice: Record<'auto' | 'soft' | 'medium' | 'hard' | 'inter' | 'wet', string> = {
  auto: 'auto',
  soft: 'S',
  medium: 'M',
  hard: 'H',
  inter: 'I',
  wet: 'W',
};
/** Column headers after the compound cell: `REJ`, `TRF`, `E[POS]`, `P(GAIN)`, `LIFE`. */
export const headers = { rej: 'REJ', trf: 'TRF', ePos: 'E[POS]', pGain: 'P(GAIN)', life: 'LIFE' };
/** The compound cell's hover: resolved by `auto` (pit-window's next compound) or set in the panel options. */
export const compoundHover = { auto: "auto · pit-window's next compound", set: 'set in the panel options' };
/** The LIFE mark `■` and its hover. */
export const lifeMark = '■';
export const lifeHover = 'the stint passes its tyre life';
