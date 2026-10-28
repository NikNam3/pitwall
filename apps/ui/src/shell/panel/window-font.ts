// The window's one font size (spec 4.4), shared with its panels so they count character cells with it.
import { getContext, setContext } from 'svelte';
import { DEFAULT_THEME } from '../default-theme.ts';

/** The font size in px and the line height every panel of a window measures cells with. */
export type WindowFont = { readonly fontPx: number; readonly lineHeight: number };

const KEY = Symbol('window-font');

/** The theme default, for a panel rendered outside a window. */
const DEFAULT_FONT: WindowFont = { fontPx: DEFAULT_THEME.fontPx, lineHeight: DEFAULT_THEME.density.lineHeight };

/** Provides the window's font to the panels below; pass an object with getters to keep it reactive. */
export const provideWindowFont = (font: WindowFont): void => {
  setContext(KEY, font);
};

/** The window's font, or the theme default outside a window. */
export const useWindowFont = (): WindowFont => getContext<WindowFont | undefined>(KEY) ?? DEFAULT_FONT;
