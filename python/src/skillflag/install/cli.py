"""skill-install CLI (port of typescript/src/install/cli.ts).

The interactive flow is deliberately simpler than the TypeScript reference:
when --agent or --scope is missing and stdin is a TTY, a numbered prompt is
printed to stderr and one value is read from stdin. There is no multi-select
wizard and /dev/tty is never opened.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import IO, Any

from skillflag._io import (
    read_all_bytes,
    read_line,
    stream_isatty,
    write_text,
)
from skillflag._util import unique_values, utf8_sort_key
from skillflag.install.errors import InstallError
from skillflag.install.install import (
    DirInput,
    InstallInput,
    InstallResult,
    TarInput,
    install_skill,
)
from skillflag.install.resolve import (
    AGENTS,
    SCOPES,
    assert_agent,
    assert_scope,
    assert_supported_agent_scopes,
    resolve_skills_root,
    supported_scopes_for_agent,
)
from skillflag.install.validate import assert_skill_dir, read_skill_metadata

_AGENT_LIST = ", ".join(AGENTS)
_SCOPE_LIST = ", ".join(SCOPES)

USAGE_LINES = (
    "Usage:",
    "  skill-install [PATH ...] [--agent <agent>] [--scope <scope>] [--force]",
    "",
    "Input:",
    "  PATH ...            Skill directory path(s) containing SKILL.md.",
    "  stdin tar stream    If PATH is omitted, reads a tar bundle from stdin.",
    "",
    "Options:",
    "  --agent <value>     Target agent (single value).",
    f"                      Supported agents: {_AGENT_LIST}",
    "  --scope <value>     Target scope (single value).",
    f"                      Supported scopes: {_SCOPE_LIST}",
    "  --force             Overwrite destination if it already exists.",
    "  -h, --help          Show this help.",
    "",
    "Behavior:",
    "  If --agent or --scope is missing and stdin is an interactive TTY,",
    "  the installer prompts for the missing values on stderr.",
    "  CLI flags accept only one --agent and one --scope.",
)

USAGE_TEXT = "\n".join(USAGE_LINES)

_AGENT_HINTS = {
    "codex": "OpenAI Codex CLI skills (.codex/skills or CODEX_HOME/skills)",
    "claude": "Claude Code skills (.claude/skills)",
    "portable": "Portable agents skills (.agents/skills)",
    "vscode": "VS Code skills in .github/skills",
    "copilot": "GitHub Copilot skills in .github/skills",
    "amp": "Amp agent skills (.agents/skills)",
    "goose": "Goose agent skills (.agents/skills)",
    "opencode": "OpenCode skills (.opencode/skill)",
    "factory": "Factory skills (.factory/skills)",
    "cursor": "Cursor skills (.cursor/skills)",
}

_SCOPE_DESCRIPTIONS = {
    "repo": "Install to the current git repo root.",
    "user": "Install to your user-level skills directory.",
    "cwd": "Install relative to the current working directory.",
}


@dataclass
class _ParsedArgs:
    input_paths: list[str] = field(default_factory=list)
    agents: list[str] = field(default_factory=list)
    scopes: list[str] = field(default_factory=list)
    force: bool = False
    help: bool = False


@dataclass(frozen=True)
class _ProvidedInputs:
    inputs: list[InstallInput]
    skill_ids: list[str]


@dataclass(frozen=True)
class _PreparedSource:
    source: str
    skill_id_hint: str
    make_input: Callable[[], InstallInput]


@dataclass(frozen=True)
class _PlanItem:
    source: _PreparedSource
    agent: str
    scope: str
    destination: str


def _parse_flag_value(value: str | None, flag: str) -> str:
    if not value or value.startswith("-"):
        raise InstallError(f"Missing value for {flag}.")
    trimmed = value.strip()
    if not trimmed:
        raise InstallError(f"Missing value for {flag}.")
    if "," in trimmed:
        raise InstallError(
            f"Only one value is allowed for {flag}. Comma-separated values are not supported."
        )
    return trimmed


def _parse_args(args: Sequence[str]) -> _ParsedArgs:
    parsed = _ParsedArgs()
    agent_value: str | None = None
    scope_value: str | None = None

    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--agent":
            if agent_value is not None:
                raise InstallError("Only one --agent flag is allowed.")
            agent_value = _parse_flag_value(args[i + 1] if i + 1 < len(args) else None, "--agent")
            i += 2
            continue
        if arg == "--scope":
            if scope_value is not None:
                raise InstallError("Only one --scope flag is allowed.")
            scope_value = _parse_flag_value(args[i + 1] if i + 1 < len(args) else None, "--scope")
            i += 2
            continue
        if arg == "--force":
            parsed.force = True
            i += 1
            continue
        if arg in ("--help", "-h"):
            parsed.help = True
            i += 1
            continue
        if arg.startswith("-"):
            raise InstallError(f"Unknown option: {arg}")
        parsed.input_paths.append(arg)
        i += 1

    if agent_value is not None:
        parsed.agents.append(agent_value)
    if scope_value is not None:
        parsed.scopes.append(scope_value)
    return parsed


def _stdin_has_data(stream: IO[Any]) -> bool:
    return not stream_isatty(stream)


def _stdin_is_pipe(stream: IO[Any]) -> bool:
    return not stream_isatty(stream)


def _drain_stream(stream: IO[Any]) -> None:
    # Drain source stdin so upstream writers do not hit EPIPE when we exit early.
    try:
        read_all_bytes(stream)
    except Exception:
        pass


def _normalize_provided_inputs(
    provided_inputs: Sequence[InstallInput] | None,
    provided_skill_ids: Sequence[str] | None,
) -> _ProvidedInputs:
    inputs = list(provided_inputs or [])
    skill_ids = list(provided_skill_ids or [])
    if skill_ids and not inputs:
        raise InstallError("Preset skill ids require preset install inputs.")
    if skill_ids and len(skill_ids) != len(inputs):
        raise InstallError("Preset skill id count must match preset install input count.")
    return _ProvidedInputs(inputs=inputs, skill_ids=skill_ids)


def _prepare_dir_source(input_path: str) -> _PreparedSource:
    source_dir = os.path.abspath(input_path)
    if not os.path.exists(source_dir):
        raise InstallError(f"PATH does not exist: {source_dir}")
    if not os.path.isdir(source_dir):
        raise InstallError("PATH must be a directory containing SKILL.md.")

    assert_skill_dir(source_dir)
    meta = read_skill_metadata(source_dir)
    return _PreparedSource(
        source=source_dir,
        skill_id_hint=meta.name,
        make_input=lambda: DirInput(dir=source_dir),
    )


def _prepare_source(install_input: InstallInput, skill_id: str | None) -> _PreparedSource:
    if isinstance(install_input, DirInput):
        return _prepare_dir_source(install_input.dir)
    data = install_input.data
    return _PreparedSource(
        source="tar stream",
        skill_id_hint=skill_id if skill_id else "<from skill bundle>",
        make_input=lambda: TarInput(data=data),
    )


def _resolve_install_sources(
    input_paths: Sequence[str],
    stdin: IO[Any],
    provided: _ProvidedInputs,
) -> list[_PreparedSource]:
    if input_paths and provided.inputs:
        raise InstallError("PATH cannot be used when install input is preset.")

    if input_paths:
        return [_prepare_dir_source(input_path) for input_path in input_paths]

    if provided.inputs:
        return [
            _prepare_source(
                install_input,
                provided.skill_ids[index] if index < len(provided.skill_ids) else None,
            )
            for index, install_input in enumerate(provided.inputs)
        ]

    if _stdin_has_data(stdin):
        return [_prepare_source(TarInput(data=read_all_bytes(stdin)), None)]

    raise InstallError(f"Missing PATH or tar stream on stdin.\n{USAGE_TEXT}")


def _build_install_plan(
    sources: Sequence[_PreparedSource],
    agents: Sequence[str],
    scopes: Sequence[str],
    cwd: str,
) -> list[_PlanItem]:
    plan: list[_PlanItem] = []
    for source in sources:
        for agent in agents:
            for scope in scopes:
                skills_root = resolve_skills_root(agent, scope, cwd)
                plan.append(
                    _PlanItem(
                        source=source,
                        agent=agent,
                        scope=scope,
                        destination=os.path.join(skills_root, source.skill_id_hint),
                    )
                )
    return plan


def _assert_no_install_collisions(plan: Sequence[_PlanItem]) -> None:
    plans_by_destination: dict[str, list[_PlanItem]] = {}
    for item in plan:
        plans_by_destination.setdefault(item.destination, []).append(item)

    collisions = sorted(
        (
            (destination, items)
            for destination, items in plans_by_destination.items()
            if len(items) > 1
        ),
        key=lambda pair: utf8_sort_key(pair[0]),
    )
    if not collisions:
        return

    lines = ["Install destination collisions detected:"]
    for destination, items in collisions:
        lines.append(f"- {destination}")
        for item in items:
            lines.append(
                f"  - {item.source.skill_id_hint} @ {item.agent}/{item.scope}"
                f" (source: {item.source.source})"
            )
    lines.append(
        "Resolve collisions by changing skill IDs, sources, --agent, or --scope"
        " so each combination has a unique destination."
    )
    raise InstallError("\n".join(lines))


def _prompt_choice(
    stdin: IO[Any],
    stderr: IO[Any],
    title: str,
    options: Sequence[str],
    hints: dict[str, str],
) -> str:
    write_text(stderr, f"{title}\n")
    for index, option in enumerate(options, start=1):
        hint = hints.get(option)
        suffix = f"  {hint}" if hint else ""
        write_text(stderr, f"  {index}) {option}{suffix}\n")
    write_text(stderr, "Enter a number or name: ")

    line = read_line(stdin)
    if line is None or not line.strip():
        raise InstallError("Install cancelled.")
    value = line.strip()
    if value.isdigit():
        index = int(value)
        if 1 <= index <= len(options):
            return options[index - 1]
        raise InstallError(f"Invalid selection: {value}")
    if value in options:
        return value
    raise InstallError(f"Invalid selection: {value}")


def _prompt_missing_flags(
    parsed: _ParsedArgs,
    stdin: IO[Any],
    stderr: IO[Any],
) -> tuple[str, str]:
    if parsed.agents:
        agent = assert_agent(parsed.agents[0])
    else:
        agent = _prompt_choice(stdin, stderr, "Select an agent:", list(AGENTS), _AGENT_HINTS)

    supported = supported_scopes_for_agent(agent)
    if parsed.scopes:
        scope = assert_scope(parsed.scopes[0])
    elif len(supported) == 1:
        scope = supported[0]
    else:
        scope = _prompt_choice(stdin, stderr, "Select a scope:", supported, _SCOPE_DESCRIPTIONS)
    return agent, scope


def run_install_cli(
    argv: Sequence[str],
    *,
    stdin: IO[Any] | None = None,
    stdout: IO[Any] | None = None,
    stderr: IO[Any] | None = None,
    cwd: str | None = None,
    provided_inputs: Sequence[InstallInput] | None = None,
    provided_skill_ids: Sequence[str] | None = None,
) -> int:
    stdin = stdin if stdin is not None else sys.stdin
    stdout = stdout if stdout is not None else sys.stdout
    stderr = stderr if stderr is not None else sys.stderr
    cwd = cwd if cwd is not None else os.getcwd()

    try:
        parsed = _parse_args(list(argv)[2:])
        if parsed.help:
            write_text(stdout, f"{USAGE_TEXT}\n")
            if _stdin_is_pipe(stdin):
                _drain_stream(stdin)
            return 0

        provided = _normalize_provided_inputs(provided_inputs, provided_skill_ids)
        if provided.inputs and parsed.input_paths:
            raise InstallError("PATH cannot be used when install input is preset.")

        if not parsed.agents or not parsed.scopes:
            if stream_isatty(stdin):
                agent, scope = _prompt_missing_flags(parsed, stdin, stderr)
                parsed.agents = [agent]
                parsed.scopes = [scope]
            else:
                raise InstallError(f"Missing required flags.\n{USAGE_TEXT}")

        agents = unique_values([assert_agent(agent) for agent in parsed.agents])
        scopes = unique_values([assert_scope(scope) for scope in parsed.scopes])
        assert_supported_agent_scopes(agents, scopes)

        sources = _resolve_install_sources(parsed.input_paths, stdin, provided)
        plan = _build_install_plan(sources, agents, scopes, cwd)
        _assert_no_install_collisions(plan)

        results: list[tuple[InstallResult, str, str]] = []
        for item in plan:
            result = install_skill(
                item.source.make_input(),
                agent=item.agent,
                scope=item.scope,
                cwd=cwd,
                force=parsed.force,
            )
            results.append((result, item.agent, item.scope))

        for result, agent, scope in results:
            write_text(
                stderr,
                f"Installed {result.skill_id} to {result.installed_to} ({agent}/{scope})\n",
            )
        return 0
    except Exception as err:
        if _stdin_is_pipe(stdin):
            _drain_stream(stdin)
        write_text(stderr, f"{err}\n")
        return err.exit_code if isinstance(err, InstallError) else 1


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    return run_install_cli(["skill-install-py", "skill-install", *args])
