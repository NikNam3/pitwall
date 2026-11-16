// The one stats helper of the analysis package (SP4.3c Task 2, C43): the median, the lower median of whole places and
// the robust σ from the median absolute deviation. None sorts its input in place; an empty input has none
// (`undefined`, never 0, C3), and each caller decides what that means for it.

/** Up to this many values `sortedCopy` sorts by insertion (most inputs are small windows); above it with `Array.prototype.sort`. */
const INSERTION_SORT_MAX = 16;

/** `xs` sorted ascending, as a fresh array; stable, as `sort((a, b) => a - b)` is. */
function sortedCopy(xs: ArrayLike<number>): number[] {
  const values = Array.from(xs);
  if (values.length > INSERTION_SORT_MAX) return values.sort((a, b) => a - b);
  for (let i = 1; i < values.length; i++) {
    const v = values[i] as number;
    let j = i - 1;
    for (; j >= 0 && (values[j] as number) > v; j--) values[j + 1] = values[j] as number;
    values[j + 1] = v;
  }
  return values;
}

/** The median of `xs`: the middle value, the mean of the two middles for an even count; `undefined` when empty. */
export function median(xs: ArrayLike<number>): number | undefined {
  if (xs.length === 0) return undefined;
  const sorted = sortedCopy(xs);
  const mid = sorted.length >> 1;
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] as number) + upper) / 2;
}

/** The lower middle value of `xs` (a median of whole places, such as positions); `undefined` when empty. */
export function lowerMedian(xs: ArrayLike<number>): number | undefined {
  if (xs.length === 0) return undefined;
  return sortedCopy(xs)[(xs.length - 1) >> 1];
}

/** 1.4826 × the median absolute deviation of `xs` from their median: the robust σ of a normal sample; `undefined` when empty. */
export function madSigma(xs: ArrayLike<number>): number | undefined {
  const centre = median(xs);
  if (centre === undefined) return undefined;
  return 1.4826 * (median(Array.from(xs, (x) => Math.abs(x - centre))) as number);
}
