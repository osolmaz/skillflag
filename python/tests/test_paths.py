from __future__ import annotations

from pathlib import Path

import pytest

from skillflag.core.errors import SkillflagError
from skillflag.core.paths import (
    default_skills_root,
    find_skills_root,
    find_skills_roots,
    resolve_skills_roots,
)


def test_find_skills_root_walks_upward(tmp_path):
    skills = tmp_path / "skills"
    skills.mkdir()
    nested = tmp_path / "a" / "b"
    nested.mkdir(parents=True)
    assert find_skills_root(nested) == skills


def test_find_skills_root_from_file_start(tmp_path):
    skills = tmp_path / "skills"
    skills.mkdir()
    start = tmp_path / "module.py"
    start.write_text("", encoding="utf-8")
    assert find_skills_root(start) == skills


def test_find_skills_roots_prefers_skills_then_agents(tmp_path):
    skills = tmp_path / "skills"
    agents = tmp_path / ".agents" / "skills"
    skills.mkdir()
    agents.mkdir(parents=True)
    assert find_skills_roots(tmp_path) == [skills, agents]


def test_find_skills_root_agents_fallback(tmp_path):
    agents = tmp_path / ".agents" / "skills"
    agents.mkdir(parents=True)
    assert find_skills_root(tmp_path) == agents


def test_find_skills_root_error_when_absent():
    with pytest.raises(SkillflagError, match="Could not find a skills/"):
        find_skills_roots("/nonexistent-skillflag-test-root")


def test_resolve_skills_roots_dedupes(tmp_path):
    roots = resolve_skills_roots([tmp_path, str(tmp_path), tmp_path / "."])
    assert roots == [str(tmp_path)]


def test_default_skills_root_contains_bundled_skill():
    root = default_skills_root()
    assert isinstance(root, Path)
    assert (root / "skillflag" / "SKILL.md").is_file()
