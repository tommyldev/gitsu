# gitsu — architecture

A worktree-first Git desktop client built on top of [worktrunk](https://worktrunk.dev).

## One-liner

gitsu is a **thin native GUI over the `wt` CLI**. We don't re-implement
worktree lifecycle, hooks, LLM commits, or merge workflows in Rust. We
shell out to `wt --format=json` for every worktree-level operation and
spend our energy on the parts worktrunk intentionally doesn't do: visual
commit DAG, diff viewer, file history, conflict editor, terminal, file
tree.

## The two reasons to choose this approach

1. **It keeps the GUI honest.** When worktrunk changes its merge
   pipeline, hook UX, approval flow, or LLM integration, gitsu benefits
   without a single line of code change. We are a presentation layer
   over the canonical CLI.

2. **It keeps the project scope-able.** The competitive landscape has
   ~10 worktree-first Git clients, all with the same
   `Tauri + React + libgit2 + commit graph` core. Most of them
   duplicate worktrunk's hook/merge logic in Rust. We don't.

## Stack

| Layer        | Choice                                                                                |
|--------------|---------------------------------------------------------------------------------------|
| Shell        | Tauri 2 (Rust stable)                                                                 |
| Frontend     | React 19 + TypeScript + Vite + Tailwind v3 + Zustand                                 |
| Git engine   | Hybrid: `wt` sidecar (worktree lifecycle) + `git2`/libgit2 (read-heavy visualization) |
| Terminal     | xterm.js 6 + `portable-pty` (one PTY per worktree, M5)                                |
| Editor       | CodeMirror 6 (diff, merge editor, file view)                                          |
| Graph        | Custom SVG/Canvas DAG (no off-the-shelf graph lib)                                    |
| Storage      | SQLite via `rusqlite` (notepad, settings, recents, LLM cache)                        |
| Watcher      | `notify` + polling fallback                                                          |
| Distribution | Tauri's bundler with `wt` as a sidecar; .dmg / .msi / .deb / .AppImage / .rpm        |

## Architecture diagram

```
┌────────────────────────── React (Vite + TS + Tailwind + Zustand) ──────────────────────────┐
│                                                                                            │
│  ┌─── Sidebar ───┐ ┌──── Center (Graph + Commit Panel) ────┐ ┌──── Right (Inspector) ────┐ │
│  │ Worktrees     │ │                                       │ │ File tree / Diff / Blame   │ │
│  │ Repos         │ │  Commit DAG (custom SVG/Canvas)       │ │                            │ │
│  │ Branches      │ │  Tabs: Graph · Log · PRs · Files      │ │                            │ │
│  │ Hooks         │ │                                       │ │                            │ │
│  │               │ │                                       │ │                            │ │
│  └───────────────┘ └───────────────────────────────────────┘ └────────────────────────────┘ │
│  ┌────────────────────────── Bottom Strip (collapsible) ─────────────────────────────┐     │
│  │  Terminal (xterm.js) │ Hooks Log │ Dev Server │ Conflicts  │  ← one tab per wt  │     │
│  └───────────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                            │
│  Cmd+K Command Palette · ⌘1/⌘2/⌘3 layouts · ⌘N new worktree · ⌘⇧M merge to default        │
└──────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                       │ tauri::invoke (typed) │ tauri events (stream)
┌──────────────────────────────────────┴─────────────────────────────────────────────────────┐
│                                          Tauri 2 (Rust)                                       │
│                                                                                              │
│   ┌─── worktrunk-sidecar ───┐  ┌─── git2 (libgit2) ───┐  ┌─── pty (portable-pty) ───┐         │
│   │ spawn `wt --format=json │  │ log / dag / diff     │  │ xterm.js sessions, one   │         │
│   │  wt list / switch /     │  │ blame / status       │  │ PTY per worktree,        │         │
│   │  merge / remove / hook  │  │  (read-heavy, fast)  │  │ auto-killed on remove    │         │
│   │  step / config state    │  │                      │  │                           │         │
│   └─────────────────────────┘  └──────────────────────┘  └───────────────────────────┘         │
│                                                                                              │
│   ┌─── watcher (notify) ──┐  ┌─── sqlite (rusqlite) ──┐  ┌─── fs (env / cache copy) ─┐       │
│   │ .git/ refs/index       │  │ per-worktree notepad  │  │ trigger wt step           │       │
│   │ per-worktree .git +    │  │ LLM commit cache      │  │ copy-ignored via hook    │       │
│   │ FS for untracked       │  │ settings / theme      │  │                           │       │
│   └────────────────────────┘  └────────────────────────┘  └───────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                   │                              │
                            ┌──────┴──────┐                 ┌──────┴──────┐
                            │  wt binary  │                 │  system git │
                            │  (sidecar)  │                 │  (libgit2)  │
                            └─────────────┘                 └─────────────┘
```

## Module layout

### Rust (`src-tauri/src/`)

- **`worktrunk/`** — the sidecar wrapper. Always passes `--format=json`,
  always spawns in the worktree's CWD, captures `stdout` for parsing and
  `stderr` for error messages. Typed wrappers for every `wt` subcommand
  gitsu uses. `sidecar.rs` handles binary resolution, version parsing,
  and the minimum-version pin.
- **`git/`** — libgit2 wrappers. `graph.rs` (DAG construction + lane
  assignment), `diff.rs` (workdir/index/tree diffs), `blame.rs` (per-line
  attribution), `status.rs` (porcelain-v2 parser).
- **`pty.rs`** — `portable-pty` manager. One PTY per worktree. Background
  reader thread → tokio mpsc → Tauri event → xterm.js in the frontend.
  M5.
- **`watcher.rs`** — `notify`-based FS + `.git` internals watcher.
  Triggers a "refresh sooner" signal. v1.1 swaps the polling loop in
  the frontend for event-based refresh.
- **`store.rs`** — `rusqlite` persistence. v1 schema: `recent_repos`,
  `worktree_notes` (M5+), `settings` (theme/layout/keybinds), `llm_cache`
  (M3+).
- **`agents.rs`** — Detect claude / codex / opencode processes bound to
  a worktree. Cross-platform via `ps` + `/proc`/`lsof`/`Get-Process`.
  v1.1.
- **`ipc.rs`** — Tauri command surface. The single contract surface
  with the React frontend. Every command is documented in
  `docs/IPC.md`.

### React (`ui/src/`)

- **`stores/`** — Zustand stores. `repo.ts` (current repo, worktrees,
  recents, polling), `graph.ts` (DAG nodes, selection), `hooks.ts`
  (hook config), `merge.ts` (merge/conflict phase machine), `prefs.ts`
  (panel toggles — persisted via `zustand/middleware`), `directory.ts`
  (file-tree cache), and `terminal/` — the PTY store sliced into
  `pty.ts` (session lifecycle) + `layout.ts` (split/pane tree) +
  `types.ts`, composed in `index.ts`.
- **`components/`** — One folder per feature area: `layout/` (app shell:
  `Header`, `Home`, `Dashboard`, `ResizablePane`), `worktree/`, `graph/`,
  `commit/`, `terminal/`, `directory/`, `hooks/`, `merge/`, `palette/`,
  `settings/`, `ui/`. Feature-specific hooks are co-located in the
  feature folder (e.g. `graph/useGitActions.ts`).
- **`hooks/`** — Cross-cutting hooks not tied to one feature:
  `useGlobalHotkeys.ts` (the app-wide keydown listener) and
  `useTerminalActions.ts` (command-palette terminal helpers).
- **`lib/`** — Pure helpers + typed Tauri command wrappers.
  `errors.ts` (`parseError` + `WtRpcError`/`IpcError`), `format.ts`
  (time/size/path formatters), `diff.ts` (unified-diff parser),
  `terminal-layout.ts` (`Layout` type + pure tree ops), `dag.ts` (lane
  assignment), `worktree.ts` (display/sort helpers), `tauri.ts` (one
  typed async fn per IPC command), and `types/` (domain types split by
  milestone behind a barrel, keeping `@/lib/types` stable).

See **`docs/CONVENTIONS.md`** for the full file-structure, component,
and state-management conventions.

## Worktree-first UX rules

1. **Worktrees are the primary unit of organization.** Branches without
   worktrees are secondary. The default view of any repo is the
   worktree list, not a branch list.
2. **Polling is the source of truth for v1; events are the optimization.**
   The `useRepoStore` polls `wt list --format=json` every 3s. The
   watcher (v1.1) wakes the poll early on `.git` changes.
3. **Per-worktree state, not per-repo state.** The terminal, the
   commit panel's file tree, the diff viewer — all are scoped to the
   currently selected worktree. Switching worktrees changes the
   underlying `wt`-addressed path; nothing is "stuck on main".
4. **The `wt` hook system is first-class.** "Bring over `.env` &
   build caches" is a checkbox on the create-worktree dialog that
   writes a `post-start` hook to `.config/wt.toml`. Editing hooks is
   a first-class UI (M6).
5. **Approvals are explicit.** Worktrunk's "needs approval to execute
   N commands" prompt is surfaced as a modal in gitsu — we never
   auto-approve, but we make it easy to remember the choice.

## Worktrunk integration (the spine)

`WtClient` in `src-tauri/src/worktrunk/mod.rs` is a thin async wrapper
around the sidecar. The full mapping of UI affordance → `wt` invocation
lives in `docs/WORKTRUNK_INTEGRATION.md` and is the single source of
truth. The contract:

1. **Always pass `--format=json`.** Never parse colored terminal
   output. If a field isn't in JSON, propose it upstream in worktrunk.
2. **Never call the interactive picker** (`wt switch` with no args).
   gitsu has its own dashboard.
3. **TTY vs non-TTY:** spawn non-TTY for non-interactive commands; the
   frontend handles its own interactive surfaces (terminal, conflict
   editor).
4. **Approvals prompt:** capture stderr, surface a structured approval
   request to the frontend via a Tauri event.
5. **Working directory:** every `wt` call runs in the target worktree
   path, never in gitsu's own CWD.
6. **Version pin:** gitsu's release is paired with a specific `wt`
   version. The sidecar script fetches the matching release at build
   time.

## Phased delivery

| Phase | Scope                                                            | Status  |
|-------|------------------------------------------------------------------|---------|
| **M0** | Tauri scaffold + `wt` sidecar + open repo + version check        | ✓ done |
| **M1** | Worktree dashboard (list, create, remove) + polling refresh      | ✓ done |
| **M2** | Visual commit DAG (custom SVG/Canvas) + lane assignment          | next   |
| **M3** | Commit panel + diff viewer + LLM commit message                 |        |
| **M4** | `.env` + cache auto-copy via post-start hook installer          |        |
| **M5** | Per-worktree terminal (xterm.js + portable-pty)                  |        |
| **M6** | Hooks manager (list, edit, run manually, approvals)             |        |
| **M7** | Merge workflow (`wt merge` integration + conflict preview)       |        |
| **M8** | 3-pane merge conflict editor                                    |        |
| **M9** | Command palette, polish, auto-update, signing, distribution      |        |

## Distribution

`scripts/download-wt.sh` is run during `cargo tauri build`. It:

1. Reads the target triple from the build env
2. Fetches the matching `wt` release from
   `https://github.com/max-sixty/worktrunk/releases`
3. Verifies SHA-256 against a vendored manifest
4. Drops the binary into `src-tauri/binaries/wt-<triple>` (Tauri's
   sidecar convention)
5. `tauri.conf.json` registers it as `bundle.externalBin`

The app:

- On first launch, runs `wt --version`; if it fails (binary
  missing/corrupt), re-runs the downloader in the background and
  shows a non-blocking banner.
- Periodically checks for `wt` updates (matches the app's
  auto-update channel) and prompts.
- Settings has a "Reinstall worktrunk" button.

This means **users never need to `cargo install worktrunk`** — gitsu
ships a known-good `wt` with the same UX guarantees as a bundled
dependency.

## Open architectural questions (with current answers)

1. **Switching worktrees from a Tauri webview is not `cd`.**
   → Keep all git/terminal ops addressed by path (matches `wt`).
   → Per-worktree xterm.js tab. gitsu doesn't try to follow your
   iTerm session.
2. **Three-pane merge editor scope.** → M8. If it slips, M7 has an
   external `git mergetool` fallback.
3. **Agent session detection.** → v1.1 (OS-specific process
   inspection).
4. **Libgit2 vs system git for reads.** → libgit2 for graph / diff /
   blame / status; shell `git` for interactive rebase, submodules,
   anything libgit2 can't do.
5. **LLM commit / conflict resolution.** → LLM commit reuses
   `wt step commit`'s LLM config; conflict-AI uses an explicit API
   key configured in onboarding (with a "use system default" path).
