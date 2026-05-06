## Project

Type: vite
Deploy: github-actions (tauri release on push to main)

## Structure

src/index.html, src/main.ts, src/styles/base.css, src/settings.html, src/shared/ (sounds, fullscreen), src/views/settings/ (settings.ts, schema.ts), src-tauri/ (Rust backend)

## Rules

- Tauri 2.x desktop overlay app — no browser deploy
- Frontend uses lit-html templating, no React/Vue
- Window resize via WinAPI (no start_resize_dragging in Tauri 2.x)
- Icons: src/favicon.png + src/favicon.ico; all Tauri icon sizes in src-tauri/icons/
- Auto-commit: no
