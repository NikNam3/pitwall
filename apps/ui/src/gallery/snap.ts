// Whole-pixel placement for gallery cells whose screenshots must not depend on what is drawn above them. A cell at a
// fractional page offset is rasterised, and its screenshot box rounded, differently from one at a whole pixel.

/** Rounds an element's box up to whole pixels, so the cells that follow it start on whole pixels too. */
export function snapBox(node: HTMLElement): void {
  node.style.width = '';
  node.style.height = '';
  const box = node.getBoundingClientRect();
  node.style.width = `${Math.ceil(box.width)}px`;
  node.style.height = `${Math.ceil(box.height)}px`;
}

/** Svelte action: moves the element down by the fraction that puts its top edge on a whole page pixel, and keeps it there while the page above it changes. */
export function snapOrigin(node: HTMLElement): { destroy(): void } {
  const align = (): void => {
    node.style.marginTop = '';
    const top = node.getBoundingClientRect().top + window.scrollY;
    const shift = Math.ceil(top) - top;
    if (shift > 0) node.style.marginTop = `${shift}px`;
  };
  align();
  const observer = new ResizeObserver(align);
  observer.observe(document.body);
  return { destroy: () => observer.disconnect() };
}
