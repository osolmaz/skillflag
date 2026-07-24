"""Small shared helpers (port of typescript/src/utils/collections.ts)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import TypeVar

T = TypeVar("T")


def unique_values(values: Iterable[T]) -> list[T]:
    """Deduplicate while preserving the first occurrence order."""
    out: list[T] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def utf8_sort_key(value: str) -> bytes:
    """Byte-wise lexicographic sort key.

    Locale-aware collation would make sort order -- and therefore tar bytes and
    digests -- depend on the host locale.
    """
    return value.encode("utf-8")
