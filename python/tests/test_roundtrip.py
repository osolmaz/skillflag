from __future__ import annotations

import io

from conftest import FIXTURES_SKILLS, run_producer, tree_snapshot
from skillflag.install.cli import run_install_cli


def test_export_install_round_trip(git_repo):
    code, tar_bytes, _ = run_producer(["--skill", "export", "alpha"])
    assert code == 0

    stderr = io.StringIO()
    install_code = run_install_cli(
        ["skill-install-py", "skill-install", "--agent", "codex", "--scope", "repo"],
        stdin=io.BytesIO(tar_bytes),
        stdout=io.BytesIO(),
        stderr=stderr,
        cwd=str(git_repo),
    )
    assert install_code == 0, stderr.getvalue()

    installed = git_repo / ".codex" / "skills" / "alpha"
    assert stderr.getvalue() == f"Installed alpha to {installed} (codex/repo)\n"
    assert tree_snapshot(installed) == tree_snapshot(FIXTURES_SKILLS / "alpha")


def test_producer_install_action_round_trip(git_repo):
    code, _, stderr = run_producer(
        ["--skill", "install", "alpha", "--agent", "codex", "--scope", "repo"],
        stdin=io.BytesIO(),
        cwd=str(git_repo),
    )
    assert code == 0, stderr
    installed = git_repo / ".codex" / "skills" / "alpha"
    assert tree_snapshot(installed) == tree_snapshot(FIXTURES_SKILLS / "alpha")
