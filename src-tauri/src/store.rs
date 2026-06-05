//! Persistent storage (rusqlite). v1 schema:
//!
//! - `recent_repos(path PRIMARY KEY, name, last_opened)`
//! - `worktree_notes(repo, branch, body, updated_at)`  (M5+)
//! - `settings(key PRIMARY KEY, value)`                (theme, layout, keybinds)
//! - `llm_cache(sha PRIMARY KEY, summary, generated_at)`  (M3+)

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::ipc::RecentRepo;

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: PathBuf) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    /// Open at the platform's app data dir.
    pub fn open_in_app_data() -> rusqlite::Result<Self> {
        let dir = dirs::data_dir()
            .or_else(dirs::config_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        Self::open(dir.join("gitsu").join("gitsu.db"))
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS recent_repos (
                path        TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                last_opened TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS worktree_notes (
                repo        TEXT NOT NULL,
                branch      TEXT NOT NULL,
                body        TEXT NOT NULL DEFAULT '',
                updated_at  TEXT NOT NULL,
                PRIMARY KEY (repo, branch)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS llm_cache (
                sha          TEXT PRIMARY KEY,
                summary      TEXT NOT NULL,
                generated_at TEXT NOT NULL
            );
            "#,
        )
    }

    pub fn upsert_recent_repo(
        &self,
        path: &Path,
        name: &str,
        ts: chrono::DateTime<chrono::Utc>,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO recent_repos(path, name, last_opened) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET name=excluded.name, last_opened=excluded.last_opened",
            params![path.display().to_string(), name, ts.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn recent_repos(&self) -> rusqlite::Result<Vec<RecentRepo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT path, name, last_opened FROM recent_repos ORDER BY last_opened DESC LIMIT 50",
        )?;
        let rows = stmt.query_map([], |r| {
            let path: String = r.get(0)?;
            let name: String = r.get(1)?;
            let ts: String = r.get(2)?;
            Ok(RecentRepo {
                path: PathBuf::from(path),
                name,
                last_opened: chrono::DateTime::parse_from_rfc3339(&ts)
                    .map(|t| t.with_timezone(&chrono::Utc))
                    .unwrap_or_else(|_| chrono::Utc::now()),
            })
        })?;
        let mut out = vec![];
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn forget_repo(&self, path: &Path) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM recent_repos WHERE path = ?1",
            params![path.display().to_string()],
        )?;
        Ok(())
    }
}
