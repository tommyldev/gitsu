/**
 * Static, per-line syntax highlighting for the unified-diff viewer.
 *
 * The "view file" toggle renders inside a live CodeMirror editor, but
 * the diff is plain DOM (so the +/- gutter, line numbers and row
 * tints compose freely). To colour the code *inside* each diff row we
 * reuse the same Lezer grammars (`code-languages`) and the same token
 * palette (`code-theme`), so a file is tinted identically in the diff
 * and in the editor.
 *
 * Highlighting is per line: each row's content is parsed on its own.
 * Multi-line constructs (block comments, template strings) won't
 * carry token state across rows — an accepted tradeoff for diffs,
 * whose rows are non-contiguous anyway.
 */

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Language, LanguageSupport } from "@codemirror/language";
import { highlightTree, tagHighlighter, type Highlighter } from "@lezer/highlight";
import { TOKEN_STYLES } from "@/lib/code-theme";
import {
  detectLanguage,
  getLanguagePack,
  type LanguageId,
} from "@/lib/code-languages";

export interface HighlightToken {
  readonly text: string;
  /** Inline token style, or undefined for unhighlighted gaps. */
  readonly style?: CSSProperties;
}

/** Build a highlighter that emits a stable key per token spec, plus
 * the inline style each key maps to. Reuses the editor's palette. */
const STYLE_BY_KEY: Record<string, CSSProperties> = {};
const HIGHLIGHTER: Highlighter = tagHighlighter(
  TOKEN_STYLES.map((s, i) => {
    const key = `tk${i}`;
    STYLE_BY_KEY[key] = {
      color: s.color,
      fontWeight: s.fontWeight as CSSProperties["fontWeight"],
      fontStyle: s.fontStyle as CSSProperties["fontStyle"],
      textDecoration: s.textDecoration,
    };
    return { tag: s.tag, class: key };
  }),
);

function styleFor(classes: string): CSSProperties | undefined {
  // `tagHighlighter` space-joins matching specs; the first wins.
  const space = classes.indexOf(" ");
  return STYLE_BY_KEY[space === -1 ? classes : classes.slice(0, space)];
}

/**
 * Tokenise one line of code into styled spans. The output always
 * covers the whole input (unstyled gaps included), so joining the
 * `text` fields reproduces `code` exactly.
 */
export function highlightTokens(
  code: string,
  language: Language,
): HighlightToken[] {
  if (code.length === 0) return [];
  const tree = language.parser.parse(code);
  const out: HighlightToken[] = [];
  let pos = 0;
  highlightTree(tree, HIGHLIGHTER, (from, to, classes) => {
    if (from > pos) out.push({ text: code.slice(pos, from) });
    out.push({ text: code.slice(from, to), style: styleFor(classes) });
    pos = to;
  });
  if (pos < code.length) out.push({ text: code.slice(pos) });
  return out;
}

// ── language loading (memoised per id) ──────────────────────────

const cache = new Map<LanguageId, Promise<Language | null>>();

function toLanguage(ext: unknown): Language | null {
  if (ext instanceof LanguageSupport) return ext.language;
  if (ext instanceof Language) return ext; // StreamLanguage extends Language
  return null;
}

function loadLanguage(id: LanguageId): Promise<Language | null> {
  let p = cache.get(id);
  if (!p) {
    const pack = getLanguagePack(id);
    p = pack ? pack.load().then(toLanguage, () => null) : Promise.resolve(null);
    cache.set(id, p);
  }
  return p;
}

export type HighlightFn = (code: string) => HighlightToken[];

/**
 * Resolve a per-line highlighter for `path`. Returns `null` until the
 * grammar chunk has loaded — and for plaintext / unknown types — so
 * callers fall back to rendering raw text.
 */
export function useHighlighter(path: string | undefined): HighlightFn | null {
  const id = path ? detectLanguage(path) : "plaintext";
  const [language, setLanguage] = useState<Language | null>(null);

  useEffect(() => {
    if (id === "plaintext") {
      setLanguage(null);
      return;
    }
    let alive = true;
    // Drop the previous grammar so we never highlight with the wrong
    // language while the new chunk is in flight.
    setLanguage(null);
    void loadLanguage(id).then((lang) => {
      if (alive) setLanguage(lang);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  return useMemo(
    () =>
      language ? (code: string) => highlightTokens(code, language) : null,
    [language],
  );
}
