// A car's span in a per-car sub-machine's spans (contract C15, C26, C85): a per-car sub-machine has at most one open
// span per car (C85), in slot order, so the car's span is usually the one at its slot; the slot is checked first and a
// search of the list is the fallback (a slot without a car before it shifts the rest).

/** The entry of `spans` whose `carId` is `carId`; with one entry per car, the one `find` gives. */
export const carSpanIn = <S extends { readonly carId?: number | undefined }>(spans: readonly S[] | undefined, carId: number): S | undefined => {
  if (spans === undefined) return undefined;
  const atSlot = spans[carId];
  if (atSlot !== undefined && atSlot.carId === carId) return atSlot;
  return spans.find((span) => span.carId === carId);
};
