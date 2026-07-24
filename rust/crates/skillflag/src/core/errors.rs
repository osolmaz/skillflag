use std::fmt;

/// Error type shared by the producer and installer code paths.
///
/// Mirrors `SkillflagError` / `InstallError` from the TypeScript reference:
/// a message that is printed to stderr and an exit code (always 1 today).
#[derive(Debug)]
pub struct SkillflagError {
    pub message: String,
    pub exit_code: i32,
}

impl SkillflagError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            exit_code: 1,
        }
    }
}

impl fmt::Display for SkillflagError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SkillflagError {}

impl From<std::io::Error> for SkillflagError {
    fn from(err: std::io::Error) -> Self {
        SkillflagError::new(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, SkillflagError>;
