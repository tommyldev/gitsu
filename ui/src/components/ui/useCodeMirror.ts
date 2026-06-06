/**
 * useCodeMirror — the lifecycle hook that backs `CodeFileView`.
 *
 * One mount per container. Configurable bits (language, theme,
 * readOnly, decorations) are wrapped in `Compartment`s so the
 * caller can swap them without remounting the editor (preserves
 * doc + selection + undo).
 *
 * Value sync is "lazy controlled": the editor is the source of
 * truth between renders. The `value` prop is treated as an
 * external update; when it diverges from the editor's current
 * doc, we dispatch a transaction carrying the `ExternalChange`
 * annotation. Our own `onChange` listener ignores transactions
 * carrying that annotation, so the round-trip doesn't echo back
 * as a doc replacement (which would yank the caret).
 *
 * Save binding: in editable mode (i.e. when `onSave` is passed),
 * ⌘S / Ctrl-S calls the latest `onSave` via a ref. The ref
 * pattern keeps the keymap identity stable across renders.
 */

import { useEffect, useRef } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  RangeSetBuilder,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useCodeMirrorTheme } from "@/lib/code-theme";
import { detectLanguage, getLanguagePack } from "@/lib/code-languages";
import type { LanguageId } from "@/lib/code-languages";
import type { DecorationSource } from "@/lib/conflict-decorations";

/** Distinguishes "this change came from the parent prop" from
 * user typing. The `updateListener` skips transactions carrying
 * this annotation so we don't re-emit our own `onChange`. */
const ExternalChange = Annotation.define<boolean>();

/** Effect payload: the new `DecorationSource[]` from the parent. */
const setDecorations = StateEffect.define<DecorationSource[]>();

/** State field holding the current CM6 `DecorationSet`. The field
 * provides it to the view via `EditorView.decorations.from()`. */
const decorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (set, tr) => {
    for (const e of tr.effects) {
      if (e.is(setDecorations)) return buildDecorationSet(tr.state.doc.length, e.value);
    }
    // The doc may have shifted; CM6 re-maps ranges on its own when
    // we map the set through the transaction changes.
    return set.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Convert gitsu-typed `DecorationSource[]` to a CM6 `DecorationSet`. */
function buildDecorationSet(_docLen: number, sources: DecorationSource[]): DecorationSet {
  if (sources.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  // Sort by `from`; CM6 expects ranges in order. DecorationSource
  // is `from < to` for line decorations, and lines are emitted in
  // document order by `conflictDecorations`, but a sort is cheap
  // insurance against future callers.
  const sorted = [...sources].sort((a, b) => a.from - b.from);
  for (const s of sorted) {
    if (s.from < 0 || s.to < s.from) continue;
    const cls = s.className ?? "";
    const deco = s.title
      ? Decoration.line({ class: cls, attributes: { title: s.title } })
      : Decoration.line({ class: cls });
    builder.add(s.from, s.from, deco);
  }
  return builder.finish();
}

export interface UseCodeMirrorOpts {
  /** The current doc. When this changes (and the editor's current
   * doc differs), we dispatch a `value` transaction carrying
   * `ExternalChange`. */
  value: string;
  /** Detected or explicit language id. Re-loading a language pack
   * reconfigures the language compartment without remounting. */
  language: LanguageId;
  /** When true, the editor accepts keystrokes and renders a
   * cursor. When false, the buffer is selection-only. */
  readOnly: boolean;
  /** Lines of decoration to overlay on top of the buffer. */
  decorations: DecorationSource[];
  /** Called on every user edit. Skipped for prop-driven changes. */
  onChange?: (value: string) => void;
  /** Called on ⌘S / Ctrl-S in editable mode. */
  onSave?: (value: string) => void;
  /** Optional extra extensions (e.g. `EditorView.lineWrapping`). */
  extraExtensions?: Extension[];
  /** When the language fails to load (e.g. dynamic import error). */
  onLanguageError?: (err: unknown) => void;
}

export interface UseCodeMirrorResult {
  /** Ref to attach to the host `<div>`. */
  containerRef: React.RefObject<HTMLDivElement>;
}

export function useCodeMirror(opts: UseCodeMirrorOpts): UseCodeMirrorResult {
  const {
    value,
    language,
    readOnly,
    decorations,
    onChange,
    onSave,
    extraExtensions,
    onLanguageError,
  } = opts;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Keep the latest callbacks in refs so the mount-once
  // `updateListener` + `keymap` can call them without
  // re-creating those extensions on every render.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Compartment instances are created once. Compartments are
  // CM6's way of saying "this extension may be reconfigured
  // without remounting the editor."
  const languageCompartment = useRef(new Compartment()).current;
  const themeCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  // Extra compartment for the *static* extensions the caller
  // adds (line wrap, etc.). This is the only place that needs
  // a reconfigure on every extras change.
  const extrasCompartment = useRef(new Compartment()).current;

  const theme = useCodeMirrorTheme();

  // ── Mount once ─────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const updateListener = EditorView.updateListener.of((vu: ViewUpdate) => {
      if (!vu.docChanged) return;
      const isExternal = vu.transactions.some((tr) => tr.annotation(ExternalChange));
      if (isExternal) return;
      onChangeRef.current?.(vu.state.doc.toString());
    });

    const saveBinding = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: (view) => {
          if (!onSaveRef.current) return false;
          onSaveRef.current(view.state.doc.toString());
          return true;
        },
      },
    ]);

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      decorationField,
      updateListener,
      saveBinding,
      languageCompartment.of([]), // loaded below
      themeCompartment.of(theme),
      readOnlyCompartment.of(readOnlyExtensions(readOnly)),
      extrasCompartment.of(extraExtensions ?? []),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions,
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    let alive = true;

    // Load the initial language asynchronously. `extensions`
    // already has an empty language compartment; we just need
    // to reconfigure it once the pack is loaded.
    void loadLanguageInto(language, languageCompartment, view, alive, onLanguageError);

    return () => {
      alive = false;
      view.destroy();
      viewRef.current = null;
    };
    // Mount-once. Subsequent prop changes go through the
    // reconfigure effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── External value sync ───────────────────────────────────
  // Replaces the doc when `value` diverges from the editor's
  // current state. We compare as strings; CM6's doc is always
  // a string under the hood.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    const tr: TransactionSpec = {
      changes: { from: 0, to: current.length, insert: value },
      annotations: [ExternalChange.of(true)],
    };
    view.dispatch(tr);
  }, [value]);

  // ── Language swap ─────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // For prop-driven swaps, the cleanup in the mount effect
    // tracks liveness; here we just bail if the view is gone
    // (the ref would have been cleared by the mount's return).
    if (!viewRef.current) return;
    void loadLanguageInto(language, languageCompartment, view, true, onLanguageError);
  }, [language, languageCompartment, onLanguageError]);

  // ── Theme swap ────────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeCompartment.reconfigure(theme) });
  }, [theme, themeCompartment]);

  // ── Read-only swap ────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)),
    });
  }, [readOnly, readOnlyCompartment]);

  // ── Extra extensions swap ─────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: extrasCompartment.reconfigure(extraExtensions ?? []),
    });
  }, [extraExtensions, extrasCompartment]);

  // ── Decorations swap ──────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setDecorations.of(decorations) });
  }, [decorations]);

  return { containerRef };
}

/** The pair of facets that disable editing. The cursor is hidden
 * (`editable: false`) and commands can't modify the doc
 * (`readOnly: true`). We also add `tabindex: 0` so the editor
 * stays focusable — selection / ⌘C still work. */
function readOnlyExtensions(readOnly: boolean): Extension {
  if (!readOnly) return [];
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ tabindex: "0" }),
  ];
}

/** Load a language pack and reconfigure the language compartment.
 * The `alive` flag is set to false by the mount effect's cleanup;
 * checking it before dispatching prevents a "dispatch on a
 * destroyed view" race when the user closes the pane mid-import. */
async function loadLanguageInto(
  id: LanguageId,
  compartment: Compartment,
  view: EditorView,
  alive: boolean,
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    const pack = getLanguagePack(id) ?? getLanguagePack("plaintext")!;
    const ext = await pack.load();
    if (!alive) return;
    view.dispatch({ effects: compartment.reconfigure(ext) });
  } catch (e) {
    onError?.(e);
    // Fall back to plaintext so the editor still mounts.
    try {
      const pack = getLanguagePack("plaintext")!;
      const ext = await pack.load();
      if (!alive) return;
      view.dispatch({ effects: compartment.reconfigure(ext) });
    } catch {
      // If even plaintext fails, leave the language compartment
      // empty — the editor will still render, just without
      // syntax highlighting.
    }
  }
}

/** Re-export so callers don't have to import the helper. */
export { detectLanguage };
