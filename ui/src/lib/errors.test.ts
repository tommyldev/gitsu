import { describe, it, expect } from "vitest";
import { parseError, WtRpcError } from "@/lib/errors";

describe("WtRpcError", () => {
  it("carries kind + message and is named", () => {
    const err = new WtRpcError({ kind: "invalid_argument", message: "bad input" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WtRpcError");
    expect(err.kind).toBe("invalid_argument");
    expect(err.message).toBe("bad input");
  });
});

describe("parseError", () => {
  it("unwraps a WtRpcError to its message", () => {
    expect(parseError(new WtRpcError({ kind: "io", message: "disk full" }))).toBe("disk full");
  });

  it("reads `.message` off a plain object", () => {
    expect(parseError({ kind: "x", message: "object message" })).toBe("object message");
  });

  it("returns a raw string unchanged", () => {
    expect(parseError("just a string")).toBe("just a string");
  });

  it("stringifies non-string primitives", () => {
    expect(parseError(42)).toBe("42");
    expect(parseError(null)).toBe("null");
    expect(parseError(undefined)).toBe("undefined");
  });

  it("falls back to String() for objects without a message", () => {
    expect(parseError({ kind: "x" })).toBe("[object Object]");
  });
});
