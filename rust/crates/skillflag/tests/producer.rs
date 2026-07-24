//! Integration tests for the producer `--skill` interface.

mod support;

use std::fs;
use std::path::Path;

use skillflag::core::digest::digest_sha256;
use skillflag::{find_skills_root, find_skills_roots, maybe_handle_skillflag, Options};
use support::{
    assert_tree_equal, export_tar, fixtures_root, run_producer, stdin_from, write_skill_dir,
    TempDir,
};

#[cfg(unix)]
fn disk_mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

fn header_name(tar: &[u8], block: usize) -> String {
    let field = &tar[block * 512..block * 512 + 100];
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    String::from_utf8(field[..end].to_vec()).unwrap()
}

#[test]
fn list_text_matches_reference_format() {
    let result = run_producer(
        &["prog", "--skill", "list"],
        &[&fixtures_root()],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stdout_text(),
        "alpha\tAlpha test skill\nbeta\tBeta test skill\n"
    );
    assert_eq!(result.stderr, "");
}

#[test]
fn list_text_zero_skills_prints_nothing() {
    let empty = TempDir::new();
    let result = run_producer(
        &["prog", "--skill", "list"],
        &[empty.path()],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 0);
    assert!(result.stdout.is_empty());
}

#[test]
fn list_json_matches_reference_format_and_digests() {
    let fixtures = fixtures_root();
    let alpha_digest = digest_sha256(&export_tar(&fixtures, "alpha"));
    let beta_digest = digest_sha256(&export_tar(&fixtures, "beta"));

    let result = run_producer(
        &["prog", "--skill", "list", "--json"],
        &[&fixtures],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 0);
    let expected = format!(
        "{{\"skillflag_version\":\"0.1\",\"skills\":[{{\"id\":\"alpha\",\"digest\":\"{alpha_digest}\",\"files\":2,\"summary\":\"Alpha test skill\"}},{{\"id\":\"beta\",\"digest\":\"{beta_digest}\",\"files\":1,\"summary\":\"Beta test skill\"}}]}}"
    );
    assert_eq!(result.stdout_text(), expected);
}

#[test]
fn list_json_zero_skills() {
    let empty = TempDir::new();
    let result = run_producer(
        &["prog", "--skill", "list", "--json"],
        &[empty.path()],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stdout_text(),
        "{\"skillflag_version\":\"0.1\",\"skills\":[]}"
    );
}

#[test]
fn export_is_deterministic() {
    let fixtures = fixtures_root();
    let first = export_tar(&fixtures, "alpha");
    let second = export_tar(&fixtures, "alpha");
    assert_eq!(first, second);
}

#[test]
fn export_tar_structure_matches_contract() {
    let fixtures = fixtures_root();
    let tar = export_tar(&fixtures, "alpha");

    // 8 blocks: alpha/, SKILL.md header+data, templates/, hello.txt
    // header+data, then two zero trailer blocks.
    assert_eq!(tar.len(), 4096);
    assert_eq!(header_name(&tar, 0), "alpha/");
    assert_eq!(header_name(&tar, 1), "alpha/SKILL.md");
    assert_eq!(header_name(&tar, 3), "alpha/templates/");
    assert_eq!(header_name(&tar, 4), "alpha/templates/hello.txt");
    assert!(tar[3072..].iter().all(|&b| b == 0));

    // Normalized metadata in every header.
    for block in [0usize, 1, 3, 4] {
        let header = &tar[block * 512..(block + 1) * 512];
        assert_eq!(&header[108..116], b"000000 \0", "uid in block {block}");
        assert_eq!(&header[116..124], b"000000 \0", "gid in block {block}");
        assert_eq!(&header[136..148], b"00000000000 ", "mtime in block {block}");
        assert_eq!(&header[257..263], b"ustar\0");
        assert_eq!(&header[263..265], b"00");
    }
    assert_eq!(tar[156], b'5');
    assert_eq!(tar[512 + 156], b'0');

    // On-disk modes flow into the headers.
    #[cfg(unix)]
    {
        let expected_dir_mode = format!("{:06o} ", disk_mode(&fixtures.join("alpha")));
        assert_eq!(&tar[100..107], expected_dir_mode.as_bytes());
        let expected_file_mode = format!(
            "{:06o} ",
            disk_mode(&fixtures.join("alpha").join("SKILL.md"))
        );
        assert_eq!(&tar[512 + 100..512 + 107], expected_file_mode.as_bytes());
    }

    // SKILL.md data follows its header.
    let skill_md = fs::read(fixtures.join("alpha").join("SKILL.md")).unwrap();
    assert_eq!(&tar[1024..1024 + skill_md.len()], &skill_md[..]);
}

#[test]
fn show_prints_raw_skill_md_bytes() {
    let fixtures = fixtures_root();
    let result = run_producer(
        &["prog", "--skill", "show", "alpha"],
        &[&fixtures],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 0);
    assert_eq!(
        result.stdout,
        fs::read(fixtures.join("alpha").join("SKILL.md")).unwrap()
    );
}

#[test]
fn unknown_skill_id_errors_with_exit_1() {
    for action in ["export", "show"] {
        let result = run_producer(
            &["prog", "--skill", action, "nope"],
            &[&fixtures_root()],
            false,
            None,
            None,
        );
        assert_eq!(result.code, 1);
        assert!(result.stdout.is_empty());
        assert_eq!(result.stderr, "Skill not found: nope\n");
    }
}

#[test]
fn invalid_skill_ids_are_rejected() {
    let fixtures = fixtures_root();
    let result = run_producer(
        &["prog", "--skill", "export", "."],
        &[&fixtures],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Skill id is required.\n");

    let result = run_producer(
        &["prog", "--skill", "export", "a/b"],
        &[&fixtures],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Invalid skill id: a/b\n");
}

#[test]
fn bundled_skill_is_served_by_default() {
    let result = run_producer(&["prog", "--skill", "list"], &[], true, None, None);
    assert_eq!(result.code, 0);
    assert!(result.stdout_text().starts_with("skillflag\t"));

    let result = run_producer(
        &["prog", "--skill", "export", "skillflag"],
        &[],
        true,
        None,
        None,
    );
    assert_eq!(result.code, 0);
    assert_eq!(header_name(&result.stdout, 0), "skillflag/");
    assert_eq!(header_name(&result.stdout, 1), "skillflag/SKILL.md");
    // Normalized bundled modes: 0755 dirs, 0644 files.
    assert_eq!(&result.stdout[100..108], b"000755 \0");
    assert_eq!(&result.stdout[512 + 100..512 + 108], b"000644 \0");
}

#[test]
fn bundled_root_has_lowest_precedence() {
    let root = TempDir::new();
    write_skill_dir(root.path(), "skillflag", "skillflag");
    let result = run_producer(
        &["prog", "--skill", "show", "skillflag"],
        &[root.path()],
        true,
        None,
        None,
    );
    assert_eq!(result.code, 0);
    assert!(result.stdout_text().contains("name: skillflag"));
    assert!(result.stdout_text().contains("skillflag skill"));
}

#[test]
fn first_root_wins_and_lists_merge_sorted() {
    let root_a = TempDir::new();
    let root_b = TempDir::new();
    write_skill_dir(root_a.path(), "dup", "dup");
    fs::write(
        root_a.path().join("dup").join("SKILL.md"),
        "---\nname: dup\ndescription: From root A\n---\n",
    )
    .unwrap();
    write_skill_dir(root_b.path(), "dup", "dup");
    fs::write(
        root_b.path().join("dup").join("SKILL.md"),
        "---\nname: dup\ndescription: From root B\n---\n",
    )
    .unwrap();
    write_skill_dir(root_b.path(), "aaa", "aaa");

    let result = run_producer(
        &["prog", "--skill", "list"],
        &[root_a.path(), root_b.path()],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 0);
    assert_eq!(result.stdout_text(), "aaa\taaa skill\ndup\tFrom root A\n");
}

#[test]
fn help_exits_zero() {
    let result = run_producer(&["prog", "--skill", "help"], &[], true, None, None);
    assert_eq!(result.code, 0);
    assert!(result.stdout_text().starts_with("Skillflag help\n"));
}

#[test]
fn missing_and_unknown_actions_error() {
    let result = run_producer(&["prog", "--skill"], &[], true, None, None);
    assert_eq!(result.code, 1);
    assert!(result.stderr.starts_with("Missing --skill action.\nUsage:"));

    let result = run_producer(&["prog", "--skill", "bogus"], &[], true, None, None);
    assert_eq!(result.code, 1);
    assert!(result
        .stderr
        .starts_with("Unknown --skill action: bogus.\nUsage:"));
}

#[test]
fn maybe_handle_skillflag_skips_without_token() {
    let argv: Vec<String> = vec!["tool".into(), "build".into()];
    assert!(maybe_handle_skillflag(&argv, &Options::default()).is_none());
}

#[test]
fn find_skills_roots_walks_upward() {
    let root = TempDir::new();
    let skills = root.path().join("skills");
    let agents_skills = root.path().join(".agents").join("skills");
    fs::create_dir_all(&skills).unwrap();
    fs::create_dir_all(&agents_skills).unwrap();
    let nested = root.path().join("src").join("deep");
    fs::create_dir_all(&nested).unwrap();

    let roots = find_skills_roots(&nested).unwrap();
    assert_eq!(
        roots,
        vec![skills.clone(), agents_skills],
        "both roots at the first matching ancestor"
    );
    assert_eq!(find_skills_root(&nested).unwrap(), skills);

    // Works from a file path too (starts at its parent directory).
    let file = nested.join("main.rs");
    fs::write(&file, "").unwrap();
    assert_eq!(find_skills_root(&file).unwrap(), skills);
}

#[test]
fn find_skills_roots_prefers_agents_when_only_it_exists() {
    let root = TempDir::new();
    let agents_skills = root.path().join(".agents").join("skills");
    fs::create_dir_all(&agents_skills).unwrap();
    assert_eq!(find_skills_root(root.path()).unwrap(), agents_skills);
}

// --- producer `install` action ---

#[test]
fn producer_install_errors_with_zero_skills() {
    let empty = TempDir::new();
    let result = run_producer(
        &[
            "prog", "--skill", "install", "--agent", "codex", "--scope", "cwd",
        ],
        &[empty.path()],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "No skills are available to install.\n");
}

#[test]
fn producer_install_auto_selects_single_skill() {
    let root = TempDir::new();
    write_skill_dir(root.path(), "solo", "solo");
    let cwd = TempDir::new();
    let result = run_producer(
        &[
            "prog", "--skill", "install", "--agent", "codex", "--scope", "cwd",
        ],
        &[root.path()],
        false,
        Some(cwd.path()),
        None,
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    let dest = cwd.path().join(".codex").join("skills").join("solo");
    assert!(dest.join("SKILL.md").is_file());
    assert!(result
        .stderr
        .contains(&format!("Installed solo to {} (codex/cwd)", dest.display())));
}

#[test]
fn producer_install_multiple_skills_non_tty_errors() {
    let result = run_producer(
        &[
            "prog", "--skill", "install", "--agent", "codex", "--scope", "cwd",
        ],
        &[&fixtures_root()],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 1);
    assert_eq!(
        result.stderr,
        "Multiple skills are available; pass one or more ids with --skill install <id> [...].\n"
    );
}

#[test]
fn producer_install_with_comma_separated_ids() {
    let cwd = TempDir::new();
    let result = run_producer(
        &[
            "prog",
            "--skill",
            "install",
            "alpha,beta",
            "--agent",
            "codex",
            "--scope",
            "cwd",
        ],
        &[&fixtures_root()],
        false,
        Some(cwd.path()),
        None,
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    let skills = cwd.path().join(".codex").join("skills");
    assert_tree_equal(&fixtures_root().join("alpha"), &skills.join("alpha"));
    assert_tree_equal(&fixtures_root().join("beta"), &skills.join("beta"));
}

#[test]
fn producer_install_interactive_numbered_prompt() {
    let cwd = TempDir::new();
    let result = run_producer(
        &[
            "prog", "--skill", "install", "--agent", "codex", "--scope", "cwd",
        ],
        &[&fixtures_root()],
        false,
        Some(cwd.path()),
        Some(stdin_from(b"1\n", true)),
    );
    assert_eq!(result.code, 0, "stderr: {}", result.stderr);
    assert!(result.stderr.contains("Select skills to install:"));
    assert!(result.stderr.contains("1) alpha\tAlpha test skill"));
    let dest = cwd.path().join(".codex").join("skills").join("alpha");
    assert_tree_equal(&fixtures_root().join("alpha"), &dest);
}

#[test]
fn producer_install_unknown_id_fails_before_writing() {
    let cwd = TempDir::new();
    let result = run_producer(
        &[
            "prog", "--skill", "install", "ghost", "--agent", "codex", "--scope", "cwd",
        ],
        &[&fixtures_root()],
        false,
        Some(cwd.path()),
        None,
    );
    assert_eq!(result.code, 1);
    assert_eq!(result.stderr, "Skill not found: ghost\n");
    assert!(!cwd.path().join(".codex").exists());
}
