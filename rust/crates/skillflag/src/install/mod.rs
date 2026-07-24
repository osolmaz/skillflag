pub mod cli;
pub mod copy;
pub mod extract;
// Mirrors the TypeScript reference layout (`install/install.ts`).
#[allow(clippy::module_inception)]
pub mod install;
pub mod resolve;
pub mod validate;

pub use cli::{run_install_cli, InstallCliOptions};
pub use install::{install_skill, InstallInput, InstallOptions, InstallResult};
pub use resolve::{EnvLookup, SystemEnv, AGENTS, SCOPES};
