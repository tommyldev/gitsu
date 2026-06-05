# gitsu

A worktree-first Git desktop client built on top of
[worktrunk](https://worktrunk.dev). Every branch gets its own folder,
its own terminal, its own state — all in one native window.

> **Status: M0 + M1 (worktree dashboard).** Visual commit graph,
> diff viewer, and merge conflict editor land in M2 / M3 / M8.

## Why

`git worktree` is the most powerful feature most developers never use.
Worktrunk makes worktrees as easy as branches in the terminal; gitsu
adds the visual layer GitKraken users expect — commit graph, diff
viewer, file history, conflict editor — with worktrees as the primary
unit of organization.

## Quick start

```sh
# install deps
npm install

# download the worktrunk sidecar for your platform
bash scripts/download-wt.sh

# launch the app (dev)
npm run tauri:dev
```

Requires: Node 22+, Rust 1.77+, Tauri 2 system deps for your OS. The
`wt` sidecar is fetched and pinned to a specific worktrunk version
(0.56.0 by default).

## Architecture

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full
design, [`docs/IPC.md`](./docs/IPC.md) for the Tauri command surface,
and [`docs/WORKTRUNK_INTEGRATION.md`](./docs/WORKTRUNK_INTEGRATION.md)
for the mapping from UI → `wt` invocation.

## License

MIT — see [LICENSE](./LICENSE).
