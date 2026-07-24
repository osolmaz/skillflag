//! Integration tests for the `skill-install` companion CLI.

mod support;

use std::fs;
use std::process::Command;

use skillflag::core::tar::{write_tar, TarEntry};
use support::{
    assert_tree_equal, export_tar, fixtures_root, run_installer, stdin_from, write_skill_dir,
    TempDir,
};

fn entry(name: &str, is_dir: bool, data: &[u8]) -> TarEntry {
    TarEntry {
        name: name.to_string(),
        is_dir,
        mode: if is_dir { 0o755 } else { 0o644 },
        data: data.to_vec(),
    }
}

/// Build a tar and patch the typeflag of the first header (recomputing the
/// checksum) to simulate unsupported entry types.
fn tar_with_typeflag(name: &str, typeflag: u8) -> Vec<u8> {
    let mut tar = write_tar(&[entry(name, false, b"")]).unwrap();
    tar[156] = typeflag;
    tar[148..156].copy_from_slice(b"        ");
    let sum: u32 = tar[..512].iter().map(|&b| u32::from(b)).sum();
    tar[148..154].copy_from_slice(format!("{sum:06o}").as_bytes());
    tar[154] = b' ';
    tar[155] = 0;
    tar
}

#[test]
fn installs_from_directory_path() {
    let cwd = TempDir::new();
    let source = fixtures_root().join("alpha");
    let result = run_installer(
        &[
            source.to_str().unwrap(),
            "--agent",
            "codex",
            "--scope",
            "cwd",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    let dest = cwd.path().join(".codex").join("skills").join("alpha");
    assert_tree_equal(&source, &dest);
    assert_eq!(
        result.stderr,
        format!("Installed alpha to {} (codex/cwd)\n", dest.display())
    );
    assert!(result.stdout.is_empty());
}

#[cfg(unix)]
#[test]
fn directory_install_preserves_execute_bits() {
    use std::os::unix::fs::PermissionsExt;
    let source_root = TempDir::new();
    let source = write_skill_dir(source_root.path(), "tool", "tool");
    let script = source.join("run.sh");
    fs::write(&script, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

    let cwd = TempDir::new();
    let result = run_installer(
        &[
            source.to_str().unwrap(),
            "--agent",
            "codex",
            "--scope",
            "cwd",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    let installed = cwd
        .path()
        .join(".codex")
        .join("skills")
        .join("tool")
        .join("run.sh");
    let mode = fs::metadata(&installed).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode & 0o111, 0o111, "execute bits preserved");
}

#[test]
fn destination_name_comes_from_frontmatter_name() {
    let source_root = TempDir::new();
    let source = write_skill_dir(source_root.path(), "renamed-dir", "real-name");
    let cwd = TempDir::new();
    let result = run_installer(
        &[
            source.to_str().unwrap(),
            "--agent",
            "codex",
            "--scope",
            "cwd",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    let skills = cwd.path().join(".codex").join("skills");
    assert!(skills.join("real-name").join("SKILL.md").is_file());
    assert!(!skills.join("renamed-dir").exists());
}

#[test]
fn installs_from_stdin_tar_round_trip() {
    let tar = export_tar(&fixtures_root(), "alpha");
    let cwd = TempDir::new();
    let result = run_installer(
        &["--agent", "portable", "--scope", "repo"],
        cwd.path(),
        Some(stdin_from(&tar, false)),
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    let dest = cwd.path().join(".agents").join("skills").join("alpha");
    assert_tree_equal(&fixtures_root().join("alpha"), &dest);
}

#[test]
fn existing_destination_fails_without_force() {
    let cwd = TempDir::new();
    let source = fixtures_root().join("alpha");
    let args = [
        source.to_str().unwrap(),
        "--agent",
        "codex",
        "--scope",
        "cwd",
    ];
    let first = run_installer(&args, cwd.path(), None, vec![], vec![], &[]);
    assert_eq!(first.code, 0);

    let second = run_installer(&args, cwd.path(), None, vec![], vec![], &[]);
    assert_eq!(second.code, 1);
    let dest = cwd.path().join(".codex").join("skills").join("alpha");
    assert_eq!(
        second.stderr,
        format!("Destination already exists: {}\n", dest.display())
    );
}

#[test]
fn force_replaces_existing_destination() {
    let cwd = TempDir::new();
    let source = fixtures_root().join("alpha");
    let args = [
        source.to_str().unwrap(),
        "--agent",
        "codex",
        "--scope",
        "cwd",
    ];
    assert_eq!(
        run_installer(&args, cwd.path(), None, vec![], vec![], &[]).code,
        0
    );
    let dest = cwd.path().join(".codex").join("skills").join("alpha");
    fs::write(dest.join("stale.txt"), "old").unwrap();

    let mut force_args = args.to_vec();
    force_args.push("--force");
    let result = run_installer(&force_args, cwd.path(), None, vec![], vec![], &[]);
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    assert!(!dest.join("stale.txt").exists());
    assert_tree_equal(&source, &dest);
}

#[test]
fn missing_flags_without_tty_fails() {
    let cwd = TempDir::new();
    let tar = export_tar(&fixtures_root(), "alpha");
    let result = run_installer(
        &[],
        cwd.path(),
        Some(stdin_from(&tar, false)),
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 1);
    assert!(result.stderr.starts_with("Missing required flags.\nUsage:"));
}

#[test]
fn missing_path_and_tty_stdin_fails() {
    let cwd = TempDir::new();
    let result = run_installer(
        &["--agent", "codex", "--scope", "cwd"],
        cwd.path(),
        Some(stdin_from(b"", true)),
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 1);
    assert!(result
        .stderr
        .starts_with("Missing PATH or tar stream on stdin.\nUsage:"));
}

#[test]
fn unsupported_agent_scope_and_combo_errors() {
    let cwd = TempDir::new();
    let source = fixtures_root().join("alpha");
    let source = source.to_str().unwrap();

    let result = run_installer(
        &[source, "--agent", "emacs", "--scope", "repo"],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Unsupported agent: emacs\n");

    let result = run_installer(
        &[source, "--agent", "codex", "--scope", "global"],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Unsupported scope: global\n");

    let result = run_installer(
        &[source, "--agent", "claude", "--scope", "cwd"],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Unsupported agent/scope: claude cwd\n");
}

#[test]
fn nonexistent_path_errors() {
    let cwd = TempDir::new();
    let missing = cwd.path().join("nope");
    let result = run_installer(
        &[
            missing.to_str().unwrap(),
            "--agent",
            "codex",
            "--scope",
            "cwd",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        format!("PATH does not exist: {}\n", missing.display())
    );
}

#[test]
fn path_must_be_a_directory() {
    let cwd = TempDir::new();
    let file = cwd.path().join("file.txt");
    fs::write(&file, "x").unwrap();
    let result = run_installer(
        &[file.to_str().unwrap(), "--agent", "codex", "--scope", "cwd"],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "PATH must be a directory containing SKILL.md.\n"
    );
}

#[test]
fn help_prints_usage_and_exits_zero() {
    let cwd = TempDir::new();
    let result = run_installer(&["--help"], cwd.path(), None, vec![], vec![], &[]);
    assert_eq!(result.code, 0);
    assert!(result.stdout_text().starts_with("Usage:\n  skill-install"));
}

// --- destination resolution through the CLI (injected env) ---

#[test]
fn codex_user_scope_honors_codex_home() {
    let cwd = TempDir::new();
    let codex_home = TempDir::new();
    let source = fixtures_root().join("alpha");
    let result = run_installer(
        &[
            source.to_str().unwrap(),
            "--agent",
            "codex",
            "--scope",
            "user",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[("CODEX_HOME", codex_home.path().to_str().unwrap())],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    assert_tree_equal(&source, &codex_home.path().join("skills").join("alpha"));
}

#[test]
fn portable_user_scope_honors_xdg_config_home() {
    let cwd = TempDir::new();
    let xdg = TempDir::new();
    let source = fixtures_root().join("alpha");
    let result = run_installer(
        &[
            source.to_str().unwrap(),
            "--agent",
            "portable",
            "--scope",
            "user",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[("XDG_CONFIG_HOME", xdg.path().to_str().unwrap())],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    assert_tree_equal(
        &source,
        &xdg.path().join("agents").join("skills").join("alpha"),
    );
}

#[test]
fn claude_user_scope_uses_home() {
    let cwd = TempDir::new();
    let home = TempDir::new();
    let source = fixtures_root().join("alpha");
    let result = run_installer(
        &[
            source.to_str().unwrap(),
            "--agent",
            "claude",
            "--scope",
            "user",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[("HOME", home.path().to_str().unwrap())],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    assert_tree_equal(
        &source,
        &home.path().join(".claude").join("skills").join("alpha"),
    );
}

#[test]
fn repo_scope_uses_git_toplevel() {
    let repo = TempDir::new();
    let status = Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(repo.path())
        .status()
        .expect("git init");
    assert!(status.success());
    let sub = repo.path().join("nested").join("dir");
    fs::create_dir_all(&sub).unwrap();

    let source = fixtures_root().join("alpha");
    let result = run_installer(
        &[
            source.to_str().unwrap(),
            "--agent",
            "claude",
            "--scope",
            "repo",
        ],
        &sub,
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    let repo_root = repo.path().canonicalize().unwrap();
    assert_tree_equal(
        &source,
        &repo_root.join(".claude").join("skills").join("alpha"),
    );
}

#[test]
fn repo_scope_falls_back_to_cwd_without_git() {
    let cwd = TempDir::new();
    let source = fixtures_root().join("alpha");
    let result = run_installer(
        &[
            source.to_str().unwrap(),
            "--agent",
            "opencode",
            "--scope",
            "repo",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    // opencode uses the singular `skill` directory.
    assert_tree_equal(
        &source,
        &cwd.path().join(".opencode").join("skill").join("alpha"),
    );
}

// --- collisions ---

#[test]
fn colliding_destinations_fail_before_installing() {
    let cwd = TempDir::new();
    let root_a = TempDir::new();
    let root_b = TempDir::new();
    let source_a = write_skill_dir(root_a.path(), "one", "same-name");
    let source_b = write_skill_dir(root_b.path(), "two", "same-name");

    let result = run_installer(
        &[
            source_a.to_str().unwrap(),
            source_b.to_str().unwrap(),
            "--agent",
            "codex",
            "--scope",
            "cwd",
        ],
        cwd.path(),
        None,
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 1);
    assert!(result
        .stderr
        .starts_with("Install destination collisions detected:"));
    assert!(result.stderr.contains("same-name @ codex/cwd"));
    assert!(!cwd.path().join(".codex").exists(), "nothing was written");
}

// --- interactive wizard (simplified numbered prompts) ---

#[test]
fn interactive_prompts_for_agent_and_scope() {
    let cwd = TempDir::new();
    let source = fixtures_root().join("alpha");
    // Agent "1" = codex; codex scopes are [repo, cwd, user], "2" = cwd.
    let result = run_installer(
        &[source.to_str().unwrap()],
        cwd.path(),
        Some(stdin_from(b"1\n2\n", true)),
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    assert!(result.stderr.contains("Select an agent:"));
    assert!(result.stderr.contains("1) codex"));
    assert!(result.stderr.contains("Select a scope:"));
    let dest = cwd.path().join(".codex").join("skills").join("alpha");
    assert_tree_equal(&source, &dest);
}

#[test]
fn interactive_accepts_agent_names() {
    let cwd = TempDir::new();
    let home = TempDir::new();
    let source = fixtures_root().join("alpha");
    let result = run_installer(
        &[source.to_str().unwrap()],
        cwd.path(),
        Some(stdin_from(b"claude\nuser\n", true)),
        vec![],
        vec![],
        &[("HOME", home.path().to_str().unwrap())],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    assert_tree_equal(
        &source,
        &home.path().join(".claude").join("skills").join("alpha"),
    );
}

// --- tar extraction security ---

fn install_tar(tar: &[u8]) -> support::RunResult {
    let cwd = TempDir::new();
    run_installer(
        &["--agent", "codex", "--scope", "cwd"],
        cwd.path(),
        Some(stdin_from(tar, false)),
        vec![],
        vec![],
        &[],
    )
}

#[test]
fn tar_with_parent_traversal_is_rejected() {
    let tar = write_tar(&[entry("../evil", false, b"x")]).unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Invalid path in tar: ../evil\n");

    let tar = write_tar(&[entry("a/", true, b""), entry("a/../b", false, b"x")]).unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Invalid path in tar: a/../b\n");
}

#[test]
fn tar_with_absolute_path_is_rejected() {
    let tar = write_tar(&[entry("/abs/evil", false, b"x")]).unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Invalid path in tar: /abs/evil\n");
}

#[test]
fn tar_with_empty_segment_or_backslash_is_rejected() {
    let tar = write_tar(&[entry("a//b", false, b"x")]).unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Invalid path in tar: a//b\n");

    let tar = write_tar(&[entry("a\\b", false, b"x")]).unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Invalid path in tar: a\\b\n");
}

#[test]
fn tar_with_two_top_level_dirs_is_rejected() {
    let tar = write_tar(&[
        entry("a/", true, b""),
        entry("a/SKILL.md", false, b"---\nname: a\ndescription: d\n---\n"),
        entry("b/", true, b""),
    ])
    .unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "Tar must contain a single top-level directory.\n"
    );
}

#[test]
fn tar_with_top_level_file_is_rejected() {
    let tar = write_tar(&[entry("loose-file", false, b"x")]).unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "Tar must contain a single top-level directory.\n"
    );
}

#[test]
fn empty_tar_stream_is_rejected() {
    for tar in [Vec::new(), vec![0u8; 1024]] {
        let result = install_tar(&tar);
        assert_eq!(result.code, 1);
        assert_eq!(result.stderr, "Tar stream was empty.\n");
    }
}

#[test]
fn unsupported_tar_entry_types_are_rejected() {
    let tar = tar_with_typeflag("a/link", b'2');
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Unsupported tar entry type: symlink\n");

    let tar = tar_with_typeflag("a/fifo", b'6');
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Unsupported tar entry type: fifo\n");
}

// --- bundle validation ---

#[test]
fn tar_without_skill_md_is_rejected() {
    let tar = write_tar(&[entry("a/", true, b""), entry("a/other.txt", false, b"x")]).unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "SKILL.md not found in skill root.\n");
}

#[test]
fn skill_md_missing_name_or_description_is_rejected() {
    let tar = write_tar(&[
        entry("a/", true, b""),
        entry("a/SKILL.md", false, b"---\ndescription: d\n---\n"),
    ])
    .unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "SKILL.md metadata is missing name.\n");

    let tar = write_tar(&[
        entry("a/", true, b""),
        entry("a/SKILL.md", false, b"---\nname: a\n---\n"),
    ])
    .unwrap();
    let result = install_tar(&tar);
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "SKILL.md metadata is missing description.\n");
}

/// GNU tar interop: the installer accepts archives with ustar prefix fields
/// left empty and plain 0-terminated names, which `write_tar` produces; a
/// PAX path override must also be honored.
#[test]
fn pax_path_override_is_applied() {
    // A pax header ('x') carrying path=alpha/SKILL.md followed by a file
    // entry with a placeholder name. The record length prefix counts the
    // whole record including itself.
    let content = "path=alpha/SKILL.md\n";
    let mut total = content.len();
    let record = loop {
        let candidate = format!("{total} {content}");
        if candidate.len() == total {
            break candidate;
        }
        total = candidate.len();
    };
    let mut pax = write_tar(&[entry("ignored-name", false, record.as_bytes())]).unwrap();
    pax.truncate(pax.len() - 1024); // drop trailer
    pax[156] = b'x';
    pax[148..156].copy_from_slice(b"        ");
    let sum: u32 = pax[..512].iter().map(|&b| u32::from(b)).sum();
    pax[148..154].copy_from_slice(format!("{sum:06o}").as_bytes());
    pax[154] = b' ';
    pax[155] = 0;

    let rest = write_tar(&[
        entry("alpha/", true, b""),
        entry(
            "alpha/renamed.md",
            false,
            b"---\nname: alpha\ndescription: d\n---\n",
        ),
    ])
    .unwrap();
    // Order: dir, then pax+file. Rebuild: dir header block + pax + file.
    let mut tar = rest[..512].to_vec();
    tar.extend_from_slice(&pax);
    tar.extend_from_slice(&rest[512..]);

    let cwd = TempDir::new();
    let result = run_installer(
        &["--agent", "codex", "--scope", "cwd"],
        cwd.path(),
        Some(stdin_from(&tar, false)),
        vec![],
        vec![],
        &[],
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    let dest = cwd.path().join(".codex").join("skills").join("alpha");
    // The pax path override renamed the entry, so only SKILL.md exists.
    assert!(dest.join("SKILL.md").is_file());
    assert!(!dest.join("renamed.md").exists());
}

/// The exported stream must be a valid tar for the system `tar` too.
#[test]
fn system_tar_can_list_exported_stream() {
    let tar = export_tar(&fixtures_root(), "alpha");
    let temp = TempDir::new();
    let tar_path = temp.path().join("alpha.tar");
    fs::write(&tar_path, &tar).unwrap();
    let output = Command::new("tar")
        .args(["-tf", tar_path.to_str().unwrap()])
        .output()
        .expect("system tar");
    assert!(output.status.success());
    let listing = String::from_utf8(output.stdout).unwrap();
    assert_eq!(
        listing,
        "alpha/\nalpha/SKILL.md\nalpha/templates/\nalpha/templates/hello.txt\n"
    );
}
