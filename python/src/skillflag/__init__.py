"""Skillflag: producer `--skill` interface and skill-install companion (Python port)."""

from skillflag.cli import (
    SKILLFLAG_HELP_TEXT,
    SkillflagOptions,
    handle_skillflag,
    maybe_handle_skillflag,
)
from skillflag.core.errors import SkillflagError
from skillflag.core.paths import SkillsRootInput, find_skills_root, find_skills_roots

__all__ = [
    "SKILLFLAG_HELP_TEXT",
    "SkillflagError",
    "SkillflagOptions",
    "SkillsRootInput",
    "find_skills_root",
    "find_skills_roots",
    "handle_skillflag",
    "maybe_handle_skillflag",
]
