//! Agent/scope → destination skills-root mapping.
//!
//! Ports `typescript/src/install/resolve.ts` verbatim (same agents, scopes,
//! paths, and error messages).

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::core::errors::{Result, SkillflagError};

pub const AGENTS: [&str; 10] = [
    "codex", "claude", "portable", "vscode", "copilot", "amp", "goose", "opencode", "factory",
    "cursor",
];

pub const SCOPES: [&str; 3] = ["repo", "user", "cwd"];

/// Environment lookup used by destination resolution, injectable for tests
/// (so tests never mutate the process environment).
pub trait EnvLookup {
    fn var(&self, key: &str) -> Option<String>;
}

/// Reads the real process environment.
pub struct SystemEnv;

impl EnvLookup for SystemEnv {
    fn var(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }
}

impl<F: Fn(&str) -> Option<String>> EnvLookup for F {
    fn var(&self, key: &str) -> Option<String> {
        self(key)
    }
}

pub fn assert_agent(value: &str) -> Result<&str> {
    if AGENTS.contains(&value) {
        Ok(value)
    } else {
        Err(SkillflagError::new(format!("Unsupported agent: {value}")))
    }
}

pub fn assert_scope(value: &str) -> Result<&str> {
    if SCOPES.contains(&value) {
        Ok(value)
    } else {
        Err(SkillflagError::new(format!("Unsupported scope: {value}")))
    }
}

/// Scopes supported per agent, in the reference implementation's order.
pub fn supported_scopes_for_agent(agent: &str) -> &'static [&'static str] {
    match agent {
        "codex" => &["repo", "cwd", "user"],
        "claude" | "portable" | "amp" | "goose" | "opencode" | "factory" => &["repo", "user"],
        "vscode" | "copilot" | "cursor" => &["repo"],
        _ => &[],
    }
}

pub fn assert_supported_agent_scopes(agents: &[String], scopes: &[String]) -> Result<()> {
    for agent in agents {
        let supported = supported_scopes_for_agent(agent);
        for scope in scopes {
            if !supported.contains(&scope.as_str()) {
                return Err(SkillflagError::new(format!(
                    "Unsupported agent/scope: {agent} {scope}"
                )));
            }
        }
    }
    Ok(())
}

/// `git rev-parse --show-toplevel` in `cwd`, falling back to `cwd`.
pub fn resolve_repo_root(cwd: &Path) -> PathBuf {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(cwd)
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            let top = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !top.is_empty() {
                return PathBuf::from(top);
            }
        }
    }
    cwd.to_path_buf()
}

fn home_dir(env: &dyn EnvLookup) -> PathBuf {
    if let Some(home) = env.var("HOME").filter(|h| !h.is_empty()) {
        return PathBuf::from(home);
    }
    std::env::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn config_root(env: &dyn EnvLookup) -> PathBuf {
    match env.var("XDG_CONFIG_HOME") {
        Some(value) => PathBuf::from(value),
        None => home_dir(env).join(".config"),
    }
}

/// Destination skills root for one agent/scope combination.
pub fn resolve_skills_root(
    agent: &str,
    scope: &str,
    cwd: &Path,
    env: &dyn EnvLookup,
) -> Result<PathBuf> {
    let root = match (agent, scope) {
        ("codex", "repo") => resolve_repo_root(cwd).join(".codex").join("skills"),
        ("codex", "cwd") => cwd.join(".codex").join("skills"),
        ("codex", "user") => {
            let root = match env.var("CODEX_HOME") {
                Some(value) => PathBuf::from(value),
                None => home_dir(env).join(".codex"),
            };
            root.join("skills")
        }
        ("claude", "repo") => resolve_repo_root(cwd).join(".claude").join("skills"),
        ("claude", "user") => home_dir(env).join(".claude").join("skills"),
        ("portable" | "amp" | "goose", "repo") => {
            resolve_repo_root(cwd).join(".agents").join("skills")
        }
        ("portable" | "amp" | "goose", "user") => config_root(env).join("agents").join("skills"),
        ("vscode" | "copilot", "repo") => resolve_repo_root(cwd).join(".github").join("skills"),
        ("opencode", "repo") => resolve_repo_root(cwd).join(".opencode").join("skill"),
        ("opencode", "user") => config_root(env).join("opencode").join("skill"),
        ("factory", "repo") => resolve_repo_root(cwd).join(".factory").join("skills"),
        ("factory", "user") => home_dir(env).join(".factory").join("skills"),
        ("cursor", "repo") => resolve_repo_root(cwd).join(".cursor").join("skills"),
        _ => {
            return Err(SkillflagError::new(format!(
                "Unsupported agent/scope: {agent} {scope}"
            )))
        }
    };
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |key: &str| map.get(key).cloned()
    }

    #[test]
    fn agent_and_scope_validation_messages() {
        assert_eq!(assert_agent("codex").unwrap(), "codex");
        assert_eq!(
            assert_agent("nope").unwrap_err().message,
            "Unsupported agent: nope"
        );
        assert_eq!(assert_scope("repo").unwrap(), "repo");
        assert_eq!(
            assert_scope("global").unwrap_err().message,
            "Unsupported scope: global"
        );
    }

    #[test]
    fn unsupported_combination_message() {
        let err = assert_supported_agent_scopes(&["claude".to_string()], &["cwd".to_string()])
            .unwrap_err();
        assert_eq!(err.message, "Unsupported agent/scope: claude cwd");
    }

    #[test]
    fn codex_user_honors_codex_home() {
        let lookup = env(&[("CODEX_HOME", "/custom/codex"), ("HOME", "/home/u")]);
        let root = resolve_skills_root("codex", "user", Path::new("/x"), &lookup).unwrap();
        assert_eq!(root, PathBuf::from("/custom/codex/skills"));
    }

    #[test]
    fn codex_user_defaults_to_home_dot_codex() {
        let lookup = env(&[("HOME", "/home/u")]);
        let root = resolve_skills_root("codex", "user", Path::new("/x"), &lookup).unwrap();
        assert_eq!(root, PathBuf::from("/home/u/.codex/skills"));
    }

    #[test]
    fn portable_user_honors_xdg_config_home() {
        let lookup = env(&[("XDG_CONFIG_HOME", "/xdg"), ("HOME", "/home/u")]);
        for agent in ["portable", "amp", "goose"] {
            let root = resolve_skills_root(agent, "user", Path::new("/x"), &lookup).unwrap();
            assert_eq!(root, PathBuf::from("/xdg/agents/skills"));
        }
    }

    #[test]
    fn portable_user_defaults_to_dot_config() {
        let lookup = env(&[("HOME", "/home/u")]);
        let root = resolve_skills_root("portable", "user", Path::new("/x"), &lookup).unwrap();
        assert_eq!(root, PathBuf::from("/home/u/.config/agents/skills"));
    }

    #[test]
    fn opencode_uses_singular_skill() {
        let lookup = env(&[("XDG_CONFIG_HOME", "/xdg"), ("HOME", "/home/u")]);
        let root = resolve_skills_root("opencode", "user", Path::new("/x"), &lookup).unwrap();
        assert_eq!(root, PathBuf::from("/xdg/opencode/skill"));
    }

    #[test]
    fn user_scope_home_destinations() {
        let lookup = env(&[("HOME", "/home/u")]);
        assert_eq!(
            resolve_skills_root("claude", "user", Path::new("/x"), &lookup).unwrap(),
            PathBuf::from("/home/u/.claude/skills")
        );
        assert_eq!(
            resolve_skills_root("factory", "user", Path::new("/x"), &lookup).unwrap(),
            PathBuf::from("/home/u/.factory/skills")
        );
    }

    #[test]
    fn codex_cwd_scope_uses_cwd() {
        let lookup = env(&[("HOME", "/home/u")]);
        let root = resolve_skills_root("codex", "cwd", Path::new("/work/dir"), &lookup).unwrap();
        assert_eq!(root, PathBuf::from("/work/dir/.codex/skills"));
    }

    #[test]
    fn scope_tables_match_reference() {
        assert_eq!(
            supported_scopes_for_agent("codex"),
            &["repo", "cwd", "user"]
        );
        assert_eq!(supported_scopes_for_agent("claude"), &["repo", "user"]);
        assert_eq!(supported_scopes_for_agent("vscode"), &["repo"]);
        assert_eq!(supported_scopes_for_agent("copilot"), &["repo"]);
        assert_eq!(supported_scopes_for_agent("cursor"), &["repo"]);
        assert_eq!(supported_scopes_for_agent("opencode"), &["repo", "user"]);
    }

    #[test]
    fn unknown_combination_is_rejected() {
        let lookup = env(&[("HOME", "/home/u")]);
        let err = resolve_skills_root("vscode", "user", Path::new("/x"), &lookup).unwrap_err();
        assert_eq!(err.message, "Unsupported agent/scope: vscode user");
    }
}
