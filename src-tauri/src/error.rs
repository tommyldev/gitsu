//! Error types for gitsu.
//!
//! The IPC surface maps every variant to a user-friendly message + suggested
//! action in the frontend. Keep messages actionable.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("worktrunk sidecar failed: {0}")]
    Worktrunk(String),

    #[error("git operation failed: {0}")]
    Git(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("path `{0}` is not a git repository")]
    NotARepo(String),

    #[error("path `{0}` does not exist")]
    NotFound(String),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("internal: {0}")]
    Internal(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct Out<'a> {
            kind: &'a str,
            message: String,
        }
        let kind = match self {
            Error::Worktrunk(_) => "worktrunk",
            Error::Git(_) => "git",
            Error::Io(_) => "io",
            Error::Serde(_) => "serde",
            Error::NotARepo(_) => "not_a_repo",
            Error::NotFound(_) => "not_found",
            Error::InvalidArgument(_) => "invalid_argument",
            Error::Internal(_) => "internal",
        };
        Out {
            kind,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

impl From<git2::Error> for Error {
    fn from(e: git2::Error) -> Self {
        Error::Git(format!("{e}"))
    }
}

pub type Result<T> = std::result::Result<T, Error>;
