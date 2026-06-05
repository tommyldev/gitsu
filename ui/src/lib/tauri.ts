/**
 * Typed wrappers around every Tauri command.
 *
 * The Rust side is the source of truth for the command surface; see
 * `src-tauri/src/ipc.rs` and `docs/IPC.md`. This file mirrors that
 * surface and adds the `invoke<T>(...)` plumbing.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}
