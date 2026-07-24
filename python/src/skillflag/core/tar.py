"""Deterministic tar writer (hand-rolled per docs/DETERMINISTIC_TAR.md).

The stdlib ``tarfile`` module is deliberately NOT used for writing: the export
stream must be byte-identical to the reference implementation, including its
header quirks (see the docs for the exact byte layout).
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from skillflag._util import utf8_sort_key
from skillflag.core.errors import SkillflagError

_BLOCK_SIZE = 512


@dataclass(frozen=True)
class TarEntry:
    name: str
    type: str  # "file" | "directory"
    mode: int
    abs_path: str | None = None
    size: int = 0


def _is_invalid_rel_path(rel_posix: str) -> bool:
    if rel_posix.startswith("/"):
        return True
    return ".." in rel_posix.split("/")


def _collect_entries_for_dir(
    root_dir: str,
    rel_posix: str,
    skill_id: str,
    dirs: list[str],
    files: list[TarEntry],
) -> None:
    dirs.append(rel_posix)
    abs_dir = os.path.join(root_dir, *rel_posix.split("/")) if rel_posix else root_dir

    for entry in os.scandir(abs_dir):
        name = entry.name
        rel_child = f"{rel_posix}/{name}" if rel_posix else name

        if _is_invalid_rel_path(rel_child):
            raise SkillflagError(f"Invalid path in skill: {skill_id}/{rel_child}")

        if entry.is_symlink():
            raise SkillflagError(
                f"Symlinks are not supported in skill bundles: {skill_id}/{rel_child}"
            )

        if entry.is_dir(follow_symlinks=False):
            _collect_entries_for_dir(root_dir, rel_child, skill_id, dirs, files)
            continue

        if entry.is_file(follow_symlinks=False):
            stat = os.stat(entry.path)
            files.append(
                TarEntry(
                    name=f"{skill_id}/{rel_child}",
                    type="file",
                    abs_path=entry.path,
                    size=stat.st_size,
                    mode=stat.st_mode & 0o777,
                )
            )
            continue

        raise SkillflagError(f"Unsupported file type in skill bundle: {skill_id}/{rel_child}")


def collect_skill_entries(skill_dir: str, skill_id: str) -> tuple[list[TarEntry], int]:
    """Collect sorted tar entries for a skill directory. Returns (entries, file count)."""
    dirs: list[str] = []
    files: list[TarEntry] = []
    _collect_entries_for_dir(skill_dir, "", skill_id, dirs, files)

    dir_entries: list[TarEntry] = []
    for rel_dir in dirs:
        abs_dir = os.path.join(skill_dir, *rel_dir.split("/")) if rel_dir else skill_dir
        stat = os.stat(abs_dir)
        dir_name = f"{skill_id}/{rel_dir}/" if rel_dir else f"{skill_id}/"
        dir_entries.append(TarEntry(name=dir_name, type="directory", mode=stat.st_mode & 0o777))

    entries = sorted(dir_entries + files, key=lambda entry: utf8_sort_key(entry.name))
    return entries, len(files)


def _octal_field(value: int, digits: int) -> bytes:
    """ASCII octal digits, zero-padded, followed by a space (tar-stream style)."""
    return f"{value:0{digits}o}".encode("ascii") + b" "


def _build_header(entry: TarEntry, size: int) -> bytes:
    name_bytes = entry.name.encode("utf-8")
    if len(name_bytes) > 100:
        raise SkillflagError(f"Tar entry name is too long: {entry.name}")

    buf = bytearray(_BLOCK_SIZE)
    buf[0 : len(name_bytes)] = name_bytes
    buf[100:107] = _octal_field(entry.mode, 6)  # trailing byte 107 stays NUL
    buf[108:115] = _octal_field(0, 6)  # uid
    buf[116:123] = _octal_field(0, 6)  # gid
    buf[124:136] = _octal_field(size, 11)  # size: 11 digits + space, no NUL
    buf[136:148] = _octal_field(0, 11)  # mtime: fixed epoch 0
    # chksum (148..155) is computed with the field treated as 8 spaces.
    buf[156] = ord("0") if entry.type == "file" else ord("5")
    buf[257:263] = b"ustar\0"
    buf[263:265] = b"00"
    buf[329:336] = _octal_field(0, 6)  # devmajor
    buf[337:344] = _octal_field(0, 6)  # devminor

    checksum = sum(buf) + 8 * 0x20
    buf[148:155] = _octal_field(checksum, 6)  # byte 155 stays NUL
    return bytes(buf)


def write_tar_bytes(entries: list[TarEntry]) -> bytes:
    out = bytearray()
    for entry in entries:
        if entry.type == "directory":
            out += _build_header(entry, 0)
            continue

        if entry.abs_path is None:
            raise SkillflagError(f"Missing file path for {entry.name}")
        with open(entry.abs_path, "rb") as handle:
            data = handle.read()
        out += _build_header(entry, len(data))
        out += data
        padding = (_BLOCK_SIZE - len(data) % _BLOCK_SIZE) % _BLOCK_SIZE
        out += b"\0" * padding

    out += b"\0" * (2 * _BLOCK_SIZE)
    return bytes(out)


def build_skill_tar(skill_dir: str, skill_id: str) -> bytes:
    entries, _ = collect_skill_entries(skill_dir, skill_id)
    return write_tar_bytes(entries)
