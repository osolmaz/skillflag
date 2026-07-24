from __future__ import annotations

import io
import re
import tarfile

import pytest

from skillflag.install.errors import InstallError
from skillflag.install.extract import extract_skill_tar_to_temp

SKILL_MD = b"---\nname: crafted\ndescription: d\n---\n"


def make_tar(entries) -> bytes:
    """entries: list of (name, content_bytes_or_None_for_dir) or TarInfo tuples."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, content in entries:
            info = tarfile.TarInfo(name=name)
            if content is None:
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
            else:
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
    return buf.getvalue()


def make_special_tar(entry_type: bytes, name: str) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        info = tarfile.TarInfo(name=name)
        info.type = entry_type
        if entry_type in (tarfile.SYMTYPE, tarfile.LNKTYPE):
            info.linkname = "/etc/passwd"
        archive.addfile(info)
    return buf.getvalue()


def test_extracts_valid_single_root_tar(tmp_path):
    data = make_tar(
        [
            ("crafted/", None),
            ("crafted/SKILL.md", SKILL_MD),
            ("crafted/sub/", None),
            ("crafted/sub/file.txt", b"hello"),
        ]
    )
    root = extract_skill_tar_to_temp(data, str(tmp_path))
    assert root == str(tmp_path / "crafted")
    assert (tmp_path / "crafted" / "SKILL.md").read_bytes() == SKILL_MD
    assert (tmp_path / "crafted" / "sub" / "file.txt").read_bytes() == b"hello"


def test_rejects_dotdot_traversal(tmp_path):
    data = make_tar([("crafted/", None), ("crafted/../evil.txt", b"x")])
    with pytest.raises(InstallError, match="Invalid path in tar"):
        extract_skill_tar_to_temp(data, str(tmp_path))
    assert not (tmp_path.parent / "evil.txt").exists()


def test_rejects_absolute_path(tmp_path):
    data = make_tar([("/abs/SKILL.md", b"x")])
    with pytest.raises(InstallError, match="Invalid path in tar"):
        extract_skill_tar_to_temp(data, str(tmp_path))


def test_rejects_backslash_in_name(tmp_path):
    data = make_tar([("crafted\\evil", b"x")])
    with pytest.raises(InstallError, match="Invalid path in tar"):
        extract_skill_tar_to_temp(data, str(tmp_path))


def test_rejects_empty_path_segment(tmp_path):
    data = make_tar([("crafted//evil", b"x")])
    with pytest.raises(InstallError, match="Invalid path in tar"):
        extract_skill_tar_to_temp(data, str(tmp_path))


def test_rejects_two_top_level_dirs(tmp_path):
    data = make_tar(
        [
            ("one/", None),
            ("one/SKILL.md", SKILL_MD),
            ("two/", None),
            ("two/SKILL.md", SKILL_MD),
        ]
    )
    with pytest.raises(
        InstallError, match=re.escape("Tar must contain a single top-level directory.")
    ):
        extract_skill_tar_to_temp(data, str(tmp_path))


def test_rejects_top_level_file(tmp_path):
    data = make_tar([("SKILL.md", SKILL_MD)])
    with pytest.raises(
        InstallError, match=re.escape("Tar must contain a single top-level directory.")
    ):
        extract_skill_tar_to_temp(data, str(tmp_path))


def test_rejects_empty_stream(tmp_path):
    with pytest.raises(InstallError, match=re.escape("Tar stream was empty.")):
        extract_skill_tar_to_temp(b"", str(tmp_path))


def test_rejects_zero_block_only_stream(tmp_path):
    with pytest.raises(InstallError, match=re.escape("Tar stream was empty.")):
        extract_skill_tar_to_temp(b"\0" * 1024, str(tmp_path))


def test_rejects_symlink_entries(tmp_path):
    data = make_special_tar(tarfile.SYMTYPE, "crafted/link")
    with pytest.raises(InstallError, match="Unsupported tar entry type: symlink"):
        extract_skill_tar_to_temp(data, str(tmp_path))


def test_rejects_fifo_entries(tmp_path):
    data = make_special_tar(tarfile.FIFOTYPE, "crafted/pipe")
    with pytest.raises(InstallError, match="Unsupported tar entry type: fifo"):
        extract_skill_tar_to_temp(data, str(tmp_path))
