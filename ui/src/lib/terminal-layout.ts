/**
 * Pure layout-tree model for the terminal strip. No React, no
 * zustand, no IO — every function takes a `Layout` and returns a new
 * one (or a read-only query), so they're trivially testable and
 * reusable by the store, the strip view, the directory explorer, and
 * the App-level hotkey handler.
 *
 * Layout model: each worktree owns a `Layout` tree. Leaves are panes
 * (one PTY each) or file-viewer panes; internal nodes are splits.
 * Splits nest arbitrarily. Removing a leaf collapses its parent split
 * so the sibling takes the parent's place.
 */

export type SplitDir = "h" | "v";
/** `h` = horizontal divider → panes stack vertically; `v` = vertical divider → panes side by side. */

/**
 * A node in the layout tree. Three variants:
 *  - `"split"`: an internal node dividing two children by `ratio`.
 *  - `"pane"`: a live terminal session (`sessionId` is the backend PTY id,
 *    or `null` while it's spawning).
 *  - `"filepane"`: a read-only file viewer opened from the directory
 *    explorer. `filePath` is the absolute path; `cwd` is the terminal CWD
 *    at the moment of opening (used for "relative-to" display in the
 *    file viewer's header).
 */
export type Layout =
  | { kind: "split"; id: string; dir: SplitDir; ratio: number; a: Layout; b: Layout }
  | { kind: "pane"; id: string; sessionId: number | null }
  | { kind: "filepane"; id: string; filePath: string; cwd: string };

/** Type guard: is this a terminal pane? */
export function isTerminalPane(
  l: Layout,
): l is { kind: "pane"; id: string; sessionId: number | null } {
  return l.kind === "pane";
}

/** Type guard: is this a file viewer pane? */
export function isFilePane(
  l: Layout,
): l is { kind: "filepane"; id: string; filePath: string; cwd: string } {
  return l.kind === "filepane";
}

// ── Id allocators ───────────────────────────────────────────────

let nextTempSessionId = 1_000_000; // unlikely to collide with the backend's allocator
let nextPaneId = 1;
let nextSplitId = 1;
export const newPaneId = () => `pane-${nextPaneId++}`;
export const newSplitId = () => `split-${nextSplitId++}`;
export const newTempSessionId = () => nextTempSessionId++;

// ── Tree queries + transforms ───────────────────────────────────

/** Walk the tree to find a pane. Returns `{ layout, path }` where
 * `path` is an array of `0`/`1` indices from the root. Matches both
 * terminal panes and file viewer panes. */
export function findPane(
  layout: Layout,
  paneId: string,
  path: number[] = [],
): { layout: Layout; path: number[] } | null {
  if (layout.kind === "split") {
    const a = findPane(layout.a, paneId, [...path, 0]);
    if (a) return a;
    return findPane(layout.b, paneId, [...path, 1]);
  }
  return layout.id === paneId ? { layout, path } : null;
}

/** Find an open file viewer pane by absolute path. Returns the
 * pane layout + its tree path so the caller can focus it (no need
 * to open a duplicate). */
export function findFilePaneByPath(
  layout: Layout,
  filePath: string,
  path: number[] = [],
): { layout: Layout; path: number[] } | null {
  if (layout.kind === "split") {
    const a = findFilePaneByPath(layout.a, filePath, [...path, 0]);
    if (a) return a;
    return findFilePaneByPath(layout.b, filePath, [...path, 1]);
  }
  if (isFilePane(layout) && layout.filePath === filePath) {
    return { layout, path };
  }
  return null;
}

/** Apply `updater` to the node at `path` (array of `0`/`1` indices),
 * returning a new tree. */
export function updateAt(
  layout: Layout,
  path: number[],
  updater: (l: Layout) => Layout,
): Layout {
  if (path.length === 0) return updater(layout);
  if (layout.kind !== "split") return layout;
  const [head, ...rest] = path;
  if (head === 0) return { ...layout, a: updateAt(layout.a, rest, updater) };
  return { ...layout, b: updateAt(layout.b, rest, updater) };
}

/** Remove the pane with the given id. If removing the leaf leaves
 * a single-child split, collapse the parent. Returns the new tree,
 * or `null` if the root was the removed pane. */
export function removePane(layout: Layout, paneId: string): Layout | null {
  if (layout.kind === "split") {
    const a = removePane(layout.a, paneId);
    if (a === null) return layout.b;
    const b = removePane(layout.b, paneId);
    if (b === null) return layout.a;
    return { ...layout, a, b };
  }
  return layout.id === paneId ? null : layout;
}

/** Collect every leaf id in left-to-right pre-order. */
export function collectPaneIds(layout: Layout, out: string[] = []): string[] {
  if (layout.kind === "split") {
    collectPaneIds(layout.a, out);
    collectPaneIds(layout.b, out);
    return out;
  }
  out.push(layout.id);
  return out;
}

/** Rebuild the tree bottom-up, applying `fn` to every node. */
export function mapLayout(layout: Layout, fn: (l: Layout) => Layout): Layout {
  if (layout.kind === "split") {
    return fn({ ...layout, a: mapLayout(layout.a, fn), b: mapLayout(layout.b, fn) });
  }
  return fn(layout);
}

/** Id of the first leaf (pane or file pane) in pre-order, or `null`
 * for an empty tree (not reachable — a tree always has ≥1 leaf). */
export function firstPaneId(layout: Layout): string | null {
  if (layout.kind === "split") {
    return firstPaneId(layout.a) ?? firstPaneId(layout.b);
  }
  return layout.id;
}

/** The backend PTY id of the first terminal pane, or `null` if the
 * worktree's layout has no terminal panes (e.g. it's all file
 * viewers). */
export function firstSessionId(layout: Layout): number | null {
  if (layout.kind === "split") {
    return firstSessionId(layout.a) ?? firstSessionId(layout.b);
  }
  if (isTerminalPane(layout)) return layout.sessionId;
  return null;
}
