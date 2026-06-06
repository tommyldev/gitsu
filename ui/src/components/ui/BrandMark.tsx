/**
 * Brand mark — the gitsu wordmark + black-belt knot logo +
 * sumi-vermillion hanko seal (術) sitting together in the header.
 *
 * Visual identity:
 *  - 34×34 frosted brand tile holds a flat black belt knot SVG
 *    (four straps fanning from a central knot with a layered
 *    "»" chevron, matching the reference).
 *  - The hanko seal (術 — "jutsu", the art) is a small 21×21
 *    vermillion-bordered square at -7° rotation, with a soft
 *    inner glow. It is the ONLY pop of color in the chrome.
 *
 * All three pieces inherit `text-fg` for crispness; the seal has
 * its own colors (CSS classes / inline) and is the deliberate
 * accent — keep it reserved, don't add more red.
 */

import clsx from "clsx";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={clsx("flex items-center", className)}>
      <span className="brand-tile shrink-0">
        {/* Black belt knot — flat icon.
            Four straps (down-left, down-left-inner, down-right-inner,
            down-right) from a vertical knot. The knot has a layered
            "»" chevron in white. Flat angled ends, small triangular
            gaps. 24×24 viewport, scales to 34×34 tile. */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          {/* left straps */}
          <path d="M9 4 L3 22 L6 22 L10.5 8.5 Z" fill="#0c0d0f" />
          <path d="M11 4 L8 22 L11 22 L12.5 9 Z" fill="#0c0d0f" />
          {/* right straps */}
          <path d="M15 4 L21 22 L18 22 L13.5 8.5 Z" fill="#0c0d0f" />
          <path d="M13 4 L16 22 L13 22 L11.5 9 Z" fill="#0c0d0f" />
          {/* central knot */}
          <rect x="9" y="3" width="6" height="9" rx="1.4" fill="#0c0d0f" />
          {/* chevron notches (white "»") */}
          <path
            d="M10.4 5.8 L11.6 5.8 L11.1 7 L10.9 7 Z"
            fill="#f4f5f8"
            opacity="0.95"
          />
          <path
            d="M10.4 8.2 L11.6 8.2 L11.1 9.4 L10.9 9.4 Z"
            fill="#f4f5f8"
            opacity="0.95"
          />
        </svg>
      </span>
    </span>
  );
}

/** Hanko seal 術 — the single pop of sumi-vermillion. */
export function HankoSeal({ className }: { className?: string }) {
  return (
    <span className={clsx("seal", className)} aria-label="hanko 術">
      術
    </span>
  );
}
