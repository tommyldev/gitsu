# AGENTS.md — how AI agents (and humans) should work on this repo.

## Project at a glance

**gitsu** is a worktree-first Git desktop client built on top of
[worktrunk](https://worktrunk.dev). The architecture, scope, and
differentiator are in `docs/ARCHITECTURE.md`. The IPC contract
(every Tauri command + payload type) is in `docs/IPC.md`. The
mapping from UI affordance → `wt` invocation is in
`docs/WORKTRUNK_INTEGRATION.md`. **Read those before changing
either side of the bridge.**

## Stack

- **Shell:** Tauri 2 (Rust stable)
- **Frontend:** React 19 + TypeScript + Vite + Tailwind v3 + Zustand
- **Git engine:** hybrid — `wt` sidecar for worktree lifecycle,
  `git2` (libgit2) for read-heavy ops (graph, diff, blame, status)
- **Terminal:** xterm.js + `portable-pty` (added in M5)
- **Storage:** SQLite via `rusqlite`

## Working agreement

1. **Always pass `--format=json`** to `wt`. The GUI never parses
   colored terminal output. If `wt` doesn't expose a field in JSON,
   add it upstream in worktrunk first.
2. **Never call worktrunk's interactive picker** (`wt switch` with
   no args). gitsu has its own dashboard.
3. **Respect the IPC contract.** Adding a Tauri command = adding a
   typed wrapper in `ui/src/lib/tauri.ts` + a domain type in
   the right `ui/src/lib/types/*` module (re-exported by the barrel) +
   a doc entry in `docs/IPC.md`.
4. **Version the worktrunk sidecar.** `scripts/download-wt.sh`
   pins `WT_VERSION`. Bump intentionally, not by accident.
5. **Don't re-implement worktrunk in Rust.** The whole point of gitsu
   is to be a thin GUI over `wt`. If a feature feels like it should
   live in `wt`, propose it upstream.
6. **Run `cargo check` + `npm run typecheck` before claiming work is
   done.** Both must be clean.
7. **Follow `docs/CONVENTIONS.md`** for file structure, the ~200-line
   file-size guidance, component conventions, and the Zustand +
   Tauri/React patterns.

## Repo layout

```
src-tauri/                 Rust backend
  src/
    worktrunk/             `wt` sidecar wrapper
    git/                   libgit2 wrapper (M2+)
    pty.rs                 per-worktree PTY (M5)
    watcher.rs             FS watcher (v1.1)
    store.rs               SQLite persistence
    agents.rs              claude/codex/opencode detection (v1.1)
    ipc.rs                 Tauri command surface
    error.rs               shared error type
  binaries/                sidecar binaries (per target triple)
  icons/                   app icon set
  capabilities/            Tauri 2 permissions
  tauri.conf.json          bundle + window + sidecar config

ui/                        React frontend
  src/
    main.tsx               React + theme bootstrap
    App.tsx                shell: routing (home ↔ dashboard) + composition
    components/            one folder per feature area (+ layout/ = app shell)
    hooks/                 cross-cutting hooks (global hotkeys, palette actions)
    stores/                Zustand stores (terminal/ is sliced into pty+layout)
    lib/                   typed Tauri wrappers, errors, format, diff,
                           terminal-layout, dag, types/ (barrel)
    styles/                Tailwind + globals

scripts/                   dev tooling (sidecar downloader, etc.)
docs/                      ARCHITECTURE, CONVENTIONS, IPC, WORKTRUNK_INTEGRATION
```

## Phased delivery (M0 → M9)

See `docs/ARCHITECTURE.md` for full scope. The current phase is **M0
+ M1**: sidecar + open repo + worktree dashboard. M2 adds the
commit graph, M3 the diff viewer.

## Commands

```sh
# install deps
npm install

# typecheck frontend
npm run typecheck

# dev (Tauri window + Vite dev server)
npm run tauri:dev

# production build (per host)
npm run tauri:build

# reinstall the wt sidecar
bash scripts/download-wt.sh
```
