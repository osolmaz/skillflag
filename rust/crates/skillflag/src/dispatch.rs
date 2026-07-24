//! The producer `--skill` interface: argument parsing and action dispatch.
//!
//! Mirrors `typescript/src/skillflag.ts`. Output formats are byte-exact with
//! the reference implementation.

use std::cell::RefCell;
use std::ffi::OsStr;
use std::io::Write;
use std::path::PathBuf;

use crate::core::errors::{Result, SkillflagError};
use crate::core::list::{list_skills, list_skills_json};
use crate::core::paths::{resolve_skill_dir_from_roots, resolve_skills_roots, SkillsRoot};
use crate::core::show::skill_md_bytes;
use crate::core::tar::build_skill_tar;
use crate::install::cli::run_install_cli_streams;
use crate::install::install::InstallInput;
use crate::install::resolve::SystemEnv;
use crate::stdio::{read_line, InputStream, StdinStream};

/// Environment variable honored by the standalone producer binary: a
/// path-list of skills roots (colon-separated on Unix). When set, the
/// bundled skill is excluded.
pub const SKILLFLAG_SKILLS_ROOT_ENV: &str = "SKILLFLAG_SKILLS_ROOT";

/// Options for [`handle_skillflag`].
///
/// Streams are injectable for tests and embedders; when `None`, the process
/// stdio is used. `skills_roots` may be empty (e.g. the standalone binary
/// serves only the bundled skill). The bundled root, when included, is
/// appended LAST (lowest precedence).
pub struct Options {
    pub skills_roots: Vec<PathBuf>,
    pub include_bundled_skill: bool,
    pub cwd: Option<PathBuf>,
    pub stdin: Option<RefCell<Box<dyn InputStream>>>,
    pub stdout: Option<RefCell<Box<dyn Write>>>,
    pub stderr: Option<RefCell<Box<dyn Write>>>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            skills_roots: Vec::new(),
            include_bundled_skill: true,
            cwd: None,
            stdin: None,
            stdout: None,
            stderr: None,
        }
    }
}

const USAGE_LINES: [&str; 6] = [
    "Usage:",
    "  --skill install [<id> ...] [--agent <agent>] [--scope <scope>] [--force]",
    "  --skill list [--json]",
    "  --skill export <id>",
    "  --skill show <id>",
    "  --skill help",
];

pub const SKILLFLAG_HELP_TEXT: &str = "Skillflag help\n\nInstall skillflag globally to get both binaries on your PATH:\n  npm install -g skillflag\n\nPrefer not to install globally? Use npx for one-off runs:\n  npx skillflag list\n  npx skillflag install --agent codex --scope repo < ./skill.tar\n\nList available skills:\n  tool --skill list\n  tool --skill list --json\n\nShow a skill's documentation:\n  tool --skill show <id>\n\nExport a skill bundle:\n  tool --skill export <id>\n\nInstall a skill bundle:\n  tool --skill install [<id> ...] [--agent <agent>] [--scope <scope>]\n  tool --skill export <id> | skill-install --agent <agent> --scope <scope>\n\nFor full details, read docs/SKILLFLAG_SPEC.md.";

fn usage() -> String {
    USAGE_LINES.join("\n")
}

#[derive(Debug, PartialEq, Eq)]
enum SkillAction {
    Install {
        ids: Option<Vec<String>>,
        install_args: Vec<String>,
    },
    List {
        json: bool,
    },
    Export {
        id: String,
    },
    Show {
        id: String,
    },
    Help,
}

/// Determine where the action arguments start.
///
/// When a `--skill` token is present, the action starts right after it.
/// Otherwise `argv[0]` is treated as the program name and skipped, so the
/// standalone binary accepts the action directly (`skillflag list`).
fn resolve_skill_action_args(argv: &[String]) -> &[String] {
    if let Some(index) = argv.iter().position(|arg| arg == "--skill") {
        return &argv[index + 1..];
    }
    if argv.is_empty() {
        argv
    } else {
        &argv[1..]
    }
}

fn unique_values(values: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        if !out.contains(&value) {
            out.push(value);
        }
    }
    out
}

fn parse_install_ids(values: &[String]) -> (Option<Vec<String>>, Vec<String>) {
    let mut ids: Vec<String> = Vec::new();
    let mut index = 0;
    while index < values.len() {
        let value = &values[index];
        if value.starts_with('-') {
            break;
        }
        for part in value.split(',') {
            let part = part.trim();
            if !part.is_empty() {
                ids.push(part.to_string());
            }
        }
        index += 1;
    }
    let install_args = values[index..].to_vec();
    if ids.is_empty() {
        (None, install_args)
    } else {
        (Some(unique_values(ids)), install_args)
    }
}

fn parse_skill_args(argv: &[String]) -> Result<SkillAction> {
    let args = resolve_skill_action_args(argv);
    let action = args.first();
    let Some(action) = action.filter(|action| !action.starts_with('-')) else {
        return Err(SkillflagError::new(format!(
            "Missing --skill action.\n{}",
            usage()
        )));
    };

    match action.as_str() {
        "install" => {
            let (ids, install_args) = parse_install_ids(&args[1..]);
            Ok(SkillAction::Install { ids, install_args })
        }
        "list" => Ok(SkillAction::List {
            json: args[1..].iter().any(|arg| arg == "--json"),
        }),
        "help" => Ok(SkillAction::Help),
        "export" | "show" => {
            let id = args.get(1);
            let Some(id) = id.filter(|id| !id.starts_with('-')) else {
                return Err(SkillflagError::new(format!(
                    "Missing skill id.\n{}",
                    usage()
                )));
            };
            if action == "export" {
                Ok(SkillAction::Export { id: id.clone() })
            } else {
                Ok(SkillAction::Show { id: id.clone() })
            }
        }
        other => Err(SkillflagError::new(format!(
            "Unknown --skill action: {other}.\n{}",
            usage()
        ))),
    }
}

fn resolve_install_skill_ids(
    ids: Option<Vec<String>>,
    roots: &[SkillsRoot],
    stdin: &mut dyn InputStream,
    stderr: &mut dyn Write,
) -> Result<Vec<String>> {
    if let Some(ids) = ids {
        if !ids.is_empty() {
            return Ok(ids);
        }
    }

    let skills = list_skills(roots);
    if skills.is_empty() {
        return Err(SkillflagError::new("No skills are available to install."));
    }
    if skills.len() == 1 {
        return Ok(vec![skills[0].id.clone()]);
    }
    if !stdin.is_tty() {
        return Err(SkillflagError::new(
            "Multiple skills are available; pass one or more ids with --skill install <id> [...].",
        ));
    }

    // Simplified interactive selection (numbered prompt on stderr).
    writeln!(stderr, "Select skills to install:")?;
    for (index, skill) in skills.iter().enumerate() {
        match &skill.summary {
            Some(summary) => writeln!(stderr, "  {}) {}\t{summary}", index + 1, skill.id)?,
            None => writeln!(stderr, "  {}) {}", index + 1, skill.id)?,
        }
    }
    write!(stderr, "Skills (numbers or ids, comma-separated): ")?;
    stderr.flush()?;
    let line = read_line(stdin)?.ok_or_else(|| SkillflagError::new("Install cancelled."))?;

    let mut selected: Vec<String> = Vec::new();
    for token in line.split(',') {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        if let Ok(number) = token.parse::<usize>() {
            if number >= 1 && number <= skills.len() {
                selected.push(skills[number - 1].id.clone());
                continue;
            }
            return Err(SkillflagError::new(format!("Invalid selection: {token}")));
        }
        if skills.iter().any(|skill| skill.id == *token) {
            selected.push(token.to_string());
            continue;
        }
        return Err(SkillflagError::new(format!("Invalid selection: {token}")));
    }
    if selected.is_empty() {
        return Err(SkillflagError::new("Install cancelled."));
    }
    Ok(unique_values(selected))
}

fn run_install_action(
    ids: Option<Vec<String>>,
    install_args: &[String],
    roots: &[SkillsRoot],
    cwd: &std::path::Path,
    stdin: &mut dyn InputStream,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> Result<i32> {
    let skill_ids = resolve_install_skill_ids(ids, roots, stdin, stderr)?;

    let mut inputs: Vec<InstallInput> = Vec::with_capacity(skill_ids.len());
    for skill_id in &skill_ids {
        let skill_dir = resolve_skill_dir_from_roots(roots, skill_id)?;
        let (tar, _) = build_skill_tar(&skill_dir, skill_id)?;
        inputs.push(InstallInput::Tar(tar));
    }

    Ok(run_install_cli_streams(
        install_args,
        stdin,
        stdout,
        stderr,
        cwd,
        &inputs,
        &skill_ids,
        &SystemEnv,
    ))
}

fn run(
    argv: &[String],
    opts: &Options,
    stdin: &mut dyn InputStream,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> Result<i32> {
    let action = parse_skill_args(argv)?;

    let cwd = opts
        .cwd
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let mut roots: Vec<SkillsRoot> = resolve_skills_roots(&opts.skills_roots, &cwd)
        .into_iter()
        .map(SkillsRoot::Dir)
        .collect();
    if opts.include_bundled_skill {
        roots.push(SkillsRoot::Bundled);
    }

    match action {
        SkillAction::Install { ids, install_args } => {
            run_install_action(ids, &install_args, &roots, &cwd, stdin, stdout, stderr)
        }
        SkillAction::List { json } => {
            if json {
                let payload = list_skills_json(&roots)?;
                stdout.write_all(payload.as_bytes())?;
            } else {
                let skills = list_skills(&roots);
                if !skills.is_empty() {
                    let lines: Vec<String> = skills
                        .iter()
                        .map(|skill| match &skill.summary {
                            Some(summary) => format!("{}\t{summary}", skill.id),
                            None => skill.id.clone(),
                        })
                        .collect();
                    stdout.write_all(format!("{}\n", lines.join("\n")).as_bytes())?;
                }
            }
            Ok(0)
        }
        SkillAction::Export { id } => {
            let skill_dir = resolve_skill_dir_from_roots(&roots, &id)?;
            let (tar, _) = build_skill_tar(&skill_dir, &id)?;
            stdout.write_all(&tar)?;
            Ok(0)
        }
        SkillAction::Show { id } => {
            let skill_dir = resolve_skill_dir_from_roots(&roots, &id)?;
            let content = skill_md_bytes(&skill_dir)?;
            stdout.write_all(&content)?;
            Ok(0)
        }
        SkillAction::Help => {
            writeln!(stdout, "{SKILLFLAG_HELP_TEXT}")?;
            Ok(0)
        }
    }
}

/// Handle a `--skill` invocation. Returns the process exit code.
///
/// `argv` is the full argument vector; when a `--skill` token is present the
/// action starts right after it, otherwise `argv[0]` is treated as the
/// program name and the action starts at `argv[1]`.
pub fn handle_skillflag(argv: &[String], opts: &Options) -> i32 {
    let mut stdin_guard;
    let mut default_stdin;
    let stdin: &mut dyn InputStream = match &opts.stdin {
        Some(cell) => {
            stdin_guard = cell.borrow_mut();
            &mut **stdin_guard
        }
        None => {
            default_stdin = StdinStream::new();
            &mut default_stdin
        }
    };
    let mut stdout_guard;
    let mut default_stdout;
    let stdout: &mut dyn Write = match &opts.stdout {
        Some(cell) => {
            stdout_guard = cell.borrow_mut();
            &mut **stdout_guard
        }
        None => {
            default_stdout = std::io::stdout();
            &mut default_stdout
        }
    };
    let mut stderr_guard;
    let mut default_stderr;
    let stderr: &mut dyn Write = match &opts.stderr {
        Some(cell) => {
            stderr_guard = cell.borrow_mut();
            &mut **stderr_guard
        }
        None => {
            default_stderr = std::io::stderr();
            &mut default_stderr
        }
    };

    let code = match run(argv, opts, stdin, stdout, stderr) {
        Ok(code) => code,
        Err(err) => {
            let _ = writeln!(stderr, "{}", err.message);
            err.exit_code
        }
    };
    let _ = stdout.flush();
    let _ = stderr.flush();
    code
}

/// Handle a `--skill` invocation when one is present.
///
/// Returns `None` (doing nothing) when `argv` contains no `--skill` token,
/// otherwise `Some(exit_code)`.
pub fn maybe_handle_skillflag(argv: &[String], opts: &Options) -> Option<i32> {
    if !argv.iter().any(|arg| arg == "--skill") {
        return None;
    }
    Some(handle_skillflag(argv, opts))
}

/// Producer options for the standalone binary, derived from an optional
/// `SKILLFLAG_SKILLS_ROOT` value: when set, its paths (split with the
/// platform path-list separator) become the skills roots and the bundled
/// skill is excluded; when unset, only the bundled skill is served.
pub fn standalone_options_from(skills_root_env: Option<&OsStr>) -> Options {
    match skills_root_env {
        Some(value) => Options {
            skills_roots: std::env::split_paths(value)
                .filter(|path| !path.as_os_str().is_empty())
                .collect(),
            include_bundled_skill: false,
            ..Options::default()
        },
        None => Options::default(),
    }
}

/// [`standalone_options_from`] using the real process environment.
pub fn standalone_options() -> Options {
    standalone_options_from(std::env::var_os(SKILLFLAG_SKILLS_ROOT_ENV).as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn action_args_start_after_skill_token() {
        let action = parse_skill_args(&argv(&["mycli", "run", "--skill", "list", "--json"]));
        assert_eq!(action.unwrap(), SkillAction::List { json: true });
    }

    #[test]
    fn standalone_accepts_action_directly() {
        let action = parse_skill_args(&argv(&["skillflag", "list"]));
        assert_eq!(action.unwrap(), SkillAction::List { json: false });
    }

    #[test]
    fn missing_action_errors_with_usage() {
        let err = parse_skill_args(&argv(&["skillflag"])).unwrap_err();
        assert!(err.message.starts_with("Missing --skill action.\nUsage:"));
        let err = parse_skill_args(&argv(&["x", "--skill", "--json"])).unwrap_err();
        assert!(err.message.starts_with("Missing --skill action."));
    }

    #[test]
    fn unknown_action_errors() {
        let err = parse_skill_args(&argv(&["x", "--skill", "frobnicate"])).unwrap_err();
        assert!(err
            .message
            .starts_with("Unknown --skill action: frobnicate.\nUsage:"));
    }

    #[test]
    fn export_requires_id() {
        let err = parse_skill_args(&argv(&["x", "--skill", "export"])).unwrap_err();
        assert!(err.message.starts_with("Missing skill id.\nUsage:"));
        let err = parse_skill_args(&argv(&["x", "--skill", "show", "--json"])).unwrap_err();
        assert!(err.message.starts_with("Missing skill id.\nUsage:"));
    }

    #[test]
    fn install_ids_split_trim_dedupe_and_stop_at_flags() {
        let action = parse_skill_args(&argv(&[
            "x", "--skill", "install", "a, b", "b,c", "--agent", "codex",
        ]))
        .unwrap();
        assert_eq!(
            action,
            SkillAction::Install {
                ids: Some(vec!["a".into(), "b".into(), "c".into()]),
                install_args: argv(&["--agent", "codex"]),
            }
        );
    }

    #[test]
    fn install_without_ids_passes_flags_through() {
        let action = parse_skill_args(&argv(&["x", "--skill", "install", "--force"])).unwrap();
        assert_eq!(
            action,
            SkillAction::Install {
                ids: None,
                install_args: argv(&["--force"]),
            }
        );
    }

    #[test]
    fn standalone_options_from_env_value() {
        let opts = standalone_options_from(None);
        assert!(opts.skills_roots.is_empty());
        assert!(opts.include_bundled_skill);

        let value = std::env::join_paths(["/roots/a", "/roots/b"]).unwrap();
        let opts = standalone_options_from(Some(value.as_os_str()));
        assert_eq!(
            opts.skills_roots,
            vec![PathBuf::from("/roots/a"), PathBuf::from("/roots/b")]
        );
        assert!(!opts.include_bundled_skill);
    }

    #[test]
    fn maybe_handle_returns_none_without_skill_token() {
        let opts = Options::default();
        assert!(maybe_handle_skillflag(&argv(&["tool", "build"]), &opts).is_none());
    }
}
