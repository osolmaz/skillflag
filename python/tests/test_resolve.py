from __future__ import annotations

import pytest

from skillflag.install.errors import InstallError
from skillflag.install.resolve import (
    AGENTS,
    resolve_repo_root,
    resolve_skills_root,
    shared_scopes_for_agents,
    supported_scopes_for_agent,
)


@pytest.fixture
def home(tmp_path, monkeypatch):
    home_dir = tmp_path / "home"
    home_dir.mkdir()
    monkeypatch.setenv("HOME", str(home_dir))
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    return home_dir


def test_repo_root_resolution(git_repo):
    nested = git_repo / "deep" / "nested"
    nested.mkdir(parents=True)
    assert resolve_repo_root(str(nested)) == str(git_repo)


def test_repo_root_falls_back_to_cwd(tmp_path):
    workdir = tmp_path / "plain"
    workdir.mkdir()
    assert resolve_repo_root(str(workdir)) == str(workdir)


def test_repo_scope_table(git_repo, home):
    cwd = str(git_repo)
    expected = {
        "codex": ".codex/skills",
        "claude": ".claude/skills",
        "portable": ".agents/skills",
        "vscode": ".github/skills",
        "copilot": ".github/skills",
        "amp": ".agents/skills",
        "goose": ".agents/skills",
        "opencode": ".opencode/skill",
        "factory": ".factory/skills",
        "cursor": ".cursor/skills",
    }
    for agent, rel in expected.items():
        assert resolve_skills_root(agent, "repo", cwd) == str(git_repo / rel)


def test_user_scope_table(home, tmp_path):
    cwd = str(tmp_path)
    expected = {
        "codex": home / ".codex" / "skills",
        "claude": home / ".claude" / "skills",
        "portable": home / ".config" / "agents" / "skills",
        "amp": home / ".config" / "agents" / "skills",
        "goose": home / ".config" / "agents" / "skills",
        "opencode": home / ".config" / "opencode" / "skill",
        "factory": home / ".factory" / "skills",
    }
    for agent, path in expected.items():
        assert resolve_skills_root(agent, "user", cwd) == str(path)


def test_codex_home_override(home, monkeypatch, tmp_path):
    codex_home = tmp_path / "custom-codex"
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    assert resolve_skills_root("codex", "user", str(tmp_path)) == str(codex_home / "skills")


def test_xdg_config_home_override(home, monkeypatch, tmp_path):
    xdg = tmp_path / "xdg"
    monkeypatch.setenv("XDG_CONFIG_HOME", str(xdg))
    for agent in ("portable", "amp", "goose"):
        assert resolve_skills_root(agent, "user", str(tmp_path)) == str(xdg / "agents" / "skills")
    assert resolve_skills_root("opencode", "user", str(tmp_path)) == str(xdg / "opencode" / "skill")


def test_cwd_scope_only_for_codex(tmp_path):
    cwd = str(tmp_path)
    assert resolve_skills_root("codex", "cwd", cwd) == str(tmp_path / ".codex" / "skills")
    for agent in AGENTS:
        if agent == "codex":
            continue
        with pytest.raises(InstallError, match=f"Unsupported agent/scope: {agent} cwd"):
            resolve_skills_root(agent, "cwd", cwd)


def test_user_scope_unsupported_for_vscode_copilot_cursor(tmp_path):
    for agent in ("vscode", "copilot", "cursor"):
        with pytest.raises(InstallError, match=f"Unsupported agent/scope: {agent} user"):
            resolve_skills_root(agent, "user", str(tmp_path))


def test_supported_and_shared_scopes():
    assert supported_scopes_for_agent("codex") == ["repo", "cwd", "user"]
    assert supported_scopes_for_agent("cursor") == ["repo"]
    assert shared_scopes_for_agents(["codex", "claude"]) == ["repo", "user"]
    assert shared_scopes_for_agents(["codex", "cursor"]) == ["repo"]
    assert shared_scopes_for_agents([]) == []
