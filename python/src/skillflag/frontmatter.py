"""Minimal SKILL.md frontmatter parser (port of typescript/src/shared/frontmatter.ts).

This is deliberately NOT full YAML: the block must start with ``---`` on the
first line and end at the next ``---`` line; each line is split at the first
``:``; one pair of matching surrounding quotes is stripped from the value.
"""

from __future__ import annotations

import re

_FRONTMATTER_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---(?:\r?\n|$)", re.DOTALL)
_LINE_SPLIT_RE = re.compile(r"\r?\n")


def _strip_yaml_quotes(value: str) -> str:
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1].strip()
    return value


def parse_frontmatter(content: str) -> dict[str, str]:
    match = _FRONTMATTER_RE.match(content)
    if match is None:
        return {}

    fields: dict[str, str] = {}
    for line in _LINE_SPLIT_RE.split(match.group(1)):
        if not line.strip():
            continue
        idx = line.find(":")
        if idx == -1:
            continue
        key = line[:idx].strip()
        value = _strip_yaml_quotes(line[idx + 1 :].strip())
        if key and value:
            fields[key] = value
    return fields
