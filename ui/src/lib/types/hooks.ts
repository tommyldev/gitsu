/**
 * Hooks (M4) types. Mirrors the Rust serde struct returned by the
 * hook-config IPC command.
 */

export interface HookConfigSnapshot {
  installed: boolean;
  has_post_start_copy_ignored: boolean;
  config_path: string;
  worktreeinclude_path: string | null;
  worktreeinclude_contents: string | null;
}
