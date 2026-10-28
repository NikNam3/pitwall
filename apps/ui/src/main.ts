import { mount, unmount } from 'svelte';
import App from './App.svelte';
import { DEFAULT_THEME } from './shell/default-theme.ts';
import { applyTheme } from './theme/index.ts';
import './theme/base.css';

const target = document.getElementById('app');
if (!target) throw new Error('index.html has no #app element');

// Before the first paint: base.css reads the --pw-* variables.
applyTheme(DEFAULT_THEME, document.documentElement);

const app = mount(App, { target });

// A hot update replaces the page's modules: close the old connection with the old App.
import.meta.hot?.dispose(() => {
  void unmount(app);
});
