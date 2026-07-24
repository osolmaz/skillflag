from __future__ import annotations

import io
import os

import pytest

from conftest import FIXTURES_SKILLS, FakeTty, run_producer
from skillflag.cli import (
    SKILLFLAG_HELP_TEXT,
    SkillflagOptions,
    main,
    maybe_handle_skillflag,
)


def test_show_prints_raw_skill_md():
    code, stdout, stderr = run_producer(["--skill", "show", "alpha"])
    assert code == 0
    assert stderr == ""
    assert stdout == (FIXTURES_SKILLS / "alpha" / "SKILL.md").read_bytes()


def test_unknown_id_error_and_exit_code():
    for action in ("export", "show"):
        code, stdout, stderr = run_producer(["--skill", action, "nope"])
        assert code == 1
        assert stdout == b""
        assert stderr == "Skill not found: nope\n"


@pytest.mark.parametrize("bad_id", [".", ".."])
def test_dot_ids_rejected(bad_id):
    code, _, stderr = run_producer(["--skill", "export", bad_id])
    assert code == 1
    assert stderr == "Skill id is required.\n"


@pytest.mark.parametrize("bad_id", ["a/b", "a\\b"])
def test_ids_with_separators_rejected(bad_id):
    code, _, stderr = run_producer(["--skill", "export", bad_id])
    assert code == 1
    assert stderr == f"Invalid skill id: {bad_id}\n"


def test_missing_action():
    code, _, stderr = run_producer(["--skill"])
    assert code == 1
    assert stderr.startswith("Missing --skill action.\nUsage:")


def test_unknown_action():
    code, _, stderr = run_producer(["--skill", "bogus"])
    assert code == 1
    assert stderr.startswith("Unknown --skill action: bogus.\nUsage:")


def test_missing_skill_id_for_export():
    code, _, stderr = run_producer(["--skill", "export"])
    assert code == 1
    assert stderr.startswith("Missing skill id.\nUsage:")


def test_help_action():
    code, stdout, _ = run_producer(["--skill", "help"])
    assert code == 0
    assert stdout.decode("utf-8") == SKILLFLAG_HELP_TEXT + "\n"


def test_action_without_skill_token():
    # The standalone binary accepts the action directly.
    code, stdout, _ = run_producer(["list"])
    assert code == 0
    assert stdout == b"alpha\tAlpha test skill\nbeta\tBeta test skill\n"


def test_args_after_skill_token_win():
    code, stdout, _ = run_producer(["ignored", "tokens", "--skill", "list"])
    assert code == 0
    assert stdout.startswith(b"alpha\t")


def test_bundled_skill_included_by_default(tmp_path):
    empty = tmp_path / "skills"
    empty.mkdir()
    code, stdout, _ = run_producer(
        ["--skill", "list"], skills_root=empty, include_bundled_skill=True
    )
    assert code == 0
    assert stdout.startswith(b"skillflag\t")


def test_bundled_skill_has_lowest_precedence(tmp_path):
    root = tmp_path / "skills"
    skill = root / "skillflag"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: skillflag\ndescription: Local override\n---\n", encoding="utf-8"
    )
    code, stdout, _ = run_producer(
        ["--skill", "list"], skills_root=root, include_bundled_skill=True
    )
    assert code == 0
    assert stdout == b"skillflag\tLocal override\n"


def test_maybe_handle_returns_false_without_skill_token():
    opts = SkillflagOptions(skills_root=FIXTURES_SKILLS, stdout=io.BytesIO())
    assert maybe_handle_skillflag(["tool", "x", "build"], opts) is False


def test_maybe_handle_handles_and_exits():
    stdout = io.BytesIO()
    opts = SkillflagOptions(skills_root=FIXTURES_SKILLS, stdout=stdout, include_bundled_skill=False)
    codes: list[int] = []
    handled = maybe_handle_skillflag(["tool", "x", "--skill", "list"], opts, exit=codes.append)
    assert handled is True
    assert codes == [0]
    assert stdout.getvalue().startswith(b"alpha\t")


def test_maybe_handle_exit_false_does_not_exit():
    opts = SkillflagOptions(
        skills_root=FIXTURES_SKILLS, stdout=io.BytesIO(), include_bundled_skill=False
    )
    assert maybe_handle_skillflag(["tool", "x", "--skill", "list"], opts, exit=False) is True


def test_export_uses_buffer_of_text_stdout():
    class TextWithBuffer(io.StringIO):
        def __init__(self):
            super().__init__()
            self.buffer = io.BytesIO()

    stdout = TextWithBuffer()
    opts = SkillflagOptions(skills_root=FIXTURES_SKILLS, stdout=stdout, include_bundled_skill=False)
    from skillflag.cli import handle_skillflag

    assert handle_skillflag(["x", "y", "--skill", "export", "alpha"], opts) == 0
    assert stdout.getvalue() == ""  # nothing written as text
    assert len(stdout.buffer.getvalue()) == 8 * 512


def test_main_uses_env_skills_roots(monkeypatch, capsys):
    monkeypatch.setenv("SKILLFLAG_SKILLS_ROOT", str(FIXTURES_SKILLS))
    assert main(["list"]) == 0
    captured = capsys.readouterr()
    # Env roots replace the bundled skill entirely.
    assert captured.out == "alpha\tAlpha test skill\nbeta\tBeta test skill\n"


def test_main_env_skills_roots_supports_pathsep_list(monkeypatch, capsys, tmp_path):
    other = tmp_path / "more-skills" / "zeta"
    other.mkdir(parents=True)
    (other / "SKILL.md").write_text("---\nname: zeta\ndescription: Zeta\n---\n", encoding="utf-8")
    monkeypatch.setenv(
        "SKILLFLAG_SKILLS_ROOT",
        os.pathsep.join([str(FIXTURES_SKILLS), str(tmp_path / "more-skills")]),
    )
    assert main(["list"]) == 0
    captured = capsys.readouterr()
    assert captured.out == "alpha\tAlpha test skill\nbeta\tBeta test skill\nzeta\tZeta\n"


def test_main_without_env_lists_bundled_skill_only(monkeypatch, capsys):
    monkeypatch.delenv("SKILLFLAG_SKILLS_ROOT", raising=False)
    assert main(["list"]) == 0
    captured = capsys.readouterr()
    lines = captured.out.splitlines()
    assert len(lines) == 1
    assert lines[0].startswith("skillflag\t")


def test_main_routes_install_to_installer(capsys):
    assert main(["install", "--help"]) == 0
    captured = capsys.readouterr()
    assert captured.out.startswith("Usage:\n  skill-install")


def test_producer_install_requires_id_when_multiple_and_not_tty():
    code, _, stderr = run_producer(
        ["--skill", "install", "--agent", "codex", "--scope", "cwd"],
        stdin=io.BytesIO(),
    )
    assert code == 1
    assert stderr == (
        "Multiple skills are available; pass one or more ids with --skill install <id> [...].\n"
    )


def test_producer_install_no_skills_available(tmp_path):
    empty = tmp_path / "skills"
    empty.mkdir()
    code, _, stderr = run_producer(
        ["--skill", "install", "--agent", "codex", "--scope", "cwd"],
        skills_root=empty,
        stdin=io.BytesIO(),
    )
    assert code == 1
    assert stderr == "No skills are available to install.\n"


def test_producer_install_single_skill_auto_selected(tmp_path):
    root = tmp_path / "skills"
    solo = root / "solo"
    solo.mkdir(parents=True)
    (solo / "SKILL.md").write_text("---\nname: solo\ndescription: d\n---\n", encoding="utf-8")
    workdir = tmp_path / "work"
    workdir.mkdir()

    code, stdout, stderr = run_producer(
        ["--skill", "install", "--agent", "codex", "--scope", "cwd"],
        skills_root=root,
        stdin=io.BytesIO(),
        cwd=str(workdir),
    )
    assert code == 0, stderr
    dest = workdir / ".codex" / "skills" / "solo"
    assert (dest / "SKILL.md").is_file()
    assert stderr == f"Installed solo to {dest} (codex/cwd)\n"
    assert stdout == b""


def test_producer_install_ids_comma_split_and_dedupe(tmp_path):
    workdir = tmp_path / "work"
    workdir.mkdir()
    code, _, stderr = run_producer(
        ["--skill", "install", "alpha,beta", "alpha", "--agent", "codex", "--scope", "cwd"],
        stdin=io.BytesIO(),
        cwd=str(workdir),
    )
    assert code == 0, stderr
    assert (workdir / ".codex" / "skills" / "alpha" / "SKILL.md").is_file()
    assert (workdir / ".codex" / "skills" / "beta" / "SKILL.md").is_file()
    assert stderr.count("Installed ") == 2


def test_producer_install_interactive_prompt(tmp_path):
    workdir = tmp_path / "work"
    workdir.mkdir()
    stdin = FakeTty("2\n")
    code, _, stderr = run_producer(
        ["--skill", "install", "--agent", "codex", "--scope", "cwd"],
        stdin=stdin,
        cwd=str(workdir),
    )
    assert code == 0, stderr
    assert "Available skills:" in stderr
    assert "1) alpha" in stderr
    assert (workdir / ".codex" / "skills" / "beta" / "SKILL.md").is_file()
    assert not (workdir / ".codex" / "skills" / "alpha").exists()


def test_producer_install_interactive_invalid_selection(tmp_path):
    stdin = FakeTty("99\n")
    code, _, stderr = run_producer(
        ["--skill", "install", "--agent", "codex", "--scope", "cwd"],
        stdin=stdin,
        cwd=str(tmp_path),
    )
    assert code == 1
    assert stderr.endswith("Invalid selection: 99\n")


def test_producer_install_unknown_id():
    code, _, stderr = run_producer(
        ["--skill", "install", "ghost", "--agent", "codex", "--scope", "cwd"],
        stdin=io.BytesIO(),
    )
    assert code == 1
    assert stderr == "Skill not found: ghost\n"
