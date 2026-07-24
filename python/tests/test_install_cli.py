from __future__ import annotations

import io

from conftest import FIXTURES_SKILLS, FakeTty, make_skill_dir, run_producer
from skillflag.install.cli import run_install_cli


def run_installer(args, *, stdin=None, cwd=None, **kwargs):
    stdout = io.BytesIO()
    stderr = io.StringIO()
    code = run_install_cli(
        ["skill-install-py", "skill-install", *args],
        stdin=stdin if stdin is not None else io.BytesIO(),
        stdout=stdout,
        stderr=stderr,
        cwd=cwd,
        **kwargs,
    )
    return code, stdout.getvalue(), stderr.getvalue()


def export_fixture(skill_id: str) -> bytes:
    code, stdout, _ = run_producer(["--skill", "export", skill_id])
    assert code == 0
    return stdout


def test_install_from_directory(tmp_path):
    code, stdout, stderr = run_installer(
        [str(FIXTURES_SKILLS / "alpha"), "--agent", "codex", "--scope", "cwd"],
        cwd=str(tmp_path),
    )
    dest = tmp_path / ".codex" / "skills" / "alpha"
    assert code == 0, stderr
    assert stdout == b""
    assert stderr == f"Installed alpha to {dest} (codex/cwd)\n"
    assert (dest / "SKILL.md").read_bytes() == (FIXTURES_SKILLS / "alpha" / "SKILL.md").read_bytes()
    assert (dest / "templates" / "hello.txt").is_file()


def test_install_from_stdin_tar(tmp_path):
    code, _, stderr = run_installer(
        ["--agent", "codex", "--scope", "cwd"],
        stdin=io.BytesIO(export_fixture("alpha")),
        cwd=str(tmp_path),
    )
    assert code == 0, stderr
    assert (tmp_path / ".codex" / "skills" / "alpha" / "templates" / "hello.txt").is_file()


def test_install_multiple_paths(tmp_path):
    code, _, stderr = run_installer(
        [
            str(FIXTURES_SKILLS / "alpha"),
            str(FIXTURES_SKILLS / "beta"),
            "--agent",
            "codex",
            "--scope",
            "cwd",
        ],
        cwd=str(tmp_path),
    )
    assert code == 0, stderr
    assert (tmp_path / ".codex" / "skills" / "alpha").is_dir()
    assert (tmp_path / ".codex" / "skills" / "beta").is_dir()


def test_destination_exists_error(tmp_path):
    dest = tmp_path / ".codex" / "skills" / "alpha"
    dest.mkdir(parents=True)
    code, _, stderr = run_installer(
        [str(FIXTURES_SKILLS / "alpha"), "--agent", "codex", "--scope", "cwd"],
        cwd=str(tmp_path),
    )
    assert code == 1
    assert stderr == f"Destination already exists: {dest}\n"


def test_force_overwrites_destination(tmp_path):
    dest = tmp_path / ".codex" / "skills" / "alpha"
    dest.mkdir(parents=True)
    (dest / "stale.txt").write_text("stale", encoding="utf-8")
    code, _, stderr = run_installer(
        [str(FIXTURES_SKILLS / "alpha"), "--agent", "codex", "--scope", "cwd", "--force"],
        cwd=str(tmp_path),
    )
    assert code == 0, stderr
    assert not (dest / "stale.txt").exists()
    assert (dest / "SKILL.md").is_file()


def test_destination_uses_frontmatter_name_not_dir_name(tmp_path):
    source = make_skill_dir(tmp_path / "src", "some-dir-name", name="real-name")
    code, _, stderr = run_installer(
        [str(source), "--agent", "codex", "--scope", "cwd"], cwd=str(tmp_path)
    )
    assert code == 0, stderr
    assert (tmp_path / ".codex" / "skills" / "real-name").is_dir()
    assert not (tmp_path / ".codex" / "skills" / "some-dir-name").exists()


def test_install_preserves_execute_bits(tmp_path):
    source = make_skill_dir(tmp_path / "src", "tool")
    script = source / "run.sh"
    script.write_text("#!/bin/sh\n", encoding="utf-8")
    script.chmod(0o755)
    code, _, stderr = run_installer(
        [str(source), "--agent", "codex", "--scope", "cwd"], cwd=str(tmp_path)
    )
    assert code == 0, stderr
    installed = tmp_path / ".codex" / "skills" / "tool" / "run.sh"
    assert installed.stat().st_mode & 0o111 == 0o111


def test_missing_skill_md(tmp_path):
    source = tmp_path / "src" / "empty"
    source.mkdir(parents=True)
    code, _, stderr = run_installer(
        [str(source), "--agent", "codex", "--scope", "cwd"], cwd=str(tmp_path)
    )
    assert code == 1
    assert stderr == "SKILL.md not found in skill root.\n"


def test_missing_name_metadata(tmp_path):
    source = tmp_path / "src" / "anon"
    source.mkdir(parents=True)
    (source / "SKILL.md").write_text("---\ndescription: d\n---\n", encoding="utf-8")
    code, _, stderr = run_installer(
        [str(source), "--agent", "codex", "--scope", "cwd"], cwd=str(tmp_path)
    )
    assert code == 1
    assert stderr == "SKILL.md metadata is missing name.\n"


def test_missing_description_metadata(tmp_path):
    source = tmp_path / "src" / "nodesc"
    source.mkdir(parents=True)
    (source / "SKILL.md").write_text("---\nname: nodesc\n---\n", encoding="utf-8")
    code, _, stderr = run_installer(
        [str(source), "--agent", "codex", "--scope", "cwd"], cwd=str(tmp_path)
    )
    assert code == 1
    assert stderr == "SKILL.md metadata is missing description.\n"


def test_path_does_not_exist(tmp_path):
    missing = tmp_path / "nope"
    code, _, stderr = run_installer(
        [str(missing), "--agent", "codex", "--scope", "cwd"], cwd=str(tmp_path)
    )
    assert code == 1
    assert stderr == f"PATH does not exist: {missing}\n"


def test_path_must_be_directory(tmp_path):
    file_path = tmp_path / "file.txt"
    file_path.write_text("x", encoding="utf-8")
    code, _, stderr = run_installer(
        [str(file_path), "--agent", "codex", "--scope", "cwd"], cwd=str(tmp_path)
    )
    assert code == 1
    assert stderr == "PATH must be a directory containing SKILL.md.\n"


def test_unknown_option():
    code, _, stderr = run_installer(["--bogus"])
    assert code == 1
    assert stderr == "Unknown option: --bogus\n"


def test_comma_separated_agent_rejected():
    code, _, stderr = run_installer(["--agent", "codex,claude", "--scope", "repo"])
    assert code == 1
    assert stderr == (
        "Only one value is allowed for --agent. Comma-separated values are not supported.\n"
    )


def test_comma_separated_scope_rejected():
    code, _, stderr = run_installer(["--agent", "codex", "--scope", "repo,user"])
    assert code == 1
    assert stderr == (
        "Only one value is allowed for --scope. Comma-separated values are not supported.\n"
    )


def test_repeated_agent_flag_rejected():
    code, _, stderr = run_installer(["--agent", "codex", "--agent", "claude"])
    assert code == 1
    assert stderr == "Only one --agent flag is allowed.\n"


def test_missing_agent_value():
    code, _, stderr = run_installer(["--agent"])
    assert code == 1
    assert stderr == "Missing value for --agent.\n"


def test_unsupported_agent():
    code, _, stderr = run_installer(["--agent", "emacs", "--scope", "repo"])
    assert code == 1
    assert stderr == "Unsupported agent: emacs\n"


def test_unsupported_scope():
    code, _, stderr = run_installer(["--agent", "codex", "--scope", "galaxy"])
    assert code == 1
    assert stderr == "Unsupported scope: galaxy\n"


def test_unsupported_agent_scope_combo():
    code, _, stderr = run_installer(["--agent", "claude", "--scope", "cwd"])
    assert code == 1
    assert stderr == "Unsupported agent/scope: claude cwd\n"


def test_missing_flags_non_tty():
    code, _, stderr = run_installer([str(FIXTURES_SKILLS / "alpha")], stdin=io.BytesIO())
    assert code == 1
    assert stderr.startswith("Missing required flags.\nUsage:")


def test_missing_path_and_no_stdin_data():
    stdin = FakeTty("")  # TTY: no tar stream on stdin, wizard collects flags first
    code, _, stderr = run_installer(["--agent", "codex", "--scope", "cwd"], stdin=stdin)
    assert code == 1
    assert stderr.startswith("Missing PATH or tar stream on stdin.\nUsage:")


def test_help_flag():
    code, stdout, stderr = run_installer(["--help"])
    assert code == 0
    assert stderr == ""
    assert stdout.decode("utf-8").startswith("Usage:\n  skill-install")


def test_collision_detection(tmp_path):
    first = make_skill_dir(tmp_path / "a", "dir-one", name="same-id")
    second = make_skill_dir(tmp_path / "b", "dir-two", name="same-id")
    code, _, stderr = run_installer(
        [str(first), str(second), "--agent", "codex", "--scope", "cwd"],
        cwd=str(tmp_path),
    )
    assert code == 1
    assert stderr.startswith("Install destination collisions detected:")
    assert "same-id @ codex/cwd" in stderr
    assert "Resolve collisions" in stderr
    # Nothing was written before the collision was detected.
    assert not (tmp_path / ".codex").exists()


def test_wizard_prompts_for_agent_and_scope(tmp_path):
    stdin = FakeTty("1\n2\n")  # agent 1 = codex; scope 2 = cwd (codex order: repo, cwd, user)
    code, stdout, stderr = run_installer(
        [str(FIXTURES_SKILLS / "alpha")], stdin=stdin, cwd=str(tmp_path)
    )
    assert code == 0, stderr
    assert stdout == b""
    assert "Select an agent:" in stderr
    assert "1) codex" in stderr
    assert "Select a scope:" in stderr
    assert (tmp_path / ".codex" / "skills" / "alpha").is_dir()


def test_wizard_accepts_names(tmp_path):
    stdin = FakeTty("codex\ncwd\n")
    code, _, stderr = run_installer(
        [str(FIXTURES_SKILLS / "alpha")], stdin=stdin, cwd=str(tmp_path)
    )
    assert code == 0, stderr
    assert (tmp_path / ".codex" / "skills" / "alpha").is_dir()


def test_wizard_prompts_only_missing_scope(tmp_path):
    stdin = FakeTty("cwd\n")
    code, _, stderr = run_installer(
        [str(FIXTURES_SKILLS / "alpha"), "--agent", "codex"], stdin=stdin, cwd=str(tmp_path)
    )
    assert code == 0, stderr
    assert "Select an agent:" not in stderr
    assert "Select a scope:" in stderr


def test_wizard_cancelled_on_eof(tmp_path):
    stdin = FakeTty("")
    code, _, stderr = run_installer(
        [str(FIXTURES_SKILLS / "alpha")], stdin=stdin, cwd=str(tmp_path)
    )
    assert code == 1
    assert stderr.endswith("Install cancelled.\n")


def test_error_drains_piped_stdin(tmp_path):
    stdin = io.BytesIO(export_fixture("alpha"))
    code, _, _ = run_installer(["--agent", "emacs", "--scope", "repo"], stdin=stdin)
    assert code == 1
    assert stdin.read() == b""  # fully drained
