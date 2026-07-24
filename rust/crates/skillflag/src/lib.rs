//! Rust implementation of the Skillflag producer interface and the
//! `skill-install` companion CLI.
//!
//! The behavior mirrors the TypeScript reference implementation in
//! `typescript/src/` of the Skillflag monorepo; output formats (`list`,
//! `list --json`, `export`, `show`, and error messages) are byte-compatible.

pub mod bundled;
pub mod core;
pub mod dispatch;
pub mod frontmatter;
pub mod install;
pub mod stdio;

pub use crate::core::errors::SkillflagError;
pub use crate::core::paths::{find_skills_root, find_skills_roots};
pub use crate::dispatch::{
    handle_skillflag, maybe_handle_skillflag, standalone_options, standalone_options_from, Options,
    SKILLFLAG_HELP_TEXT, SKILLFLAG_SKILLS_ROOT_ENV,
};
