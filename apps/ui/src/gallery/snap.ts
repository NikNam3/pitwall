// Whole-pixel layout of the gallery. A cell at a fractional page offset is rasterised, and its screenshot box rounded,
// differently from one at a whole pixel, so a section added above a cell would change its screenshot. Every box in the
// gallery's flow is therefore rounded up to whole pixels: the cells by `snapGrid`, the headings by `snapBox`, and a cell
// whose content settles later by `snapBox` once more. The gaps and the page padding are whole pixels already (theme
// px), so every cell starts on a whole page pixel whatever is drawn above it. The gallery measures in its real font
// (`fontsLoaded`).

/** Rounds an element's box up to whole pixels (usable as a Svelte action); called again, it measures afresh. */
export function snapBox(node: HTMLElement): void {
  node.style.width = '';
  node.style.height = '';
  const box = node.getBoundingClientRect();
  node.style.width = `${Math.ceil(box.width)}px`;
  node.style.height = `${Math.ceil(box.height)}px`;
}

/**
 * Svelte action for a flex grid of gallery cells: rounds every child's box up to whole pixels once the grid and its
 * cells are mounted. Every width first, then every height, so a row whose cells stretch to the tallest is measured as
 * it wraps with the rounded widths.
 */
export function snapGrid(node: HTMLElement): void {
  // The cells' own actions (their theme variables) run in the same flush as this one: measure once they all have.
  queueMicrotask(() => {
    const cells = [...node.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
    for (const cell of cells) {
      cell.style.width = '';
      cell.style.height = '';
    }
    const widths = cells.map((cell) => cell.getBoundingClientRect().width);
    cells.forEach((cell, i) => (cell.style.width = `${Math.ceil(widths[i] ?? 0)}px`));
    const heights = cells.map((cell) => cell.getBoundingClientRect().height);
    cells.forEach((cell, i) => (cell.style.height = `${Math.ceil(heights[i] ?? 0)}px`));
  });
}

/** Resolves once every font face of the page has loaded, so whatever is measured is measured in the real font; `undefined` where fonts are not loaded (jsdom). */
export function fontsLoaded(): Promise<void> | undefined {
  const fonts = (document as { fonts?: FontFaceSet }).fonts;
  if (fonts === undefined) return undefined;
  // A face that fails to load leaves its fallback: the gallery is drawn all the same.
  return Promise.all([...fonts].map((face) => face.load())).then(
    () => undefined,
    () => undefined,
  );
}
