/**
 * useConflictResolver — resolution state + IPC orchestration, extracted from ConflictEditor.
 */

import { useCallback, useEffect, useState } from "react";
import { mergeConflictParts, mergeListUnresolvedConflicts, mergeStageResolution } from "@/lib/tauri";
import { type ConflictParts } from "@/lib/types";
import { parseError } from "@/lib/errors";
import { useMergeStore } from "@/stores/merge";

export function useConflictResolver() {
  const context = useMergeStore((s) => s.context);

  const [paths, setPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [parts, setParts] = useState<ConflictParts | null>(null);
  const [content, setContent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  // Load the list of unresolved conflicts when the editor opens.
  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await mergeListUnresolvedConflicts(context.worktree);
        if (!cancelled) {
          setPaths(list);
          setSelected(list[0] ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(parseError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context]);

  // Load the conflict parts whenever the selected path changes.
  useEffect(() => {
    if (!context || !selected) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await mergeConflictParts(context.worktree, selected);
        if (!cancelled) {
          setParts(p);
          setContent(p.working ?? "");
        }
      } catch (e) {
        if (!cancelled) setError(parseError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context, selected]);

  const markResolved = useCallback(async () => {
    if (!context || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await mergeStageResolution(context.worktree, selected, content);
      const hasMarkers = content.includes("<<<<<<<");
      const next = new Set(resolved);
      next.add(selected);
      setResolved(next);
      const remaining = paths.filter((p) => !next.has(p));
      setPaths(remaining);
      if (hasMarkers) {
        setError(
          `Heads up: ${selected} still contains conflict markers. ` +
            `Re-run \`wt merge ${context.targetBranch}\` once the markers are gone.`,
        );
      }
      setSelected(remaining[0] ?? null);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setBusy(false);
    }
  }, [context, selected, content, resolved, paths]);

  const useOurs = useCallback(() => {
    if (!parts?.ours) return;
    setContent(parts.ours);
  }, [parts]);

  const useTheirs = useCallback(() => {
    if (!parts?.theirs) return;
    setContent(parts.theirs);
  }, [parts]);

  const useBase = useCallback(() => {
    if (parts?.base === null || parts?.base === undefined) return;
    setContent(parts.base);
  }, [parts]);

  const complete = useCallback(() => {
    if (!context) return;
    void useMergeStore.getState().completeMerge({});
  }, [context]);

  return {
    paths,
    selected,
    parts,
    content,
    busy,
    error,
    resolved,
    setSelected,
    setContent,
    markResolved,
    useOurs,
    useTheirs,
    useBase,
    completeMerge: complete,
  };
}
