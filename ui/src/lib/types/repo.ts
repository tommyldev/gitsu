/**
 * Repo session + filesystem listing types. Mirrors the Rust serde
 * structs backing the recents store, version probe, and the
 * `list_directory` IPC command.
 */

export interface RecentRepo {
  path: string;
  name: string;
  last_opened: string;
}

export interface VersionInfo {
  wt: string;
  path: string | null;
  min_supported: string;
}

/** One entry in a directory listing. Mirrors the Rust `DirEntry`
 * struct returned by the `list_directory` IPC command. */
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  /** File size in bytes. `null` for directories (and for files we
   * couldn't stat). */
  size: number | null;
}
