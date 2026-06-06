/**
 * ResizablePane — a fixed-width side pane with a draggable divider.
 * `side` is the edge the splitter sits on (and the direction a drag
 * grows the pane). Extracted from App.
 */

import React from "react";

export function ResizablePane({
  width,
  min,
  max,
  onResize,
  side,
  children,
}: {
  width: number;
  min: number;
  max: number;
  onResize: (w: number) => void;
  side: "left" | "right";
  children: React.ReactNode;
}) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = side === "right" ? startW + dx : startW - dx;
      onResize(Math.max(min, Math.min(max, next)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  return (
    <div
      className="relative h-full overflow-auto border-white/[0.06] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.15)]"
      style={{
        width,
        flexShrink: 0,
        borderRightWidth: side === "right" ? 1 : 0,
        borderLeftWidth: side === "left" ? 1 : 0,
        borderStyle: "solid",
      }}
    >
      {children}
      {/* Drag handle. The outer div is the 12px hit area (so the
          splitter is easy to grab); the inner 1px div is the visible
          line (always shown, highlighted on hover). The outer div is
          position with [side]: -6 (half the hit width off the edge)
          so its center sits on the pane boundary. */}
      <div
        onMouseDown={onMouseDown}
        className="group absolute top-0 h-full w-3 cursor-col-resize"
        style={{
          [side]: -6,
        }}
        title="Drag to resize"
      >
        <div
          className="h-full w-px transition-all duration-200 ease-standard group-hover:bg-accent/50 group-hover:shadow-[0_0_6px_rgba(94,106,210,0.25)]"
          style={{ marginLeft: "auto", marginRight: "auto", backgroundColor: "rgba(255,255,255,0.06)" }}
        />
      </div>
    </div>
  );
}
