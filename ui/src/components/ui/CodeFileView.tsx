/**
 * CodeFileView — the canonical gitsu file viewer / editor.
 *
 * One component, two modes:
 *   - read-only:  no `onSave` prop. Used by the terminal directory
 *     click and the "view file at commit" affordance in the
 *     commit panel.
 *   - editable:   pass `onSave(value)`. The editor accepts
 *     keystrokes, binds ⌘S / Ctrl-S to the save callback, and
 *     emits `onChange` on every user edit so the parent can
 *     hold the current value. Used by the conflict resolver.
 *
 * The component is body-only. Headers, badges, and toolbars
 * live at the call site — every current caller already has its
 * own header. The component is responsible for:
 *   - mounting CodeMirror 6
 *   - detecting a language pack by `path`
 *   - applying the gitsu dark theme
 *   - applying optional decorations (e.g. conflict markers)
 *   - exposing `onDirtyChange` so the caller can render an
 *     "unsaved" badge in its own header.
 *
 * Call sites do not import any `@codemirror/*` package directly.
 * Language dispatch is via `lib/code-languages`; decorations are
 * gitsu-typed (`lib/conflict-decorations`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useCodeMirror } from "./useCodeMirror";
import { detectLanguage, type LanguageId } from "@/lib/code-languages";
import type { DecorationSource } from "@/lib/conflict-decorations";

export interface CodeFileViewProps {
  /** The current file content. The editor syncs to this via a
   * transaction (preserving selection + undo) when it changes. */
  value: string;

  /** File path. Used for language detection. Ignored when
   * `language` is set explicitly. */
  path?: string;

  /** Force a specific language. Wins over `path`-based detection. */
  language?: LanguageId;

  /** Optional decoration sources (e.g. conflict-marker highlights).
   * The component re-applies them on every change. */
  decorations?: DecorationSource[];

  // ── Editable mode (presence of `onSave` opts in) ─────────
  /** When provided, the editor is editable; ⌘S / Ctrl-S invokes
   * this callback with the current value. */
  onSave?: (value: string) => void;
  /** Fired on every user edit. The component does not re-read
   * `value` after a self-induced change, so the parent can
   * safely `setState` here without an echo loop. */
  onChange?: (value: string) => void;
  /** Fired when the doc transitions between dirty and clean
   * (where "clean" means equal to the last `value` that did
   * not originate from `onChange`). Use to drive an
   * "unsaved changes" badge in the caller's header. */
  onDirtyChange?: (dirty: boolean) => void;

  /** Tailwind classes appended to the host wrapper. The editor
   * itself fills the wrapper. */
  className?: string;

  /** Placeholder message while the editor is empty. */
  emptyMessage?: string;
}

export function CodeFileView({
  value,
  path,
  language,
  decorations,
  onSave,
  onChange,
  onDirtyChange,
  className,
  emptyMessage = "Empty file",
}: CodeFileViewProps) {
  const readOnly = !onSave;

  // Resolve the language once per (path, language-prop) change.
  // `useCodeMirror` re-configures the language compartment when
  // this id flips.
  const resolvedLanguage: LanguageId = useMemo(
    () => language ?? (path ? detectLanguage(path) : "plaintext"),
    [path, language],
  );

  // Latest-callback refs so the editor can call them without
  // forcing a reconfigure on every render. Mirrors the
  // `useCodeMirror` internal pattern, kept here for the
  // dirty-tracking effect.
  const onChangeRef = useRef(onChange);
  const onDirtyRef = useRef(onDirtyChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onDirtyRef.current = onDirtyChange;
  }, [onDirtyChange]);

  // Track dirty state. We compare the latest `onChange`-emitted
  // value to the latest prop value: when the user is editing,
  // `onChange` fires and updates parent state, which round-trips
  // as the `value` prop; on the next render `value` will match
  // the editor's doc, so `dirty` becomes false. When the parent
  // sets `value` to something new (e.g. a new file loaded), the
  // editor's current doc diverges from `value`, and `dirty`
  // flips true. We compute it on every change without storing
  // it in state — the only output is the `onDirtyChange` callback.
  useEffect(() => {
    // The hook below runs on every render and compares the
    // editor's current doc to the prop. The `lastEmitted` ref
    // tracks the value we last sent up via `onChange`; the
    // editor's current doc equals `value` whenever the parent
    // has caught up.
    const lastEmitted = lastEmittedRef.current;
    const propMatchesEmitted = lastEmitted !== null && lastEmitted === value;
    onDirtyRef.current?.(!propMatchesEmitted);
  }, [value]);

  // The last value we sent up via `onChange`. The editor's
  // current doc is always equal to this when the prop is in
  // sync. (When the prop is *not* in sync, the editor is
  // mid-update and we treat that as "not dirty".)
  const lastEmittedRef = useRef<string | null>(value);

  // Wrapper around onChange that also updates `lastEmittedRef`.
  // This is the single chokepoint for the dirty calculation.
  const handleChange = useMemo(
    () => (next: string) => {
      lastEmittedRef.current = next;
      onChangeRef.current?.(next);
    },
    [],
  );

  // Local state for "had a load failure". Surfaced as a small
  // text overlay so the user knows syntax highlighting is off.
  const [loadError, setLoadError] = useState<string | null>(null);

  const decorationsArr = useMemo(() => decorations ?? [], [decorations]);

  const { containerRef } = useCodeMirror({
    value,
    language: resolvedLanguage,
    readOnly,
    decorations: decorationsArr,
    onChange: onChange ? handleChange : undefined,
    onSave,
    onLanguageError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(`Syntax highlighting unavailable (${msg})`);
    },
  });

  return (
    <div
      className={[
        "relative h-full w-full min-h-0 min-w-0 overflow-hidden bg-transparent",
        className ?? "",
      ].join(" ")}
    >
      <div ref={containerRef} className="h-full w-full overflow-auto" />
      {value.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-fg-muted">
          {emptyMessage}
        </div>
      )}
      {loadError && (
        <div
          title={loadError}
          className="pointer-events-none absolute bottom-1 right-2 rounded bg-bg-subtle/80 px-2 py-0.5 text-[10px] text-fg-muted"
        >
          no highlight
        </div>
      )}
    </div>
  );
}
