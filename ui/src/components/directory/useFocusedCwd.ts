import { useTerminalStore } from "@/stores/terminal";
import { findPane } from "@/lib/terminal-layout";

/** Look up the CWD of the focused terminal pane. Returns the
 * worktree path as a fallback (the initial CWD of any shell we
 * spawn). Returns `null` only when nothing is focused yet. */
export function useFocusedCwd(): string | null {
  const selectedWorktree = useTerminalStore((s) => s.selectedWorktree);
  const focusedPaneId = useTerminalStore((s) =>
    selectedWorktree ? s.focusedPane.get(selectedWorktree) : undefined,
  );
  const sessions = useTerminalStore((s) => s.sessions);
  const layouts = useTerminalStore((s) =>
    selectedWorktree ? s.layouts.get(selectedWorktree) : undefined,
  );

  if (!selectedWorktree) return null;

  // Walk the layout to find the focused leaf and its sessionId.
  // If the focused leaf is a filepane, fall back to the worktree
  // (we still want the explorer to render even when the user has
  // clicked into a file viewer).
  const found = layouts && focusedPaneId ? findPane(layouts, focusedPaneId) : null;
  const focusedLayout = found?.layout ?? null;
  let sessionId: number | null = null;
  if (focusedLayout && focusedLayout.kind === "pane") {
    sessionId = focusedLayout.sessionId;
  }

  if (sessionId != null) {
    const sess = sessions.get(sessionId);
    if (sess) return sess.cwd;
  }

  // Fallback: worktree path.
  return selectedWorktree;
}
