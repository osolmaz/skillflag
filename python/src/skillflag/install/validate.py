"""Skill bundle validation (port of typescript/src/install/validate.ts)."""

from __future__ import annotations

import os
from dataclasses import dataclass

from skillflag.frontmatter import parse_frontmatter
from skillflag.install.errors import InstallError


@dataclass(frozen=True)
class SkillMetadata:
    name: str
    description: str


def assert_skill_dir(root_dir: str) -> None:
    if not os.path.exists(os.path.join(root_dir, "SKILL.md")):
        raise InstallError("SKILL.md not found in skill root.")


def read_skill_metadata(root_dir: str) -> SkillMetadata:
    skill_md_path = os.path.join(root_dir, "SKILL.md")
    with open(skill_md_path, encoding="utf-8", errors="replace") as handle:
        content = handle.read()
    fields = parse_frontmatter(content)
    name = fields.get("name")
    description = fields.get("description")

    if not name:
        raise InstallError("SKILL.md metadata is missing name.")
    if not description:
        raise InstallError("SKILL.md metadata is missing description.")

    return SkillMetadata(name=name, description=description)
