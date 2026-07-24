//! Standalone Skillflag producer binary.
//!
//! `skillflag-rs install ...` routes directly to the installer CLI (like the
//! reference `skillflag` bin); everything else goes through the producer
//! `--skill` dispatcher, which also accepts the action directly
//! (`skillflag-rs list`).
//!
//! When `SKILLFLAG_SKILLS_ROOT` is set it provides the skills roots (platform
//! path-list separator) and the bundled skill is excluded; when unset, the
//! bundled `skillflag` skill is served.

use skillflag::install::{run_install_cli, InstallCliOptions};
use skillflag::{handle_skillflag, standalone_options};

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let code = if argv.get(1).map(String::as_str) == Some("install") {
        run_install_cli(&argv[2..], &InstallCliOptions::default())
    } else {
        handle_skillflag(&argv, &standalone_options())
    };
    std::process::exit(code);
}
