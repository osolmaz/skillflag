"""`--skill list` implementations (text info + JSON payload)."""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from skillflag._util import utf8_sort_key
from skillflag.core.digest import digest_sha256
from skillflag.core.paths import list_skill_dirs
from skillflag.core.tar import collect_skill_entries, write_tar_bytes
from skillflag.frontmatter import parse_frontmatter

SKILLFLAG_VERSION = "0.1"


@dataclass(frozen=True)
class SkillInfo:
    id: str
    dir: str
    summary: str | None = None
    version: str | None = None


def _read_skill_info(skill_dir: str, skill_id: str) -> SkillInfo:
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    try:
        with open(skill_md_path, encoding="utf-8", errors="replace") as handle:
            content = handle.read()
    except OSError:
        return SkillInfo(id=skill_id, dir=skill_dir)

    fields = parse_frontmatter(content)
    description = fields.get("description")
    summary = description.replace("\t", " ").replace("\n", " ").strip() if description else None
    return SkillInfo(
        id=skill_id,
        dir=skill_dir,
        summary=summary,
        version=fields.get("version"),
    )


def list_skills(root_dirs: Sequence[str]) -> list[SkillInfo]:
    seen: dict[str, str] = {}
    for root_dir in root_dirs:
        for skill in list_skill_dirs(root_dir):
            if skill.id not in seen:
                seen[skill.id] = skill.dir

    infos = [_read_skill_info(skill_dir, skill_id) for skill_id, skill_dir in seen.items()]
    infos.sort(key=lambda info: utf8_sort_key(info.id))
    return infos


def list_skills_json(root_dirs: Sequence[str]) -> dict[str, Any]:
    skills = list_skills(root_dirs)
    results: list[dict[str, Any]] = []

    for skill in skills:
        entries, file_count = collect_skill_entries(skill.dir, skill.id)
        digest = digest_sha256(write_tar_bytes(entries))

        item: dict[str, Any] = {"id": skill.id, "digest": digest}
        if file_count > 0:
            item["files"] = file_count
        if skill.summary:
            item["summary"] = skill.summary
        if skill.version:
            item["version"] = skill.version
        results.append(item)

    return {"skillflag_version": SKILLFLAG_VERSION, "skills": results}
