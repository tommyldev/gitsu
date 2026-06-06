/**
 * Home — the projects/recents landing screen shown when no repo is
 * open. Extracted from App; purely presentational.
 */

import { FolderOpen, Command, GitBranch, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { RecentRepo } from "@/lib/types";

export function Home({
  onOpen,
  onPickRecent,
  recents,
  onForget,
  onCommandPalette,
}: {
  onOpen: () => void;
  onPickRecent: (path: string) => void;
  recents: RecentRepo[];
  onForget: (path: string) => void;
  onCommandPalette: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-10">
      <section className="text-center">
        <h1 className="mb-3 text-[28px] font-semibold tracking-tight text-fg">
          Worktrees, <span className="text-accent">first</span>.
        </h1>
        <p className="mx-auto max-w-md text-fg-muted leading-relaxed text-[14px]">
          A Git desktop client where every branch gets its own folder, its own terminal, its own state — all in one
          window, powered by{" "}
          <a className="text-accent hover:underline underline-offset-2" href="https://worktrunk.dev" target="_blank" rel="noreferrer">
            worktrunk
          </a>
          .
        </p>
        <div className="mt-8 flex items-center justify-center gap-2">
          <Button variant="primary" onClick={onOpen}>
            <FolderOpen size={14} strokeWidth={1.5} /> Open a repository
          </Button>
          <Button onClick={onCommandPalette} title="Command palette (⌘⇧P)">
            <Command size={14} strokeWidth={1.5} /> Command palette
          </Button>
        </div>
      </section>

      {recents.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Recent</h2>
          <ul className="flex flex-col gap-2">
            {recents.map((r) => (
              <li
                key={r.path}
                className="group flex items-center gap-3 rounded-lg border border-white/[0.14] bg-bg-panel px-4 py-3 transition-all duration-200 ease-standard hover:border-white/[0.24] hover:bg-[#2A2C2F] hover:shadow-[0_2px_12px_rgba(0,0,0,0.2)] hover:-translate-y-px"
              >
                <GitBranch size={16} className="text-accent shrink-0" strokeWidth={1.5} />
                <button
                  className="flex-1 truncate text-left text-[13px] font-medium text-fg hover:text-accent-bright transition-colors duration-150"
                  onClick={() => onPickRecent(r.path)}
                  title={r.path}
                >
                  {r.name}
                  <span className="ml-2 truncate font-mono text-[12px] font-normal text-fg-muted">{r.path}</span>
                </button>
                <button
                  className="rounded p-1 text-fg-muted hover:bg-danger/10 hover:text-danger transition-colors duration-150"
                  onClick={() => onForget(r.path)}
                  title="Forget"
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
