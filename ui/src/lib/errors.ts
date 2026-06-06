/**
 * Error types + normalization shared across the frontend.
 *
 * `IpcError` mirrors the Rust serde error shape (`src-tauri/src/error.rs`);
 * `WtRpcError` is the typed wrapper a rejected Tauri command surfaces as.
 * `parseError` collapses any thrown value into a user-facing string —
 * use it everywhere instead of re-deriving error text per call site.
 */

export interface IpcError {
  kind: string;
  message: string;
}

export class WtRpcError extends Error {
  kind: string;
  constructor(err: IpcError) {
    super(err.message);
    this.name = "WtRpcError";
    this.kind = err.kind;
  }
}

/** Normalize an unknown thrown value into a display string. */
export function parseError(e: unknown): string {
  if (e instanceof WtRpcError) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    return (e as IpcError).message ?? String(e);
  }
  if (typeof e === "string") return e;
  return String(e);
}
