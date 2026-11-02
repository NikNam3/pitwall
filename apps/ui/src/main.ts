import { mount, unmount } from 'svelte';
import App from './App.svelte';
import { applyTheme, DEFAULT_THEME } from './theme/index.ts';
import './theme/base.css';

const target = document.getElementById('app');
if (!target) throw new Error('index.html has no #app element');

// Before the first paint: base.css reads the --pw-* variables.
applyTheme(DEFAULT_THEME, document.documentElement);

/** The gallery exists in dev builds and in builds made with `VITE_PITWALL_GALLERY=1`; production bundles drop it. */
const galleryEnabled = import.meta.env.DEV || import.meta.env.VITE_PITWALL_GALLERY === '1';

const isGallery = galleryEnabled && location.pathname === '/gallery';
// The app window never scrolls as a page (theme/base.css); the gallery is a long page that does.
if (!isGallery) document.documentElement.classList.add('pw-window');

const app = isGallery
  ? import('./gallery/Gallery.svelte').then((m) => mount(m.default, { target }))
  : Promise.resolve(mount(App, { target }));

// A hot update replaces the page's modules: close the old connection with the old App.
import.meta.hot?.dispose(() => {
  void app.then((mounted) => unmount(mounted));
});
