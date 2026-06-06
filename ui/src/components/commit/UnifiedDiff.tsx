import { useMemo } from "react";
import clsx from "clsx";
import { parsePatch } from "@/lib/diff";

export function UnifiedDiff({ patch }: { patch: string }) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  return (
    <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">
      <code>
        {lines.map((line, i) => (
          <div
            key={i}
            className={clsx(
              "flex",
              line.kind === "add" && "bg-success/10",
              line.kind === "del" && "bg-danger/10",
              (line.kind === "meta" || line.kind === "context") && "text-fg",
            )}
          >
            <span className="inline-block w-12 shrink-0 select-none pr-3 text-right text-fg-muted">
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
            </span>
            <span className="whitespace-pre">{line.content}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}
