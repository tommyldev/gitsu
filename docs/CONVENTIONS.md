# gitsu — conventions

How the gitsu frontend is organized and why. This is the source of
truth for file structure, file size, component shape, and the
Zustand + Tauri/React patterns. `docs/ARCHITECTURE.md` covers the
*what* (scope, milestones, the Rust↔React bridge); this covers the
*how*.

Stack reality (keep this honest): **React 18.3**, **TypeScript**
(strict, `noUnusedLocals`/`noUnusedParameters` on), **Vite**,
**Tailwind v3**, **Zustand 5**, **Vitest**. Path alias `@/* →
ui/src/*` — always import via `@/…`, never deep relative chains like
`../../../lib`.

---

## 1. Directory structure

Feature-first. One folder per feature area under `components/`; shared
primitives in `lib/`; one Zustand store per domain in `stores/`.

```
ui/src/
  App.tsx                shell: store wiring + routing (home ↔ dashboard) + composition
  main.tsx               React + theme bootstrap
  hooks/                 cross-cutting hooks (not tied to one feature)
    useGlobalHotkeys.ts    the app-wide keydown listener
    useTerminalActions.ts  command-palette terminal/worktree helpers
  lib/                   pure, dependency-light helpers + the IPC layer
    tauri.ts               one typed async fn per Tauri command
    errors.ts              parseError + WtRpcError + IpcError
    format.ts              time/size/path formatters
    diff.ts                unified-diff patch parser
    terminal-layout.ts     Layout type + pure split/pane tree ops
    dag.ts                 commit-graph lane assignment
    worktree.ts            worktree display/sort helpers
    types/                 domain types split by milestone, behind a barrel
      index.ts  worktree.ts  repo.ts  graph.ts  diff.ts  merge.ts  hooks.ts  pty.ts
  stores/                Zustand stores (one per domain)
    repo.ts  graph.ts  hooks.ts  merge.ts  prefs.ts  directory.ts
    terminal/              the PTY store, sliced (see §4)
      index.ts  pty.ts  layout.ts  types.ts
  components/
    layout/                app shell: Header, Home, Dashboard, ResizablePane
    worktree/ graph/ commit/ terminal/ directory/ hooks/ merge/ palette/ settings/ ui/
  styles/                Tailwind + globals
```

**Rules**

- **Cross-cutting hooks** live in `ui/src/hooks/`. **Feature-specific
  hooks** are co-located in the feature folder (e.g.
  `components/graph/useGitActions.ts`,
  `components/merge/useConflictResolver.ts`).
- **No `index.ts` barrels for components.** Barrels blur Vite's HMR
  boundaries and defeat tree-shaking. Import the concrete file:
  `import { CommitGraph } from "@/components/graph/CommitGraph"`.
  The *only* sanctioned barrel is `lib/types/index.ts` (type-only
  aggregation, so `@/lib/types` stays a stable import path).
- **Keep public import paths stable.** When you split a file, the
  primary export keeps its name and path so callers don't churn (e.g.
  `CommitGraph.tsx` still `export function CommitGraph`; the directory
  store still resolves at `@/stores/terminal`).

---

## 2. File-size policy

`~/.gemini/GEMINI.md` sets a **~200-line soft cap** per front-end and
back-end file. Treat it as a smell threshold, not a hard limit:

- **Split when a file has more than one reason to change.** A 230-line
  component with a single cohesive responsibility is fine; a 180-line
  file doing three unrelated things is not.
- **Composition roots may run larger.** A file whose job is to wire
  pieces together (`App.tsx`, `CommitGraph.tsx`) legitimately lands
  ~250–300 lines. Don't fragment a cohesive switch/dispatcher just to
  hit a number (`useGlobalHotkeys.ts` is one flat hotkey table).
- **Rust `#[cfg(test)]` modules stay in-file.** Idiomatic Rust keeps
  unit tests beside the code; the cap does not apply to them. Rust
  source modularization (e.g. splitting `ipc.rs` by domain) is
  *recommended* but optional and orthogonal to this guide.
- **When you split, move code verbatim.** Structure refactors must not
  change behavior. Extract pure logic into `lib/`, sub-components into
  sibling files, and imperative helpers into co-located hooks.

---

## 3. Component conventions

- **Feature folders, flat within.** Sub-components extracted from a big
  component live next to it (`commit/CommitHeader.tsx`,
  `commit/FileFocus.tsx`, `commit/UnifiedDiff.tsx`), imported with
  relative paths (`./CommitHeader`).
- **Presentational vs wired.** Push presentational pieces (Header,
  Home, ResizablePane) down to props-only components; keep store wiring
  in the composition root or a hook. The shell (`App.tsx`) owns store
  subscriptions and hands children plain callbacks.
- **Hooks encapsulate effects + imperative logic.** A large `useEffect`
  (the global keydown listener) or a cluster of imperative handlers
  (terminal actions, conflict resolution) belongs in a named hook, not
  inline in the component body.
- **Pure logic leaves the component.** Formatters, parsers, and tree
  walkers go to `lib/` (`format.ts`, `diff.ts`, `terminal-layout.ts`)
  so they're shared and unit-tested. There is exactly one `parseError`,
  one `parsePatch`, one set of layout walkers — never re-derive them.

---

## 4. State management — Zustand

We use **Zustand 5** and are staying on it. It gives us the imperative
`getState()` we need for event-driven PTY/IPC code without the
boilerplate of Redux or the provider-tree churn of Context. Patterns:

**Subscribe with selectors, not the whole store.** A bare
`useStore()` re-renders on every state change. Select the slice you
render:

```ts
const repo = useRepoStore((s) => s.repo);          // ✓ re-renders on repo only
const { repo, recents } = useRepoStore();          // ✗ re-renders on any change
```

(`App.tsx` destructures the repo store because it genuinely reads most
of it; leaf components should select.)

**Slice large stores.** When a store outgrows one responsibility,
split it into slice creators composed in an `index.ts`. The terminal
store is `pty.ts` (session lifecycle) + `layout.ts` (split/pane tree),
each a `StateCreator<TerminalState, [], [], Slice>`, composed with:

```ts
export const useTerminalStore = create<TerminalState>((...a) => ({
  ...createPtySlice(...a),
  ...createLayoutSlice(...a),
}));
```

Slices share the same `set`/`get` over the combined state, so a layout
action can read sessions and vice-versa. Keep the public store API
unchanged across a slice refactor.

**Actions own async; read with `getState()`.** Side effects (IPC
calls, event subscriptions) live *inside* store actions, not in
components. For imperative reads that must not subscribe (event
handlers, hotkeys), use `useStore.getState()`:

```ts
const wt = useTerminalStore.getState().selectedWorktree ?? repo.path;
```

**Extract pure logic out of stores.** A store should orchestrate state;
the algorithms it calls should be pure and testable. The terminal
store delegates every tree transform to `@/lib/terminal-layout`
(`findPane`, `removePane`, `mapLayout`, …) — those have unit tests; the
store does not need them.

**Persist prefs/recents with `persist`.** Use `zustand/middleware`'s
`persist` instead of hand-rolled localStorage. `partialize` to persist
only data (never action functions); supply a `storage` adapter when you
need backward compatibility with an older on-disk shape (see
`stores/prefs.ts`):

```ts
export const usePrefsStore = create<PrefsState>()(
  persist(
    (set, get) => ({ /* state + actions */ }),
    { name: "gitsu:prefs:v1", partialize: (s) => ({ hideGraphPanel: s.hideGraphPanel /* … */ }) },
  ),
);
```

**Why not X?** *Redux/RTK*: too much boilerplate for a single-window
desktop app. *Jotai/Recoil*: atom graphs don't buy us much over a
handful of domain stores. *TanStack Query*: our "server" is a local
sidecar polled every 3s and pushed via Tauri events — Zustand actions
model that fine. *Context*: fine for static config, but re-renders the
whole subtree on change and lacks `getState()` for imperative reads.

---

## 5. Tauri + React

**One typed wrapper per command.** `ipc.rs` is the contract; every
`#[tauri::command]` gets a typed async fn in `lib/tauri.ts`. Call sites
use the wrapper, never a stringly-typed `invoke("name", { … })`:

```ts
// lib/tauri.ts
export const graphBuild = (repo: string, refName: string | null, maxCount: number) =>
  invoke<CommitGraph>("graph_build", { repo, refName, maxCount });

// call site
const graph = await graphBuild(repo.path, null, MAX_COMMITS);
```

Argument keys stay camelCase in the wrapper — Tauri maps them to the
Rust snake_case params. `invoke<T>` remains exported as a low-level
escape hatch, but new code extends the wrapper list. Adding a command
means: Rust command → typed wrapper in `tauri.ts` → type in
`lib/types/*` → entry in `docs/IPC.md`.

**Normalize errors through `lib/errors`.** Catch IPC rejections and run
them through `parseError(e)` for a display string; never hand-format
error text per call site.

**Always clean up event listeners.** `listen()` returns an unlisten
fn; store it and call it on teardown (pane close, repo clear, PTY
exit). The terminal store owns its `pty:data`/`pty:exit`/`pty:cwd`
subscriptions and tears them down in `closePane`/`clear` so output is
captured even when no view is mounted.

**Keep heavy work in Rust.** Graph walks, diffs, blame, and filesystem
scans run in libgit2/Rust and cross the bridge as typed payloads. The
frontend renders; it doesn't compute.

**Polling is the v1 source of truth; events are the optimization.**
`useRepoStore` polls `wt list --format=json`; the FS watcher (v1.1)
wakes the poll early. PTY output is already event-driven
(`pty:data:<id>`). Prefer migrating hot paths from poll → event over
shortening poll intervals.

---

## 6. Verification

Before claiming work done (per `AGENTS.md`):

- `npm run typecheck` — clean (strict).
- `npm test` — Vitest; add pure-logic tests for anything you extract
  into `lib/` (see `lib/*.test.ts`). Test behavior and edge values, not
  the current default config.
- `cargo check` — clean when you touch Rust.
- Behavior-preserving refactors must keep tests green without rewriting
  them to match new internals.
