/**
 * Header — the top app bar: brand mark, repo breadcrumb + version
 * pill, and the action buttons (palette, sidebar toggles, settings,
 * hooks, refresh, new worktree). Extracted from App; purely
 * presentational — all behavior is passed in as callbacks.
 */

import {
  Command,
  FolderOpen,
  Plus,
  Settings as SettingsIcon,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  GitBranch,
} from "lucide-react";
import { Button, Pill } from "@/components/ui/primitives";
import { BrandMark, HankoSeal } from "@/components/ui/BrandMark";
import { secondsAgo } from "@/lib/format";
import type { RecentRepo, VersionInfo } from "@/lib/types";

export function Header({
  repo,
  version,
  lastFetched,
  viewHidden,
  leftHidden,
  rightHidden,
  onToggleView,
  onToggleLeft,
  onToggleRight,
  onOpen,
  onCreate,
  onRefresh,
  onHooks,
  onSettings,
  onCommandPalette,
  onCloseRepo,
}: {
  repo: RecentRepo | null;
  version: VersionInfo | null;
  lastFetched: number | null;
  viewHidden: boolean;
  leftHidden: boolean;
  rightHidden: boolean;
  onToggleView: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpen: () => void;
  onCreate: () => void;
  onRefresh: () => void;
  onHooks: () => void;
  onSettings: () => void;
  onCommandPalette: () => void;
  onCloseRepo: () => void;
}) {
  return (
    <header className="relative flex items-center justify-between gap-4 bg-bg px-4 py-2.5 z-10">
      {/* Subtle gradient bottom border */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight text-fg">gitsu</span>
          <HankoSeal />
        </div>
        {repo ? (
          <>
            <span className="text-fg-muted/40">/</span>
            <button
              onClick={onCloseRepo}
              className="truncate rounded font-mono text-[13px] text-fg hover:text-accent transition-colors duration-150"
              title={`${repo.path}\n(click to go back to recents)`}
            >
              {repo.name}
            </button>
            {version && (
              <Pill tone={version.wt ? "accent" : "danger"} title={version.path ?? ""}>
                wt {version.wt || "?"}
              </Pill>
            )}
          </>
        ) : (
          <span className="text-fg-muted text-[13px]">worktree-first git client</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {lastFetched && (
          <span className="text-[11px] text-fg-muted tabular-nums" title={new Date(lastFetched).toLocaleString()}>
            updated {secondsAgo(lastFetched)}
          </span>
        )}
        {repo && (
          <>
            <Button onClick={onCommandPalette} title="Command palette (⌘⇧P)">
              <Command size={14} strokeWidth={1.5} /> Palette
            </Button>
            <Button
              onClick={onToggleLeft}
              title={leftHidden ? "Show worktree list (⌘B)" : "Hide worktree list (⌘B)"}
              aria-pressed={leftHidden}
            >
              {leftHidden ? <PanelLeftOpen size={14} strokeWidth={1.5} /> : <PanelLeftClose size={14} strokeWidth={1.5} />}
            </Button>
            <Button
              onClick={onToggleRight}
              title={
                viewHidden
                  ? rightHidden
                    ? "Show file explorer (⌘⌥B)"
                    : "Hide file explorer (⌘⌥B)"
                  : rightHidden
                    ? "Show commit panel (⌘⌥B)"
                    : "Hide commit panel (⌘⌥B)"
              }
              aria-pressed={rightHidden}
            >
              {rightHidden ? <PanelRightOpen size={14} strokeWidth={1.5} /> : <PanelRightClose size={14} strokeWidth={1.5} />}
            </Button>
            <Button
              onClick={onToggleView}
              title={
                viewHidden
                  ? "Show graph & commit panel"
                  : "Hide graph & commit panel (worktree list only)"
              }
              aria-pressed={viewHidden}
            >
              {viewHidden ? (
                <PanelRightOpen size={14} strokeWidth={1.5} />
              ) : (
                <PanelRightClose size={14} strokeWidth={1.5} />
              )}
              {viewHidden ? "Show graph" : "Hide graph"}
            </Button>
            <Button onClick={onSettings} title="Settings (⌘,)">
              <SettingsIcon size={14} strokeWidth={1.5} /> Settings
            </Button>
            <Button onClick={onHooks} title="Hooks & worktree config (⌘⇧,)">
              <GitBranch size={14} strokeWidth={1.5} /> Hooks
            </Button>
            <Button onClick={onRefresh} title="Refresh (⌘R)">
              Refresh
            </Button>
            <Button variant="primary" onClick={onCreate} title="New worktree (⌘N / Ctrl+N)">
              <Plus size={14} strokeWidth={1.5} /> New worktree
            </Button>
          </>
        )}
        {!repo && (
          <>
            <Button onClick={onCommandPalette} title="Command palette (⌘⇧P)">
              <Command size={14} strokeWidth={1.5} /> Palette
            </Button>
            <Button variant="primary" onClick={onOpen}>
              <FolderOpen size={14} strokeWidth={1.5} /> Open repo
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
