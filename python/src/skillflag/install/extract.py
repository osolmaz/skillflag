"""Safe tar extraction for the installer (port of install/extract.ts).

The stdlib ``tarfile`` module is used for READING only; every entry is
validated and written manually. Nothing from the bundle is ever executed.
"""

from __future__ import annotations

import io
import os
import tarfile

from skillflag.install.errors import InstallError

_TYPE_NAMES = {
    tarfile.REGTYPE: "file",
    tarfile.AREGTYPE: "file",
    tarfile.LNKTYPE: "link",
    tarfile.SYMTYPE: "symlink",
    tarfile.CHRTYPE: "character-device",
    tarfile.BLKTYPE: "block-device",
    tarfile.DIRTYPE: "directory",
    tarfile.FIFOTYPE: "fifo",
    tarfile.CONTTYPE: "contiguous-file",
}


def _type_name(member: tarfile.TarInfo) -> str:
    return _TYPE_NAMES.get(member.type, member.type.decode("ascii", errors="replace"))


def _is_invalid_rel_path(rel_posix: str) -> bool:
    if rel_posix.startswith("/"):
        return True
    parts = rel_posix.split("/")
    return ".." in parts or any(part == "" for part in parts)


def extract_skill_tar_to_temp(data: bytes, temp_dir: str) -> str:
    """Extract a validated single-root tar into ``temp_dir``; return the root dir."""
    if not data.strip(b"\0"):
        raise InstallError("Tar stream was empty.")

    root_name: str | None = None
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
            for member in archive:
                root_name = _extract_member(archive, member, temp_dir, root_name)
    except tarfile.TarError as err:
        raise InstallError(f"Invalid tar stream: {err}") from err

    if root_name is None:
        raise InstallError("Tar stream was empty.")
    return os.path.join(temp_dir, root_name)


def _extract_member(
    archive: tarfile.TarFile,
    member: tarfile.TarInfo,
    temp_dir: str,
    root_name: str | None,
) -> str:
    raw_name = member.name
    if not raw_name or "\\" in raw_name:
        raise InstallError(f"Invalid path in tar: {raw_name}")
    name = raw_name[:-1] if raw_name.endswith("/") else raw_name
    if not name or _is_invalid_rel_path(name):
        raise InstallError(f"Invalid path in tar: {raw_name}")

    top, _, rel_path = name.partition("/")
    if root_name is None:
        root_name = top
    if root_name != top:
        raise InstallError("Tar must contain a single top-level directory.")

    if rel_path:
        abs_path = os.path.join(temp_dir, top, *rel_path.split("/"))
    else:
        abs_path = os.path.join(temp_dir, top)

    if member.isdir():
        os.makedirs(abs_path, exist_ok=True)
        return root_name

    if member.isreg():
        if not rel_path:
            raise InstallError("Tar must contain a single top-level directory.")
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        source = archive.extractfile(member)
        content = source.read() if source is not None else b""
        with open(abs_path, "wb") as out:
            out.write(content)
        return root_name

    raise InstallError(f"Unsupported tar entry type: {_type_name(member)}")
