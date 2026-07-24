"""Producer dispatch: the `--skill` interface (port of typescript/src/skillflag.ts).

The interactive skill selection is deliberately simpler than the TypeScript
reference: a numbered prompt on stderr instead of a multi-select wizard.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import IO, Any

from skillflag._io import read_line as _read_line
from skillflag._io import stream_isatty, write_bytes, write_text
from skillflag._util import unique_values
from skillflag.core.errors import SkillflagError
from skillflag.core.list import SkillInfo, list_skills, list_skills_json
from skillflag.core.paths import (
    SkillsRootInput,
    default_skills_root,
    resolve_skill_dir_from_roots,
    resolve_skills_root,
    resolve_skills_roots,
)
from skillflag.core.show import read_skill_md
from skillflag.core.tar import build_skill_tar

SKILLS_ROOT_ENV_VAR = "SKILLFLAG_SKILLS_ROOT"

_USAGE_LINES = (
    "Usage:",
    "  --skill install [<id> ...] [--agent <agent>] [--scope <scope>] [--force]",
    "  --skill list [--json]",
    "  --skill export <id>",
    "  --skill show <id>",
    "  --skill help",
)

_USAGE_TEXT = "\n".join(_USAGE_LINES)

SKILLFLAG_HELP_TEXT = "\n".join(
    [
        "Skillflag help",
        "",
        "Install skillflag-py globally to get both binaries on your PATH:",
        "  pip install skillflag-py",
        "",
        "Prefer not to install globally? Use uvx for one-off runs:",
        "  uvx --from skillflag-py skillflag-py list",
        "  uvx --from skillflag-py skillflag-py install --agent codex --scope repo < ./skill.tar",
        "",
        "List available skills:",
        "  tool --skill list",
        "  tool --skill list --json",
        "",
        "Show a skill's documentation:",
        "  tool --skill show <id>",
        "",
        "Export a skill bundle:",
        "  tool --skill export <id>",
        "",
        "Install a skill bundle:",
        "  tool --skill install [<id> ...] [--agent <agent>] [--scope <scope>]",
        "  tool --skill export <id> | skill-install --agent <agent> --scope <scope>",
        "",
        "For full details, read docs/SKILLFLAG_SPEC.md.",
    ]
)


@dataclass
class SkillflagOptions:
    skills_root: SkillsRootInput | Sequence[SkillsRootInput]
    stdin: IO[Any] | None = None
    stdout: IO[Any] | None = None
    stderr: IO[Any] | None = None
    cwd: str | None = None
    include_bundled_skill: bool = True


@dataclass(frozen=True)
class _SkillAction:
    kind: str  # "install" | "list" | "export" | "show" | "help"
    id: str | None = None
    json: bool = False
    ids: tuple[str, ...] | None = None
    install_args: tuple[str, ...] = field(default=())


def _resolve_skill_action_args(argv: Sequence[str]) -> list[str]:
    cli_args = list(argv[2:]) if len(argv) > 2 else list(argv)
    if "--skill" in cli_args:
        return cli_args[cli_args.index("--skill") + 1 :]
    return cli_args


def _parse_install_ids(values: Sequence[str]) -> tuple[tuple[str, ...] | None, tuple[str, ...]]:
    ids: list[str] = []
    index = 0
    while index < len(values):
        value = values[index]
        if value.startswith("-"):
            break
        ids.extend(part.strip() for part in value.split(",") if part.strip())
        index += 1
    return (
        tuple(unique_values(ids)) if ids else None,
        tuple(values[index:]),
    )


def _parse_skill_args(argv: Sequence[str]) -> _SkillAction:
    args = _resolve_skill_action_args(argv)
    action = args[0] if args else None
    if not action or action.startswith("-"):
        raise SkillflagError(f"Missing --skill action.\n{_USAGE_TEXT}")

    if action == "install":
        ids, install_args = _parse_install_ids(args[1:])
        return _SkillAction(kind="install", ids=ids, install_args=install_args)

    if action == "list":
        return _SkillAction(kind="list", json="--json" in args[1:])

    if action == "help":
        return _SkillAction(kind="help")

    if action in ("export", "show"):
        skill_id = args[1] if len(args) > 1 else None
        if not skill_id or skill_id.startswith("-"):
            raise SkillflagError(f"Missing skill id.\n{_USAGE_TEXT}")
        return _SkillAction(kind=action, id=skill_id)

    raise SkillflagError(f"Unknown --skill action: {action}.\n{_USAGE_TEXT}")


def _resolve_install_skill_ids(
    ids: tuple[str, ...] | None,
    root_dirs: Sequence[str],
    stdin: IO[Any],
    stderr: IO[Any],
) -> list[str]:
    if ids:
        return list(ids)

    skills = list_skills(root_dirs)
    if not skills:
        raise SkillflagError("No skills are available to install.")
    if len(skills) == 1:
        return [skills[0].id]

    if not stream_isatty(stdin):
        raise SkillflagError(
            "Multiple skills are available; pass one or more ids with --skill install <id> [...]."
        )

    return _prompt_skill_ids(skills, stdin, stderr)


def _prompt_skill_ids(skills: Sequence[SkillInfo], stdin: IO[Any], stderr: IO[Any]) -> list[str]:
    write_text(stderr, "Available skills:\n")
    for index, skill in enumerate(skills, start=1):
        suffix = f"\t{skill.summary}" if skill.summary else ""
        write_text(stderr, f"  {index}) {skill.id}{suffix}\n")
    write_text(stderr, "Select skills to install (numbers or ids, comma-separated): ")

    line = _read_line(stdin)
    if line is None or not line.strip():
        raise SkillflagError("Install cancelled.")

    known_ids = [skill.id for skill in skills]
    selected: list[str] = []
    for token in (part.strip() for part in line.split(",")):
        if not token:
            continue
        if token.isdigit():
            index = int(token)
            if not 1 <= index <= len(skills):
                raise SkillflagError(f"Invalid selection: {token}")
            selected.append(skills[index - 1].id)
        elif token in known_ids:
            selected.append(token)
        else:
            raise SkillflagError(f"Invalid selection: {token}")

    if not selected:
        raise SkillflagError("Install cancelled.")
    return unique_values(selected)


def _run_install_action(
    action: _SkillAction,
    root_dirs: Sequence[str],
    opts: SkillflagOptions,
    stdin: IO[Any],
    stdout: IO[Any],
    stderr: IO[Any],
) -> int:
    from skillflag.install.cli import run_install_cli
    from skillflag.install.install import TarInput

    skill_ids = _resolve_install_skill_ids(action.ids, root_dirs, stdin, stderr)

    inputs = []
    for skill_id in skill_ids:
        skill_dir = resolve_skill_dir_from_roots(root_dirs, skill_id)
        inputs.append(TarInput(data=build_skill_tar(skill_dir, skill_id)))

    return run_install_cli(
        ["skillflag-py", "skill-install", *action.install_args],
        stdin=stdin,
        stdout=stdout,
        stderr=stderr,
        cwd=opts.cwd,
        provided_inputs=inputs,
        provided_skill_ids=skill_ids,
    )


def handle_skillflag(argv: Sequence[str], opts: SkillflagOptions) -> int:
    stdin = opts.stdin if opts.stdin is not None else sys.stdin
    stdout = opts.stdout if opts.stdout is not None else sys.stdout
    stderr = opts.stderr if opts.stderr is not None else sys.stderr

    try:
        action = _parse_skill_args(argv)
        bundled_root = resolve_skills_root(default_skills_root())
        if opts.include_bundled_skill is not False:
            # The bundled root goes LAST: lowest precedence.
            root_dirs = resolve_skills_roots(
                [*resolve_skills_roots(opts.skills_root), bundled_root]
            )
        else:
            root_dirs = resolve_skills_roots(opts.skills_root)

        if action.kind == "install":
            return _run_install_action(action, root_dirs, opts, stdin, stdout, stderr)

        if action.kind == "list":
            if action.json:
                payload = list_skills_json(root_dirs)
                write_text(stdout, json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
            else:
                skills = list_skills(root_dirs)
                if skills:
                    lines = [
                        f"{skill.id}\t{skill.summary}" if skill.summary else skill.id
                        for skill in skills
                    ]
                    write_text(stdout, "\n".join(lines) + "\n")
            return 0

        if action.kind == "export":
            assert action.id is not None
            skill_dir = resolve_skill_dir_from_roots(root_dirs, action.id)
            write_bytes(stdout, build_skill_tar(skill_dir, action.id))
            return 0

        if action.kind == "help":
            write_text(stdout, f"{SKILLFLAG_HELP_TEXT}\n")
            return 0

        assert action.id is not None
        skill_dir = resolve_skill_dir_from_roots(root_dirs, action.id)
        write_bytes(stdout, read_skill_md(skill_dir))
        return 0
    except Exception as err:
        write_text(stderr, f"{err}\n")
        return err.exit_code if isinstance(err, SkillflagError) else 1


def maybe_handle_skillflag(
    argv: Sequence[str],
    opts: SkillflagOptions,
    *,
    exit: Callable[[int], Any] | bool | None = None,
) -> bool:
    """Handle argv when it contains a `--skill` token; otherwise do nothing.

    By default the process exits with the action's exit code. Pass
    ``exit=False`` to only return, or a callable to receive the exit code.
    """
    if "--skill" not in argv:
        return False
    exit_code = handle_skillflag(argv, opts)
    if exit is not False:
        exit_fn = exit if callable(exit) else sys.exit
        exit_fn(exit_code)
    return True


def main(argv: Sequence[str] | None = None) -> int:
    """Standalone `skillflag-py` entry point."""
    raw_args = list(sys.argv[1:] if argv is None else argv)

    if raw_args and raw_args[0] == "install":
        from skillflag.install.cli import run_install_cli

        return run_install_cli(["skillflag-py", "skill-install", *raw_args[1:]])

    env_roots = os.environ.get(SKILLS_ROOT_ENV_VAR)
    if env_roots is not None:
        roots = [root for root in env_roots.split(os.pathsep) if root]
        opts = SkillflagOptions(skills_root=roots, include_bundled_skill=False)
    else:
        opts = SkillflagOptions(skills_root=default_skills_root())

    return handle_skillflag(["skillflag-py", "skillflag-py", *raw_args], opts)
