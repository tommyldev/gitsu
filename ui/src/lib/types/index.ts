/**
 * Domain types mirroring the Rust serde structs (`src-tauri/src/`).
 * Keep these in sync with the Rust side; `docs/IPC.md` is the single
 * source of truth. Types are split by milestone/domain into sibling
 * modules; this barrel re-exports them all so `@/lib/types` stays a
 * stable import path.
 */

export * from "./worktree";
export * from "./repo";
export * from "./graph";
export * from "./diff";
export * from "./merge";
export * from "./hooks";
export * from "./pty";

// Error types live in `@/lib/errors` alongside `parseError`. Re-exported
// here for back-compat with existing `@/lib/types` imports.
export { WtRpcError } from "@/lib/errors";
export type { IpcError } from "@/lib/errors";
