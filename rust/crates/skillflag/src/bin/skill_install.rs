//! Standalone `skill-install` companion binary.

use skillflag::install::{run_install_cli, InstallCliOptions};

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let code = run_install_cli(&argv[1..], &InstallCliOptions::default());
    std::process::exit(code);
}
