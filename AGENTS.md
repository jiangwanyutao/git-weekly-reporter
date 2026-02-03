# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## What this repo is
A cross-platform desktop app built with **Tauri 2** (Rust) + a **Vite + React + TypeScript** frontend.

Note: `README.md` describes a Next.js-based plan, but the current implementation is Vite + React Router (`src/App.tsx`).

## Common commands
Package manager: this repo is set up for **pnpm** (`pnpm-lock.yaml`).

### Install
```bash
pnpm install
```

### Run (web-only / mock mode)
Runs Vite in the browser. In this mode the app uses mock Git logs (see `src/lib/git.ts` and its `__TAURI_INTERNALS__` check).
```bash
pnpm dev
# alias
pnpm web:dev
```

### Run (desktop app)
Runs Tauri + Vite together.
```bash
pnpm tauri:dev
```

### Build (frontend)
```bash
pnpm build
pnpm preview
```

### Build (desktop installer/bundle)
```bash
pnpm tauri:build
```

### Typecheck
There is no dedicated `lint` or `test` script in `package.json` right now.

Typechecking happens as part of `pnpm build` (it runs `tsc` first). If you want just a typecheck without producing `dist/`:
```bash
pnpm exec tsc -p tsconfig.json --noEmit
```

### Updater signing keys / updater artifacts
Tauri updater is configured in `src-tauri/tauri.conf.json` (endpoints + public key). The repo includes `tauri-signing.key` / `.pub` at the root, and also has a helper script:
```bash
pnpm updater:keys
```

## High-level architecture

### Runtime split: Tauri vs Web
Many features are gated by checking whether the app is running inside Tauri:
- Tauri detection pattern: `typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window`
- In **web mode**, Git log fetching and project selection use mock behavior.
- In **Tauri mode**, the app can:
  - open OS dialogs (`@tauri-apps/plugin-dialog`)
  - read/write files (`@tauri-apps/plugin-fs`)
  - run subprocesses (`@tauri-apps/plugin-shell`) to call `git`
  - self-update via `@tauri-apps/plugin-updater`

### Frontend entry + routing
- Entry point: `src/main.tsx` renders `src/App.tsx`.
- Routing: `react-router-dom` with 3 main pages:
  - `src/pages/Dashboard.tsx` (fetch commits, stream AI output, save report)
  - `src/pages/History.tsx` (browse/export saved reports)
  - `src/pages/Settings.tsx` (projects + GLM key/prompt + updater UI)

### State management (single store)
Global state is handled by a persisted Zustand store:
- `src/store/index.ts`
  - `projects`: list of Git repos to scan (path + name + optional alias)
  - `settings`: author filter + GLM API key + prompt template + auto-generate options
  - `reports`: generated reports history
Persistence key: `git-weekly-reporter-storage`.

Types live in `src/types/index.ts`.

### Git data flow
Git is accessed from the frontend using the Tauri shell plugin (not Rust):
- `src/lib/git.ts`
  - `fetchGitLogs(...)`: runs `git -C <path> log ...` and parses stdout
  - also fetches current branch via `git rev-parse --abbrev-ref HEAD`
  - returns `CommitLog[]` including `project` and `branch`
  - in web mode returns a small mock list

Dashboard flow:
1. Read `projects` + `settings.authorName` from Zustand.
2. For each project, call `fetchGitLogs` and combine/sort.
3. Group logs by project for display.

### AI report generation (GLM)
- `src/lib/glm.ts` calls Zhipu/GLM chat completions endpoint with **streaming** output.
- `Dashboard.tsx` builds `commitsText` (prefixes each message with `[project]`) and streams:
  - report content (shown in preview)
  - reasoning content (shown in the “AI elements” widgets)
- The generated report is saved into `useAppStore().reports` with metadata (date range, projects, branches, commit count).

### Desktop shell/windowing
- Custom title bar + window controls: `src/components/TitleBar.tsx` (`@tauri-apps/api/window`).
- Sidebar + navigation: `src/components/app-sidebar.tsx`.

### Tauri (Rust) side
Rust is currently minimal:
- `src-tauri/src/main.rs` calls `git_weekly_reporter_lib::run()`.
- `src-tauri/src/lib.rs` sets up plugins and registers the `greet` command.
Most app logic (git, AI, storage) currently lives in the TypeScript frontend.

## Key config locations
- Vite config (Tauri-tuned dev server, `@` alias, port 1420): `vite.config.ts`
- Tauri app/build/updater config: `src-tauri/tauri.conf.json`
- shadcn/ui config + TS path aliases: `components.json`
