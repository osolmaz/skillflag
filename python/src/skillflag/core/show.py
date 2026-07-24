"""`--skill show <id>`: raw SKILL.md bytes."""

from __future__ import annotations

import os


def read_skill_md(skill_dir: str) -> bytes:
    with open(os.path.join(skill_dir, "SKILL.md"), "rb") as handle:
        return handle.read()
