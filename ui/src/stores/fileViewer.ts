/**
 * Zustand store: the file whose diff is shown in the main view.
 *
 * Clicking a file in the commit panel's file list opens it here; the
 * dashboard then renders the diff in the center (where the graph
 * lives) instead of the narrow right-hand panel. `null` file means
 * the graph is shown.
 *
 * `repo` + `commitSha` are captured at open time so `FileFocus` can
 * fetch the historical blob for its "view file" toggle (commitSha is
 * `null` in working-tree mode).
 */

import { create } from "zustand";
import type { FileDiff } from "@/lib/types";

interface FileViewerState {
  file: FileDiff | null;
  repo: string;
  commitSha: string | null;
  open: (file: FileDiff, repo: string, commitSha: string | null) => void;
  close: () => void;
}

export const useFileViewerStore = create<FileViewerState>((set) => ({
  file: null,
  repo: "",
  commitSha: null,
  open: (file, repo, commitSha) => set({ file, repo, commitSha }),
  close: () => set({ file: null }),
}));
