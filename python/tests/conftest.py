from __future__ import annotations

import io
import subprocess
from pathlib import Path

import pytest

from skillflag.cli import SkillflagOptions, handle_skillflag

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_SKILLS = REPO_ROOT / "fixtures" / "skills"


class FakeTty(io.StringIO):
    """Text stream that reports itself as an interactive TTY."""

    def isatty(self) -> bool:
        return True


def run_producer(
    args,
    *,
    skills_root=FIXTURES_SKILLS,
    include_bundled_skill=False,
    stdin=None,
    cwd=None,
):
    """Run handle_skillflag with node-style argv; return (code, stdout bytes, stderr text)."""
    stdout = io.BytesIO()
    stderr = io.StringIO()
    code = handle_skillflag(
        ["skillflag-py", "x", *args],
        SkillflagOptions(
            skills_root=skills_root,
            stdin=stdin if stdin is not None else io.BytesIO(),
            stdout=stdout,
            stderr=stderr,
            cwd=cwd,
            include_bundled_skill=include_bundled_skill,
        ),
    )
    return code, stdout.getvalue(), stderr.getvalue()


def make_skill_dir(root: Path, dir_name: str, *, name=None, description="A test skill") -> Path:
    skill_dir = root / dir_name
    skill_dir.mkdir(parents=True)
    frontmatter_name = name if name is not None else dir_name
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {frontmatter_name}\ndescription: {description}\n---\n\nBody.\n",
        encoding="utf-8",
    )
    return skill_dir


def tree_snapshot(root: Path) -> dict[str, bytes | None]:
    """Map of relative posix path -> file bytes (None for directories)."""
    snapshot: dict[str, bytes | None] = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        snapshot[rel] = path.read_bytes() if path.is_file() else None
    return snapshot


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True, capture_output=True)
    return repo
