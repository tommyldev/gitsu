import { describe, it, expect } from "vitest";
import { truncate, relativeTime, secondsAgo, formatSize, shortenPath } from "@/lib/format";

describe("truncate", () => {
  it("returns the string unchanged at or under the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("12345", 5)).toBe("12345");
  });

  it("clips to n-1 chars plus an ellipsis past the limit", () => {
    expect(truncate("123456", 5)).toBe("1234…");
    expect(truncate("hello world", 5)).toBe("hell…");
  });
});

describe("relativeTime", () => {
  const now = Math.floor(Date.now() / 1000);

  it("uses compact buckets under a day", () => {
    expect(relativeTime(now)).toBe("now");
    expect(relativeTime(now - 30)).toBe("now");
    expect(relativeTime(now - 120)).toBe("2m");
    expect(relativeTime(now - 2 * 3600)).toBe("2h");
    expect(relativeTime(now - 3 * 86400)).toBe("3d");
  });

  it("clamps future timestamps to 'now'", () => {
    expect(relativeTime(now + 1000)).toBe("now");
  });

  it("falls back to a localized date string past a week", () => {
    const v = relativeTime(now - 30 * 86400);
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
    expect(v).not.toMatch(/^\d+[mhd]$/);
  });
});

describe("secondsAgo", () => {
  it("buckets a millisecond timestamp into just-now / s / m", () => {
    const now = Date.now();
    expect(secondsAgo(now)).toBe("just now");
    expect(secondsAgo(now - 3000)).toBe("just now");
    expect(secondsAgo(now - 12000)).toBe("12s ago");
    expect(secondsAgo(now - 120000)).toBe("2m ago");
  });
});

describe("formatSize", () => {
  it("scales bytes through B/K/M/G with one decimal", () => {
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(1536)).toBe("1.5K");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5M");
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0G");
  });
});

describe("shortenPath", () => {
  it("keeps paths within the 48-char budget", () => {
    expect(shortenPath("/short/path")).toBe("/short/path");
  });

  it("ellipsizes long paths, keeping the trailing 47 chars", () => {
    const long = "/" + "a".repeat(80);
    const out = shortenPath(long);
    expect(out.startsWith("…")).toBe(true);
    expect(out).toBe("…" + long.slice(long.length - 47));
    expect(out.length).toBe(48);
  });
});
