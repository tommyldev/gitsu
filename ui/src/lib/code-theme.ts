/**
 * code-theme — the gitsu CodeMirror theme.
 *
 * One theme (dark) for v1. The `useCodeMirrorTheme()` hook is
 * shaped to grow into a light variant when the `theme` field in
 * `usePrefsStore` lands.
 *
 * The colors mirror the Tailwind tokens in `tailwind.config.js`
 * (bg-bg, fg, fg-muted, accent, …) by literal hex. If the palette
 * ever changes, both files need a one-line update — acceptable
 * coupling for v1.
 *
 * The `EditorView.theme({…})` object controls the *chrome*
 * (background, gutters, cursor, selection, scrollbar). The
 * `HighlightStyle.define([…])` object controls the *tokens*
 * (keyword, string, comment, …). Both go into the same
 * `Compartment` so a future theme switch is one `reconfigure`.
 */

import { useMemo } from "react";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t, type Tag } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import { usePrefsStore } from "@/stores/prefs";

/** Chrome theme — matches the gitsu dark surface. */
const GITSU_DARK = EditorView.theme(
  {
    "&": {
      color: "#F4F5F8",
      backgroundColor: "transparent",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily:
        "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "12px",
      lineHeight: "1.55",
    },
    ".cm-content": {
      caretColor: "#c8cdd6",
      padding: "8px 0",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "#5C616B",
      border: "none",
      borderRight: "1px solid rgba(255,255,255,0.04)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.02)" },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(255,255,255,0.02)",
      color: "#F4F5F8",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#c8cdd6" },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(200,205,214,0.18)",
    },
    ".cm-scroller::-webkit-scrollbar": { width: "10px", height: "10px" },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      backgroundColor: "rgba(255,255,255,0.08)",
      borderRadius: "5px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "rgba(255,255,255,0.16)",
    },
  },
  { dark: true },
);

/** Token colors — semantic, palette-anchored. Shared with the
 * static diff highlighter (`lib/highlight.ts`) so a file is tinted
 * identically in the editor and in the unified-diff view. */
export interface TokenStyle {
  tag: Tag | readonly Tag[];
  color: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
}

export const TOKEN_STYLES: readonly TokenStyle[] = [
  { tag: t.keyword, color: "#c8cdd6", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "#4CAF50" },
  { tag: t.number, color: "#FFA726" },
  { tag: t.bool, color: "#FFA726" },
  { tag: t.comment, color: "#5C616B", fontStyle: "italic" },
  { tag: t.variableName, color: "#F4F5F8" },
  { tag: t.typeName, color: "#94a8c4" },
  { tag: t.className, color: "#94a8c4" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#c8cdd6" },
  { tag: t.propertyName, color: "#F4F5F8" },
  { tag: [t.operator, t.punctuation], color: "#8A8F98" },
  { tag: t.url, color: "#4CAF50", textDecoration: "underline" },
  { tag: t.invalid, color: "#EF5350" },
];

/** Token colors as a CodeMirror highlight style for the editor. */
const DARK_HIGHLIGHT = HighlightStyle.define(TOKEN_STYLES as TokenStyle[]);

/** The single dark theme extension array. */
const DARK_THEME: Extension = [GITSU_DARK, syntaxHighlighting(DARK_HIGHLIGHT)];

/**
 * Returns the active CodeMirror theme extensions. Re-runs only
 * when the prefs `theme` field changes; the returned array is
 * stable across unrelated state updates.
 *
 * v1 is dark-only. When the light variant lands, the conditional
 * returns `DARK_THEME` or a new `LIGHT_THEME` based on the
 * field, and the Compartment in `useCodeMirror` reconfigures
 * without remounting.
 */
export function useCodeMirrorTheme(): Extension {
  const theme = usePrefsStore((s) => s.theme);
  // For v1, dark is the only choice. The dependency on `theme`
  // is wired now so a future light variant only needs to extend
  // this hook — no caller changes.
  return useMemo(() => DARK_THEME, [theme]);
}
