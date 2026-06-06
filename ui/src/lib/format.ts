/**
 * Pure display formatters shared across the UI. No React, no IO —
 * keep these dependency-free so they stay trivially testable.
 */

/** Truncate `s` to at most `n` chars, appending an ellipsis. */
export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Compact relative time for a Unix-seconds timestamp ("now", "5m",
 * "3h", "2d", then a localized short date). Used by the commit graph.
 */
export function relativeTime(unixSecs: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSecs));
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  if (diff < 86400 * 365)
    return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
}

/**
 * Relative time for a Unix-**milliseconds** timestamp, phrased as
 * "just now" / "12s ago" / "3m ago". Used for repo "last opened" labels.
 */
export function secondsAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  return `${m}m ago`;
}

/** Human-readable file size (e.g. 1.2K, 3.4M). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/** Shorten an absolute path to fit a ~48-char budget, keeping the tail. */
export function shortenPath(p: string): string {
  if (p.length <= 48) return p;
  return `…${p.slice(p.length - 47)}`;
}
