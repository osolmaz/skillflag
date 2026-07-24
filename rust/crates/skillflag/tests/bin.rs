//! End-to-end tests running the compiled binaries.

mod support;

use std::io::Write;
use std::process::{Command, Stdio};

use support::{assert_tree_equal, fixtures_root, TempDir};

const PRODUCER_BIN: &str = env!("CARGO_BIN_EXE_skillflag-rs");
const INSTALLER_BIN: &str = env!("CARGO_BIN_EXE_skill-install-rs");

#[test]
fn skills_root_env_serves_fixtures_and_excludes_bundled_skill() {
    let output = Command::new(PRODUCER_BIN)
        .args(["--skill", "list"])
        .env("SKILLFLAG_SKILLS_ROOT", fixtures_root())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "alpha\tAlpha test skill\nbeta\tBeta test skill\n"
    );
}

#[test]
fn skills_root_env_accepts_multiple_paths() {
    let extra = TempDir::new();
    support::write_skill_dir(extra.path(), "zzz", "zzz");
    let joined = std::env::join_paths([fixtures_root().as_path(), extra.path()]).unwrap();
    let output = Command::new(PRODUCER_BIN)
        .args(["--skill", "list"])
        .env("SKILLFLAG_SKILLS_ROOT", joined)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "alpha\tAlpha test skill\nbeta\tBeta test skill\nzzz\tzzz skill\n"
    );
}

#[test]
fn without_skills_root_env_only_the_bundled_skill_is_listed() {
    let output = Command::new(PRODUCER_BIN)
        .args(["--skill", "list"])
        .env_remove("SKILLFLAG_SKILLS_ROOT")
        .output()
        .unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.starts_with("skillflag\t"), "stdout: {stdout}");
    assert_eq!(stdout.lines().count(), 1);
}

#[test]
fn direct_action_form_works() {
    let output = Command::new(PRODUCER_BIN)
        .args(["list", "--json"])
        .env("SKILLFLAG_SKILLS_ROOT", fixtures_root())
        .output()
        .unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.starts_with("{\"skillflag_version\":\"0.1\",\"skills\":[{\"id\":\"alpha\""));
    assert!(!stdout.ends_with('\n'));
}

#[test]
fn export_pipes_into_installer_round_trip() {
    let cwd = TempDir::new();

    let producer = Command::new(PRODUCER_BIN)
        .args(["--skill", "export", "alpha"])
        .env("SKILLFLAG_SKILLS_ROOT", fixtures_root())
        .output()
        .unwrap();
    assert!(producer.status.success());
    let tar = producer.stdout;
    assert_eq!(tar.len() % 512, 0);

    let mut installer = Command::new(INSTALLER_BIN)
        .args(["--agent", "codex", "--scope", "repo"])
        .current_dir(cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    installer.stdin.take().unwrap().write_all(&tar).unwrap();
    let result = installer.wait_with_output().unwrap();
    let stderr = String::from_utf8(result.stderr).unwrap();
    assert!(result.status.success(), "stderr: {stderr}");
    assert!(stderr.starts_with("Installed alpha to "));

    // No .git in the temp dir, so the repo root falls back to cwd.
    let dest = cwd.path().join(".codex").join("skills").join("alpha");
    assert_tree_equal(&fixtures_root().join("alpha"), &dest);
}

#[test]
fn producer_install_subcommand_routes_to_installer() {
    let cwd = TempDir::new();
    let source = fixtures_root().join("alpha");
    let output = Command::new(PRODUCER_BIN)
        .args([
            "install",
            source.to_str().unwrap(),
            "--agent",
            "codex",
            "--scope",
            "cwd",
        ])
        .current_dir(cwd.path())
        .stdin(Stdio::null())
        .output()
        .unwrap();
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(output.status.success(), "stderr: {stderr}");
    let dest = cwd.path().join(".codex").join("skills").join("alpha");
    assert_tree_equal(&source, &dest);
}

#[test]
fn unknown_id_exit_code_from_binary() {
    let output = Command::new(PRODUCER_BIN)
        .args(["--skill", "export", "nope"])
        .env("SKILLFLAG_SKILLS_ROOT", fixtures_root())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "Skill not found: nope\n"
    );
    assert!(output.stdout.is_empty());
}
