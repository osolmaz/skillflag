"""Agent/scope destination table (port of typescript/src/install/resolve.ts)."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Callable, Sequence
from pathlib import Path

from skillflag._util import unique_values
from skillflag.install.errors import InstallError

AGENTS = (
    "codex",
    "claude",
    "portable",
    "vscode",
    "copilot",
    "amp",
    "goose",
    "opencode",
    "factory",
    "cursor",
)

SCOPES = ("repo", "user", "cwd")


def resolve_repo_root(cwd: str) -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        if out:
            return out
    except (OSError, subprocess.CalledProcessError):
        pass
    return cwd


def _home() -> str:
    return str(Path.home())


def _config_root() -> str:
    value = os.environ.get("XDG_CONFIG_HOME")
    if value is not None:
        return value
    return os.path.join(_home(), ".config")


def _codex_home() -> str:
    value = os.environ.get("CODEX_HOME")
    if value is not None:
        return value
    return os.path.join(_home(), ".codex")


# Insertion order of scopes matters: it drives the interactive scope listing.
_SCOPE_RESOLVERS: dict[str, dict[str, Callable[[str], str]]] = {
    "codex": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".codex", "skills"),
        "cwd": lambda cwd: os.path.join(cwd, ".codex", "skills"),
        "user": lambda cwd: os.path.join(_codex_home(), "skills"),
    },
    "claude": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".claude", "skills"),
        "user": lambda cwd: os.path.join(_home(), ".claude", "skills"),
    },
    "portable": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".agents", "skills"),
        "user": lambda cwd: os.path.join(_config_root(), "agents", "skills"),
    },
    "vscode": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".github", "skills"),
    },
    "copilot": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".github", "skills"),
    },
    "amp": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".agents", "skills"),
        "user": lambda cwd: os.path.join(_config_root(), "agents", "skills"),
    },
    "goose": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".agents", "skills"),
        "user": lambda cwd: os.path.join(_config_root(), "agents", "skills"),
    },
    "opencode": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".opencode", "skill"),
        "user": lambda cwd: os.path.join(_config_root(), "opencode", "skill"),
    },
    "factory": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".factory", "skills"),
        "user": lambda cwd: os.path.join(_home(), ".factory", "skills"),
    },
    "cursor": {
        "repo": lambda cwd: os.path.join(resolve_repo_root(cwd), ".cursor", "skills"),
    },
}


def assert_agent(value: str) -> str:
    if value in AGENTS:
        return value
    raise InstallError(f"Unsupported agent: {value}")


def assert_scope(value: str) -> str:
    if value in SCOPES:
        return value
    raise InstallError(f"Unsupported scope: {value}")


def supported_scopes_for_agent(agent: str) -> list[str]:
    return list(_SCOPE_RESOLVERS[agent].keys())


def shared_scopes_for_agents(agents: Sequence[str]) -> list[str]:
    unique_agents = unique_values(agents)
    if not unique_agents:
        return []
    first = unique_agents[0]
    return [
        scope
        for scope in supported_scopes_for_agent(first)
        if all(scope in supported_scopes_for_agent(agent) for agent in unique_agents)
    ]


def assert_supported_agent_scopes(agents: Sequence[str], scopes: Sequence[str]) -> None:
    for agent in unique_values(agents):
        supported = supported_scopes_for_agent(agent)
        for scope in unique_values(scopes):
            if scope not in supported:
                raise InstallError(f"Unsupported agent/scope: {agent} {scope}")


def resolve_skills_root(agent: str, scope: str, cwd: str) -> str:
    resolver = _SCOPE_RESOLVERS[agent].get(scope)
    if resolver is None:
        raise InstallError(f"Unsupported agent/scope: {agent} {scope}")
    return resolver(cwd)
