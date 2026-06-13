/**
 * Brand mark — the gitsu wordmark tile in the header.
 *
 * Visual identity: a 34×34 frosted steel tile holding a minimal
 * branch glyph (trunk node forking to a branch node), drawn in a
 * single light stroke. Monochrome — the chrome has no accent color.
 */

import clsx from "clsx";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={clsx("flex items-center", className)}>
      <span className="brand-tile shrink-0">
        {/* Branch glyph — trunk on the left, fork curving to a
            branch node top-right. 24×24 viewport, scales to the
            34×34 tile. */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#e8eaee"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="8" cy="6" r="2.4" />
          <circle cx="8" cy="18" r="2.4" />
          <circle cx="17" cy="7.5" r="2.4" />
          <path d="M8 8.4v7.2" />
          <path d="M16 9.7c-1.6 2.6-4.6 2.5-5.9 3.6" opacity="0.9" />
        </svg>
      </span>
    </span>
  );
}
