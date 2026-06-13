/**
 * CommitComposer — the staging/commit panel for the graph view.
 *
 * Appears whenever the active worktree is open. Two modes:
 *   - "workdir": the staging UI — Unstaged / Staged groups with
 *     per-file stage/unstage toggles, group-level "all" actions,
 *     a commit message box, and the Commit button.
 *   - "commit": hands off to `<CommitInspect />` to display a
 *     different commit's metadata + file diff. Includes a "Back
 *     to working changes" affordance so the user can return to
 *     staging without losing their selection state.
 *
 * Default mode is "workdir" when there are uncommitted changes.
 * After a commit (or on a clean worktree) the panel auto-switches
 * to "commit" mode showing the new HEAD, since there's nothing
 * to stage.
 *
 * Supports multi-select via shift-click and a right-click context
 * menu with stage/stash/ignore/discard/edit actions.
 *
 * Clicking the pending node in the graph focuses the message box
 * (via the store's `focusToken`) AND switches back to "workdir"
 * mode if the user is currently inspecting another commit.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useStagingStore } from "@/stores/staging";
import { useStagingSync } from "@/hooks/useStagingSync";
import { useGraphStore } from "@/stores/graph";
import type { FileMenuTarget } from "./FileContextMenu";
import { CommitInspect } from "./CommitInspect";
import { WorkdirView } from "./WorkdirView";

export function CommitComposer() {
  const { activePath, hasUncommitted } = useStagingSync();
  const entries = useStagingStore((s) => s.entries);
  const message = useStagingStore((s) => s.message);
  const error = useStagingStore((s) => s.error);
  const committing = useStagingStore((s) => s.committing);
  const focusToken = useStagingStore((s) => s.focusToken);
  const workdirToken = useStagingStore((s) => s.workdirToken);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Multi-select state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const lastClickedPath = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<FileMenuTarget | null>(null);

  const staged = useMemo(() => entries.filter((e) => e.staged !== null), [entries]);
  const unstaged = useMemo(() => entries.filter((e) => e.unstaged !== null), [entries]);

  // Clear selection when entries change (e.g. after stage/unstage)
  useEffect(() => {
    setSelectedPaths(new Set());
    lastClickedPath.current = null;
  }, [entries]);

  // The pending graph node requests focus when clicked.
  useEffect(() => {
    if (focusToken > 0) textareaRef.current?.focus();
  }, [focusToken]);

  // The pending working-tree row in the graph was clicked: switch
  // out of commit-inspect mode (if we're in it) and focus the message
  // box. `requestWorkdir` bumps both `focusToken` and `workdirToken`,
  // so this effect covers the user's intent whether or not they were
  // already in workdir mode.
  useEffect(() => {
    if (workdirToken > 0) {
      setMode("workdir");
      textareaRef.current?.focus();
    }
  }, [workdirToken]);

  // Clear selection on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedPaths(new Set());
        setContextMenu(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** All files in display order: unstaged first, then staged. */
  const allFiles = useMemo(
    () => [
      ...unstaged.map((e) => ({ ...e, _side: "unstaged" as const })),
      ...staged.map((e) => ({ ...e, _side: "staged" as const })),
    ],
    [unstaged, staged],
  );

  /** Select a range of files between the last clicked and the target. */
  const selectRange = useCallback(
    (targetPath: string) => {
      const prev = lastClickedPath.current;
      if (!prev) {
        setSelectedPaths(new Set([targetPath]));
        lastClickedPath.current = targetPath;
        return;
      }
      const indices = new Map<string, number>();
      allFiles.forEach((f, i) => indices.set(f.path, i));
      const start = indices.get(prev);
      const end = indices.get(targetPath);
      if (start === undefined || end === undefined) return;
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const range = new Set<string>();
      for (let i = lo; i <= hi; i++) range.add(allFiles[i].path);
      setSelectedPaths(range);
    },
    [allFiles],
  );

  /** Handle right-click on a file row. */
  const handleRightClick = useCallback(
    (path: string, side: "staged" | "unstaged", e: React.MouseEvent) => {
      e.preventDefault();
      let paths: string[];
      if (selectedPaths.has(path)) {
        paths = Array.from(selectedPaths);
      } else {
        setSelectedPaths(new Set([path]));
        lastClickedPath.current = path;
        paths = [path];
      }
      setContextMenu({ paths, side, x: e.clientX, y: e.clientY });
    },
    [selectedPaths],
  );

  /** Handle regular click (no shift, no right-click). */
  const handleClick = useCallback(
    (path: string, side: "staged" | "unstaged") => {
      setSelectedPaths(new Set());
      lastClickedPath.current = path;
      const { stage, unstage } = useStagingStore.getState();
      if (side === "unstaged") {
        void stage(path);
      } else {
        void unstage(path);
      }
    },
    [],
  );

  // ── Mode state ──
  // "workdir" shows the staging UI (the home base when there are
  // uncommitted changes). "commit" hands off to <CommitInspect /> so
  // the user can browse a different commit's file diff while keeping
  // their staged work intact.
  //
  // Mode transitions:
  //   - User clicks a non-HEAD commit row in the graph
  //       → switch to "commit" so they can inspect it.
  //   - User clicks the pending working-tree row in the graph
  //       → switch back to "workdir" and focus the message box.
  //   - User clicks "Back to working changes" inside the inspect view
  //       → switch back to "workdir".
  //   - Working tree becomes clean (post-commit, or empty repo)
  //       → force "commit" (no point showing the staging UI).
  //   - Working tree gets dirty again
  //       → force "workdir".
  const { graph, selectedSha } = useGraphStore();
  const [mode, setMode] = useState<"workdir" | "commit">("workdir");
  const cleanState = !hasUncommitted && entries.length === 0;
  const headSha = graph?.head_sha ?? null;
  const selectedIsNotHead = !!selectedSha && !!headSha && selectedSha !== headSha;

  // React to graph selections: clicking any non-HEAD commit switches
  // the right pane to inspect mode. We don't switch back to "workdir"
  // on HEAD clicks because the user might just be re-inspecting HEAD
  // while their changes are still dirty — the explicit "Back" button
  // (or the pending working-tree row) is the only return path.
  useEffect(() => {
    if (selectedIsNotHead) setMode("commit");
  }, [selectedIsNotHead]);

  // Force mode based on working-tree state. Post-commit, we want the
  // new HEAD's details to be visible. When the tree gets dirty again
  // (e.g. user edits a file after coming back from inspecting history)
  // we want the staging UI back.
  useEffect(() => {
    setMode(cleanState ? "commit" : "workdir");
  }, [cleanState]);

  if (!activePath) return null;

  if (mode === "commit") {
    return (
      <section className="flex max-h-[60%] shrink-0 flex-col border-t border-white/[0.06]">
        <CommitInspect onBack={() => setMode("workdir")} />
      </section>
    );
  }

  const { stageAll, unstageAll, setMessage, commit } = useStagingStore.getState();
  const canCommit = staged.length > 0 && message.trim().length > 0 && !committing;

  return (
    <WorkdirView
      entries={entries}
      staged={staged}
      unstaged={unstaged}
      message={message}
      error={error}
      committing={committing}
      canCommit={canCommit}
      selectedPaths={selectedPaths}
      textareaRef={textareaRef}
      onMessageChange={setMessage}
      onCommit={() => void commit()}
      onStageAll={stageAll}
      onUnstageAll={unstageAll}
      onRowClick={handleClick}
      onShiftClick={selectRange}
      onRightClick={handleRightClick}
      contextMenu={contextMenu}
      onCloseContextMenu={() => setContextMenu(null)}
    />
  );
}