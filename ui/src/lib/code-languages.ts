/**
 * code-languages — pure registry that maps a file path to a CodeMirror
 * language extension.
 *
 * Three things live here:
 *   1. `LanguageId` — a closed set of languages the viewer can
 *      highlight. Adding a new one is a one-line registration.
 *   2. `LANGUAGE_PACKS` — the registry. Each entry knows its
 *      extensions/filenames and a *lazy* `load()` that does a
 *      dynamic `import()` of the corresponding `@codemirror/lang-*`
 *      module. Vite emits one chunk per `import()`, so the JS for
 *      a language only lands on disk when the user actually opens
 *      a file of that type.
 *   3. `detectLanguage(path)` — pure function: filename → `LanguageId`.
 *      Filename match wins over extension match (so `Dockerfile` is
 *      detected before `.file` extensions could match `file`).
 *
 * Call sites of `CodeFileView` never import `@codemirror/lang-*`
 * directly. The component dispatches against this registry.
 */

import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

export type LanguageId =
  | "javascript"
  | "typescript"
  | "tsx"
  | "python"
  | "rust"
  | "go"
  | "json"
  | "markdown"
  | "yaml"
  | "toml"
  | "shell"
  | "html"
  | "css"
  | "sql"
  | "diff"
  | "dockerfile"
  | "plaintext";

export interface LanguagePack {
  readonly id: LanguageId;
  /** Lowercase extensions (no dot) that resolve to this language. */
  readonly extensions: readonly string[];
  /** Exact basenames for files without a useful extension. */
  readonly filenames: readonly string[];
  /**
   * Lazy CM6 extension loader. The `import()` happens inside the
   * function body, so Vite can split each language into its own
   * chunk. Each call to `load()` is memoized at the pack level
   * (caller's responsibility).
   */
  readonly load: () => Promise<Extension>;
}

/**
 * The full set of languages the viewer supports. Add a new one by
 * adding a single entry here — the type system will reject unknown
 * ids at the call site.
 */
export const LANGUAGE_PACKS: readonly LanguagePack[] = [
  {
    id: "javascript",
    extensions: ["js", "mjs", "cjs"],
    filenames: [],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  },
  {
    id: "typescript",
    extensions: ["ts", "mts", "cts"],
    filenames: [],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  },
  {
    id: "tsx",
    extensions: ["tsx"],
    filenames: [],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true })),
  },
  {
    id: "python",
    extensions: ["py"],
    filenames: [],
    load: () => import("@codemirror/lang-python").then((m) => m.python()),
  },
  {
    id: "rust",
    extensions: ["rs"],
    filenames: [],
    load: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  },
  {
    id: "go",
    extensions: ["go"],
    filenames: [],
    load: () => import("@codemirror/lang-go").then((m) => m.go()),
  },
  {
    id: "json",
    extensions: ["json", "jsonc"],
    filenames: [],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  },
  {
    id: "markdown",
    extensions: ["md", "markdown"],
    filenames: [],
    load: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  },
  {
    id: "yaml",
    extensions: ["yml", "yaml"],
    filenames: [],
    load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  },
  {
    id: "toml",
    extensions: ["toml"],
    filenames: [],
    load: () =>
      import("@codemirror/legacy-modes/mode/toml").then((m) => StreamLanguage.define(m.toml)),
  },
  {
    id: "shell",
    extensions: ["sh", "bash", "zsh"],
    filenames: [],
    load: () =>
      import("@codemirror/legacy-modes/mode/shell").then((m) => StreamLanguage.define(m.shell)),
  },
  {
    id: "html",
    extensions: ["html", "htm", "svelte"],
    filenames: [],
    load: () => import("@codemirror/lang-html").then((m) => m.html()),
  },
  {
    id: "css",
    extensions: ["css"],
    filenames: [],
    load: () => import("@codemirror/lang-css").then((m) => m.css()),
  },
  {
    id: "sql",
    extensions: ["sql"],
    filenames: [],
    load: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  },
  {
    id: "diff",
    extensions: ["diff", "patch"],
    filenames: [],
    load: () =>
      import("@codemirror/legacy-modes/mode/diff").then((m) => StreamLanguage.define(m.diff)),
  },
  {
    id: "dockerfile",
    extensions: [],
    filenames: ["Dockerfile", "Containerfile", "Dockerfile.amd64", "Dockerfile.arm64"],
    load: () =>
      import("@codemirror/legacy-modes/mode/dockerfile").then((m) => StreamLanguage.define(m.dockerFile)),
  },
  {
    id: "plaintext",
    extensions: [],
    filenames: [],
    load: async () => [],
  },
];

/** O(1) lookup by id. */
const BY_ID: ReadonlyMap<LanguageId, LanguagePack> = new Map(
  LANGUAGE_PACKS.map((p) => [p.id, p]),
);

/**
 * Pure: pick the best `LanguageId` for a path.
 *
 * Filename match wins over extension match (handles `Dockerfile`
 * before any `.file` extension could match `file`). For paths
 * without a useful extension, the last dot-separated segment is
 * the extension; hidden files like `.gitignore` are treated as
 * extensionless and return `plaintext`.
 */
export function detectLanguage(path: string): LanguageId {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  if (!base) return "plaintext";
  for (const pack of LANGUAGE_PACKS) {
    if (pack.filenames.includes(base)) return pack.id;
  }
  // Hidden file with no other dot (e.g. ".gitignore") — no extension.
  if (base.startsWith(".") && !base.slice(1).includes(".")) return "plaintext";
  if (base.includes(".")) {
    const ext = base.split(".").pop()!.toLowerCase();
    for (const pack of LANGUAGE_PACKS) {
      if (pack.extensions.includes(ext)) return pack.id;
    }
  }
  return "plaintext";
}

export function getLanguagePack(id: LanguageId): LanguagePack | undefined {
  return BY_ID.get(id);
}
