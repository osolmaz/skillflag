//! The `skill-install` CLI.
//!
//! Mirrors `typescript/src/install/cli.ts`, with a deliberately simpler,
//! dependency-free interactive fallback: when `--agent` or `--scope` is
//! missing and stdin is a TTY, a numbered prompt (written to stderr) collects
//! the missing values. `/dev/tty` is never opened.

use std::cell::RefCell;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::core::errors::{Result, SkillflagError};
use crate::core::paths::resolve_path;
use crate::install::install::{install_skill, InstallInput, InstallOptions};
use crate::install::resolve::{
    assert_agent, assert_scope, assert_supported_agent_scopes, resolve_skills_root,
    supported_scopes_for_agent, EnvLookup, SystemEnv, AGENTS, SCOPES,
};
use crate::install::validate::{assert_skill_dir, read_skill_metadata};
use crate::stdio::{drain, read_line, InputStream, StdinStream};

/// Options for [`run_install_cli`]. Streams default to the process stdio;
/// `provided_inputs`/`provided_skill_ids` let a producer CLI hand pre-built
/// tar bundles to the installer (used by `--skill install`).
#[derive(Default)]
pub struct InstallCliOptions {
    pub stdin: Option<RefCell<Box<dyn InputStream>>>,
    pub stdout: Option<RefCell<Box<dyn Write>>>,
    pub stderr: Option<RefCell<Box<dyn Write>>>,
    pub cwd: Option<PathBuf>,
    pub provided_inputs: Vec<InstallInput>,
    pub provided_skill_ids: Vec<String>,
    pub env: Option<Box<dyn EnvLookup>>,
}

#[derive(Debug)]
struct ParsedArgs {
    input_paths: Vec<String>,
    agents: Vec<String>,
    scopes: Vec<String>,
    force: bool,
    help: bool,
}

struct PreparedSource {
    source: String,
    skill_id_hint: String,
    input: InstallInput,
}

struct PlanItem {
    source_index: usize,
    agent: String,
    scope: String,
    destination: PathBuf,
}

pub(crate) fn usage_text() -> String {
    let agent_list = AGENTS.join(", ");
    let scope_list = SCOPES.join(", ");
    [
        "Usage:",
        "  skill-install [PATH ...] [--agent <agent>] [--scope <scope>] [--force]",
        "",
        "Input:",
        "  PATH ...            Skill directory path(s) containing SKILL.md.",
        "  stdin tar stream    If PATH is omitted, reads a tar bundle from stdin.",
        "",
        "Options:",
        "  --agent <value>     Target agent (single value).",
        &format!("                      Supported agents: {agent_list}"),
        "  --scope <value>     Target scope (single value).",
        &format!("                      Supported scopes: {scope_list}"),
        "  --force             Overwrite destination if it already exists.",
        "  -h, --help          Show this help.",
        "",
        "Behavior:",
        "  If --agent or --scope is missing and an interactive TTY is available,",
        "  the installer launches a wizard to collect missing values.",
        "  CLI flags accept only one --agent and one --scope.",
        "  Use the wizard to select multiple agents/scopes.",
    ]
    .join("\n")
}

fn parse_flag_value(value: Option<&String>, flag: &str) -> Result<String> {
    let missing = || SkillflagError::new(format!("Missing value for --{flag}."));
    let value = value.ok_or_else(missing)?;
    if value.starts_with('-') {
        return Err(missing());
    }
    let value = value.trim();
    if value.is_empty() {
        return Err(missing());
    }
    if value.contains(',') {
        return Err(SkillflagError::new(format!(
            "Only one value is allowed for --{flag}. Comma-separated values are not supported."
        )));
    }
    Ok(value.to_string())
}

fn parse_args(args: &[String]) -> Result<ParsedArgs> {
    let mut input_paths = Vec::new();
    let mut agent_value: Option<String> = None;
    let mut scope_value: Option<String> = None;
    let mut force = false;
    let mut help = false;

    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--agent" {
            if agent_value.is_some() {
                return Err(SkillflagError::new("Only one --agent flag is allowed."));
            }
            agent_value = Some(parse_flag_value(args.get(index + 1), "agent")?);
            index += 2;
            continue;
        }
        if arg == "--scope" {
            if scope_value.is_some() {
                return Err(SkillflagError::new("Only one --scope flag is allowed."));
            }
            scope_value = Some(parse_flag_value(args.get(index + 1), "scope")?);
            index += 2;
            continue;
        }
        if arg == "--force" {
            force = true;
            index += 1;
            continue;
        }
        if arg == "--help" || arg == "-h" {
            help = true;
            index += 1;
            continue;
        }
        if arg.starts_with('-') {
            return Err(SkillflagError::new(format!("Unknown option: {arg}")));
        }
        input_paths.push(arg.clone());
        index += 1;
    }

    Ok(ParsedArgs {
        input_paths,
        agents: agent_value.into_iter().collect(),
        scopes: scope_value.into_iter().collect(),
        force,
        help,
    })
}

/// Numbered selection prompt on stderr; accepts a number or a literal value.
fn prompt_select(
    stdin: &mut dyn InputStream,
    stderr: &mut dyn Write,
    title: &str,
    label: &str,
    choices: &[&str],
) -> Result<String> {
    writeln!(stderr, "{title}")?;
    for (index, choice) in choices.iter().enumerate() {
        writeln!(stderr, "  {}) {choice}", index + 1)?;
    }
    write!(stderr, "{label} (number or name): ")?;
    stderr.flush()?;
    let line = read_line(stdin)?.ok_or_else(|| SkillflagError::new("Install cancelled."))?;
    let value = line.trim();
    if value.is_empty() {
        return Err(SkillflagError::new("Install cancelled."));
    }
    if let Ok(number) = value.parse::<usize>() {
        if number >= 1 && number <= choices.len() {
            return Ok(choices[number - 1].to_string());
        }
        return Err(SkillflagError::new(format!("Invalid selection: {value}")));
    }
    Ok(value.to_string())
}

fn prompt_missing_flags(
    parsed: &ParsedArgs,
    stdin: &mut dyn InputStream,
    stderr: &mut dyn Write,
) -> Result<(String, String)> {
    let agent = match parsed.agents.first() {
        Some(agent) => assert_agent(agent)?.to_string(),
        None => {
            let value = prompt_select(stdin, stderr, "Select an agent:", "Agent", &AGENTS)?;
            assert_agent(&value)?.to_string()
        }
    };
    let scope = match parsed.scopes.first() {
        Some(scope) => assert_scope(scope)?.to_string(),
        None => {
            let scopes = supported_scopes_for_agent(&agent);
            let value = prompt_select(stdin, stderr, "Select a scope:", "Scope", scopes)?;
            assert_scope(&value)?.to_string()
        }
    };
    Ok((agent, scope))
}

fn prepare_dir_source(path: &str, cwd: &Path) -> Result<PreparedSource> {
    let source_dir = resolve_path(cwd, Path::new(path));
    let metadata = fs::metadata(&source_dir).map_err(|_| {
        SkillflagError::new(format!("PATH does not exist: {}", source_dir.display()))
    })?;
    if !metadata.is_dir() {
        return Err(SkillflagError::new(
            "PATH must be a directory containing SKILL.md.",
        ));
    }
    assert_skill_dir(&source_dir)?;
    let meta = read_skill_metadata(&source_dir)?;
    Ok(PreparedSource {
        source: source_dir.display().to_string(),
        skill_id_hint: meta.name,
        input: InstallInput::Dir(source_dir),
    })
}

fn resolve_install_sources(
    input_paths: &[String],
    provided_inputs: &[InstallInput],
    provided_skill_ids: &[String],
    stdin: &mut dyn InputStream,
    cwd: &Path,
) -> Result<Vec<PreparedSource>> {
    if !input_paths.is_empty() && !provided_inputs.is_empty() {
        return Err(SkillflagError::new(
            "PATH cannot be used when install input is preset.",
        ));
    }

    if !input_paths.is_empty() {
        return input_paths
            .iter()
            .map(|path| prepare_dir_source(path, cwd))
            .collect();
    }

    if !provided_inputs.is_empty() {
        return provided_inputs
            .iter()
            .enumerate()
            .map(|(index, input)| match input {
                InstallInput::Dir(dir) => prepare_dir_source(&dir.display().to_string(), cwd),
                InstallInput::Tar(bytes) => Ok(PreparedSource {
                    source: "tar stream".to_string(),
                    skill_id_hint: provided_skill_ids
                        .get(index)
                        .cloned()
                        .unwrap_or_else(|| "<from skill bundle>".to_string()),
                    input: InstallInput::Tar(bytes.clone()),
                }),
            })
            .collect();
    }

    if !stdin.is_tty() {
        let mut bytes = Vec::new();
        stdin.read_to_end(&mut bytes)?;
        return Ok(vec![PreparedSource {
            source: "tar stream".to_string(),
            skill_id_hint: "<from skill bundle>".to_string(),
            input: InstallInput::Tar(bytes),
        }]);
    }

    Err(SkillflagError::new(format!(
        "Missing PATH or tar stream on stdin.\n{}",
        usage_text()
    )))
}

fn build_install_plan(
    sources: &[PreparedSource],
    agents: &[String],
    scopes: &[String],
    cwd: &Path,
    env: &dyn EnvLookup,
) -> Result<Vec<PlanItem>> {
    let mut plan = Vec::new();
    for (source_index, source) in sources.iter().enumerate() {
        for agent in agents {
            for scope in scopes {
                let skills_root = resolve_skills_root(agent, scope, cwd, env)?;
                plan.push(PlanItem {
                    source_index,
                    agent: agent.clone(),
                    scope: scope.clone(),
                    destination: skills_root.join(&source.skill_id_hint),
                });
            }
        }
    }
    Ok(plan)
}

fn assert_no_install_collisions(plan: &[PlanItem], sources: &[PreparedSource]) -> Result<()> {
    let mut by_destination: Vec<(String, Vec<&PlanItem>)> = Vec::new();
    for item in plan {
        let key = item.destination.display().to_string();
        match by_destination.iter_mut().find(|(dest, _)| *dest == key) {
            Some((_, items)) => items.push(item),
            None => by_destination.push((key, vec![item])),
        }
    }

    let mut collisions: Vec<&(String, Vec<&PlanItem>)> = by_destination
        .iter()
        .filter(|(_, items)| items.len() > 1)
        .collect();
    if collisions.is_empty() {
        return Ok(());
    }
    collisions.sort_by(|a, b| a.0.cmp(&b.0));

    let mut lines = vec!["Install destination collisions detected:".to_string()];
    for (destination, items) in collisions {
        lines.push(format!("- {destination}"));
        for item in items {
            let source = &sources[item.source_index];
            lines.push(format!(
                "  - {} @ {}/{} (source: {})",
                source.skill_id_hint, item.agent, item.scope, source.source
            ));
        }
    }
    lines.push(
        "Resolve collisions by changing skill IDs, sources, --agent, or --scope so each combination has a unique destination."
            .to_string(),
    );
    Err(SkillflagError::new(lines.join("\n")))
}

#[allow(clippy::too_many_arguments)]
fn run_inner(
    args: &[String],
    stdin: &mut dyn InputStream,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
    cwd: &Path,
    provided_inputs: &[InstallInput],
    provided_skill_ids: &[String],
    env: &dyn EnvLookup,
) -> Result<i32> {
    let parsed = parse_args(args)?;
    if parsed.help {
        writeln!(stdout, "{}", usage_text())?;
        if !stdin.is_tty() {
            drain(stdin);
        }
        return Ok(0);
    }

    if !provided_inputs.is_empty() && !parsed.input_paths.is_empty() {
        return Err(SkillflagError::new(
            "PATH cannot be used when install input is preset.",
        ));
    }
    if !provided_skill_ids.is_empty() && provided_inputs.is_empty() {
        return Err(SkillflagError::new(
            "Preset skill ids require preset install inputs.",
        ));
    }
    if !provided_skill_ids.is_empty() && provided_skill_ids.len() != provided_inputs.len() {
        return Err(SkillflagError::new(
            "Preset skill id count must match preset install input count.",
        ));
    }

    let (agents, scopes): (Vec<String>, Vec<String>) =
        if parsed.agents.is_empty() || parsed.scopes.is_empty() {
            if stdin.is_tty() {
                let (agent, scope) = prompt_missing_flags(&parsed, stdin, stderr)?;
                (vec![agent], vec![scope])
            } else {
                return Err(SkillflagError::new(format!(
                    "Missing required flags.\n{}",
                    usage_text()
                )));
            }
        } else {
            let agents: Vec<String> = parsed
                .agents
                .iter()
                .map(|agent| assert_agent(agent).map(str::to_string))
                .collect::<Result<_>>()?;
            let scopes: Vec<String> = parsed
                .scopes
                .iter()
                .map(|scope| assert_scope(scope).map(str::to_string))
                .collect::<Result<_>>()?;
            (agents, scopes)
        };
    assert_supported_agent_scopes(&agents, &scopes)?;

    let sources = resolve_install_sources(
        &parsed.input_paths,
        provided_inputs,
        provided_skill_ids,
        stdin,
        cwd,
    )?;
    let plan = build_install_plan(&sources, &agents, &scopes, cwd, env)?;
    assert_no_install_collisions(&plan, &sources)?;

    let mut results = Vec::with_capacity(plan.len());
    for item in &plan {
        let result = install_skill(
            &sources[item.source_index].input,
            &InstallOptions {
                agent: &item.agent,
                scope: &item.scope,
                cwd,
                force: parsed.force,
                env,
            },
        )?;
        results.push((result, &item.agent, &item.scope));
    }

    for (result, agent, scope) in &results {
        writeln!(
            stderr,
            "Installed {} to {} ({agent}/{scope})",
            result.skill_id,
            result.installed_to.display()
        )?;
    }
    Ok(0)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_install_cli_streams(
    args: &[String],
    stdin: &mut dyn InputStream,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
    cwd: &Path,
    provided_inputs: &[InstallInput],
    provided_skill_ids: &[String],
    env: &dyn EnvLookup,
) -> i32 {
    let code = match run_inner(
        args,
        stdin,
        stdout,
        stderr,
        cwd,
        provided_inputs,
        provided_skill_ids,
        env,
    ) {
        Ok(code) => code,
        Err(err) => {
            if !stdin.is_tty() {
                drain(stdin);
            }
            let _ = writeln!(stderr, "{}", err.message);
            err.exit_code
        }
    };
    let _ = stdout.flush();
    let _ = stderr.flush();
    code
}

/// Run the installer CLI. `args` are the CLI arguments *after* the program
/// name. Returns the process exit code (0 success, 1 any error).
pub fn run_install_cli(args: &[String], opts: &InstallCliOptions) -> i32 {
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

    let cwd = opts
        .cwd
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let system_env = SystemEnv;
    let env: &dyn EnvLookup = match &opts.env {
        Some(env) => env.as_ref(),
        None => &system_env,
    };

    run_install_cli_streams(
        args,
        stdin,
        stdout,
        stderr,
        &cwd,
        &opts.provided_inputs,
        &opts.provided_skill_ids,
        env,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_args_flags_and_paths() {
        let parsed = parse_args(&args(&[
            "./a", "--agent", "codex", "--scope", "repo", "--force",
        ]))
        .unwrap();
        assert_eq!(parsed.input_paths, vec!["./a"]);
        assert_eq!(parsed.agents, vec!["codex"]);
        assert_eq!(parsed.scopes, vec!["repo"]);
        assert!(parsed.force);
        assert!(!parsed.help);
    }

    #[test]
    fn parse_args_rejects_duplicates_and_commas() {
        assert_eq!(
            parse_args(&args(&["--agent", "codex", "--agent", "claude"]))
                .unwrap_err()
                .message,
            "Only one --agent flag is allowed."
        );
        assert_eq!(
            parse_args(&args(&["--agent", "codex,claude"]))
                .unwrap_err()
                .message,
            "Only one value is allowed for --agent. Comma-separated values are not supported."
        );
        assert_eq!(
            parse_args(&args(&["--scope", "repo,user"]))
                .unwrap_err()
                .message,
            "Only one value is allowed for --scope. Comma-separated values are not supported."
        );
        assert_eq!(
            parse_args(&args(&["--agent"])).unwrap_err().message,
            "Missing value for --agent."
        );
        assert_eq!(
            parse_args(&args(&["--scope", "--force"]))
                .unwrap_err()
                .message,
            "Missing value for --scope."
        );
        assert_eq!(
            parse_args(&args(&["--bogus"])).unwrap_err().message,
            "Unknown option: --bogus"
        );
    }
}
