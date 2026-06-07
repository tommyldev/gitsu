import { describe, it, expect } from "vitest";
import { Language, LanguageSupport } from "@codemirror/language";
import { getLanguagePack, type LanguageId } from "./code-languages";
import { highlightTokens } from "./highlight";

async function loadLang(id: LanguageId): Promise<Language> {
  const ext = await getLanguagePack(id)!.load();
  return ext instanceof LanguageSupport ? ext.language : (ext as Language);
}

describe("highlightTokens", () => {
  it("is lossless — joined token text equals the input", async () => {
    const lang = await loadLang("typescript");
    const code = "const x = greet('hi') + 42;";
    const toks = highlightTokens(code, lang);
    expect(toks.map((t) => t.text).join("")).toBe(code);
  });

  it("styles keywords, strings and numbers", async () => {
    const lang = await loadLang("typescript");
    const toks = highlightTokens("const x = 'hi' + 42;", lang);
    const colorOf = (s: string) =>
      toks.find((t) => t.text === s)?.style?.color;
    expect(colorOf("const")).toBeTruthy();
    expect(colorOf("'hi'")).toBeTruthy();
    expect(colorOf("42")).toBeTruthy();
    // Whitespace / bare identifier gaps stay unstyled.
    expect(toks.some((t) => t.style === undefined)).toBe(true);
  });

  it("returns an empty array for an empty line", async () => {
    const lang = await loadLang("typescript");
    expect(highlightTokens("", lang)).toEqual([]);
  });

  it("highlights a stream-language (shell) losslessly", async () => {
    const lang = await loadLang("shell");
    const code = "echo $HOME # note";
    const toks = highlightTokens(code, lang);
    expect(toks.map((t) => t.text).join("")).toBe(code);
  });
});
