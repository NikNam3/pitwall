# 0010: Electron as the host, UI host-agnostic

## Status

Accepted (2026-10-28). UI shell spec 7.1.

## Context

The engineer works on several screens. The panel must open as native windows at their saved places, ignore browser shortcuts (`Ctrl+W`, `Ctrl+R`, `F5`, `Alt+Left`, `Alt+Right`, `Ctrl+Shift+I`) so a mis-key never closes or reloads a window mid-race, and start or attach to the bridge. The UI must also run in a plain browser (development, a second PC, tests).

## Decision

- **Electron hosts the UI** (`apps/desktop`). It imports no workspace package; it only shows `apps/ui/dist` (or the Vite URL with `--dev`) with `?window=<id>&ws=<PITWALL_WS_PORT>`.
- **The UI stays host-agnostic.** Everything host-specific goes through the `Host` type (`apps/ui/src/shell/host/`). `getHost()` returns the Electron host when the preload script exposed `window.pitwallHost`, otherwise the browser host. The UI never imports Electron.
- **Window placement is pure.** `window-manager.ts` plans open, close and move from the desired windows, the open ones and the attached displays, and clamps a geometry on a missing or mostly off-screen display into the primary work area. Electron calls stay in `main.ts`.
- **The bridge is attached or started.** `bridge-process.ts` probes `ws://127.0.0.1:<PITWALL_WS_PORT>` for 500 ms; if nothing answers it spawns `pitwall live` (or the command after `--`) and stops it on quit. A bridge it attached to is never stopped. In this repository `pitwall` runs as the root script `pnpm -s pitwall`.
- **Security:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the preload exposes four members only (`windowId`, `ensureWindows`, `onGeometry`, `openPath`). Geometry reports are throttled to one per 500 ms per window.

## Why not Tauri

- Tauri uses the system WebView: WebKitGTK on Linux, WebView2 or WKWebView elsewhere. Rendering, `uPlot` canvas performance and CSS then differ per platform and distribution, which a dense, colour-critical tool cannot afford.
- Per-window geometry across several displays and blocking browser shortcuts are first-class in Electron; in Tauri they need a Rust plugin each, and the project is TypeScript only.
- A Rust toolchain would join the build for friends who only want to run the panel.
- The cost, a larger download, is accepted: the tool is installed once on a desktop.

## Consequences

- The Electron binary is downloaded by its install script; with pnpm's build-script policy it must be allowed once (`pnpm approve-builds`).
- Any later host (Tauri, a kiosk browser) only needs to implement `Host`.
