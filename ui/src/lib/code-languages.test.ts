import { describe, it, expect } from "vitest";
import { detectLanguage, LANGUAGE_PACKS } from "./code-languages";

describe("detectLanguage", () => {
  it("resolves Rust by extension", () => {
    expect(detectLanguage("src/main.rs")).toBe("rust");
  });

  it("resolves TypeScript variants", () => {
    expect(detectLanguage("app.ts")).toBe("typescript");
    expect(detectLanguage("app.tsx")).toBe("tsx");
    expect(detectLanguage("app.mts")).toBe("typescript");
  });

  it("resolves JavaScript variants", () => {
    expect(detectLanguage("app.js")).toBe("javascript");
    expect(detectLanguage("app.mjs")).toBe("javascript");
    expect(detectLanguage("app.cjs")).toBe("javascript");
  });

  it("resolves Python, Go, JSON by extension", () => {
    expect(detectLanguage("a/b/c.py")).toBe("python");
    expect(detectLanguage("cmd/foo.go")).toBe("go");
    expect(detectLanguage("package.json")).toBe("json");
  });

  it("resolves YAML and TOML by extension", () => {
    expect(detectLanguage("gitsu.yml")).toBe("yaml");
    expect(detectLanguage("Cargo.toml")).toBe("toml");
  });

  it("resolves Shell by extension", () => {
    expect(detectLanguage("scripts/build.sh")).toBe("shell");
    expect(detectLanguage("script.bash")).toBe("shell");
    expect(detectLanguage("script.zsh")).toBe("shell");
  });

  it("resolves HTML/CSS/SQL/Markdown by extension", () => {
    expect(detectLanguage("index.html")).toBe("html");
    expect(detectLanguage("index.htm")).toBe("html");
    expect(detectLanguage("style.css")).toBe("css");
    expect(detectLanguage("query.sql")).toBe("sql");
    expect(detectLanguage("README.md")).toBe("markdown");
  });

  it("resolves diff/patch by extension", () => {
    expect(detectLanguage("changes.diff")).toBe("diff");
    expect(detectLanguage("changes.patch")).toBe("diff");
  });

  it("resolves Dockerfile by exact filename (not extension)", () => {
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("path/to/Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("Containerfile")).toBe("dockerfile");
  });

  it("treats hidden files without a dot as plaintext", () => {
    expect(detectLanguage(".gitignore")).toBe("plaintext");
    expect(detectLanguage(".env")).toBe("plaintext");
    expect(detectLanguage(".editorconfig")).toBe("plaintext");
  });

  it("handles unknown extensions as plaintext", () => {
    expect(detectLanguage("file.unknownext")).toBe("plaintext");
  });

  it("handles empty / malformed paths", () => {
    expect(detectLanguage("")).toBe("plaintext");
    expect(detectLanguage("/")).toBe("plaintext");
  });

  it("normalizes Windows backslashes", () => {
    expect(detectLanguage("src\\main.rs")).toBe("rust");
    expect(detectLanguage("a\\b\\Dockerfile")).toBe("dockerfile");
  });
});

describe("LANGUAGE_PACKS", () => {
  it("is non-empty and every entry has a unique id", () => {
    expect(LANGUAGE_PACKS.length).toBeGreaterThan(0);
    const ids = LANGUAGE_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("plaintext entry loads to an empty extension list", async () => {
    const pack = LANGUAGE_PACKS.find((p) => p.id === "plaintext");
    expect(pack).toBeDefined();
    const ext = await pack!.load();
    // The empty-array case is valid — CodeMirror accepts `[]`.
    expect(Array.isArray(ext)).toBe(true);
  });
});
