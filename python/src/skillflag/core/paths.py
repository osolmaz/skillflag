"""Skills root resolution and skill directory lookup (port of core/paths.ts)."""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Union
from urllib.parse import unquote, urlsplit

from skillflag._util import utf8_sort_key
from skillflag.core.errors import SkillflagError

SkillsRootInput = Union[str, "os.PathLike[str]"]

_PRODUCER_SKILLS_ROOTS = ("skills", os.path.join(".agents", "skills"))


@dataclass(frozen=True)
class SkillDir:
    id: str
    dir: str


def default_skills_root() -> Path:
    """Root of the skills bundled inside this package."""
    return Path(__file__).resolve().parent.parent / "skills"


def _to_path(root: SkillsRootInput) -> str:
    if isinstance(root, os.PathLike):
        return os.fspath(root)
    if root.startswith("file:"):
        return unquote(urlsplit(root).path)
    return root


def resolve_skills_root(root: SkillsRootInput) -> str:
    return os.path.abspath(_to_path(root))


def resolve_skills_roots(
    roots: SkillsRootInput | Sequence[SkillsRootInput],
) -> list[str]:
    inputs: Sequence[SkillsRootInput]
    if isinstance(roots, (str, os.PathLike)):
        inputs = [roots]
    else:
        inputs = roots
    resolved: list[str] = []
    for item in inputs:
        root = resolve_skills_root(item)
        if root not in resolved:
            resolved.append(root)
    return resolved


def _existing_producer_roots(directory: str) -> list[Path]:
    roots: list[Path] = []
    for rel in _PRODUCER_SKILLS_ROOTS:
        candidate = os.path.join(directory, rel)
        if os.path.isdir(candidate):
            roots.append(Path(candidate))
    return roots


def find_skills_roots(start: SkillsRootInput) -> list[Path]:
    """Walk upward from ``start`` looking for skills/ then .agents/skills/ dirs."""
    current = os.path.abspath(_to_path(start))
    if not os.path.isdir(current):
        current = os.path.dirname(current)

    while True:
        roots = _existing_producer_roots(current)
        if roots:
            return roots
        parent = os.path.dirname(current)
        if parent == current:
            raise SkillflagError(
                "Could not find a skills/ or .agents/skills/ directory. Pass skillsRoot explicitly."
            )
        current = parent


def find_skills_root(start: SkillsRootInput) -> Path:
    return find_skills_roots(start)[0]


def assert_valid_skill_id(skill_id: str) -> None:
    if not skill_id or skill_id in (".", ".."):
        raise SkillflagError("Skill id is required.")
    if "/" in skill_id or "\\" in skill_id:
        raise SkillflagError(f"Invalid skill id: {skill_id}")


def list_skill_dirs(root_dir: str) -> list[SkillDir]:
    try:
        entries = list(os.scandir(root_dir))
    except OSError:
        return []

    skills: list[SkillDir] = []
    for entry in entries:
        try:
            if not entry.is_dir(follow_symlinks=False):
                continue
        except OSError:
            continue
        if os.path.exists(os.path.join(entry.path, "SKILL.md")):
            skills.append(SkillDir(id=entry.name, dir=entry.path))

    skills.sort(key=lambda skill: utf8_sort_key(skill.id))
    return skills


def resolve_skill_dir(root_dir: str, skill_id: str) -> str:
    assert_valid_skill_id(skill_id)
    skill_dir = os.path.join(root_dir, skill_id)
    if not os.path.exists(os.path.join(skill_dir, "SKILL.md")):
        raise SkillflagError(f"Skill not found: {skill_id}")
    return skill_dir


def resolve_skill_dir_from_roots(root_dirs: Sequence[str], skill_id: str) -> str:
    assert_valid_skill_id(skill_id)
    for root_dir in root_dirs:
        skill_dir = os.path.join(root_dir, skill_id)
        if os.path.exists(os.path.join(skill_dir, "SKILL.md")):
            return skill_dir
    raise SkillflagError(f"Skill not found: {skill_id}")
