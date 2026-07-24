from __future__ import annotations

import io
import tarfile

from conftest import FIXTURES_SKILLS, run_producer
from skillflag.core.digest import digest_sha256
from skillflag.core.tar import build_skill_tar


def _export_alpha() -> bytes:
    code, stdout, stderr = run_producer(["--skill", "export", "alpha"])
    assert code == 0
    assert stderr == ""
    return stdout


def test_export_entry_set_and_order():
    data = _export_alpha()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        members = archive.getmembers()
    names = [(m.name, m.isdir()) for m in members]
    assert names == [
        ("alpha", True),
        ("alpha/SKILL.md", False),
        ("alpha/templates", True),
        ("alpha/templates/hello.txt", False),
    ]


def test_export_file_contents_round_trip():
    data = _export_alpha()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        skill_md = archive.extractfile("alpha/SKILL.md").read()
        hello = archive.extractfile("alpha/templates/hello.txt").read()
    assert skill_md == (FIXTURES_SKILLS / "alpha" / "SKILL.md").read_bytes()
    assert hello == (FIXTURES_SKILLS / "alpha" / "templates" / "hello.txt").read_bytes()


def test_export_normalized_metadata():
    data = _export_alpha()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        for member in archive.getmembers():
            assert member.mtime == 0
            assert member.uid == 0
            assert member.gid == 0
            assert member.uname == ""
            assert member.gname == ""


def test_export_stream_layout():
    data = _export_alpha()
    # alpha: 4 headers + 1 data block per file (both files < 512 bytes) + 2 trailer blocks.
    assert len(data) == 8 * 512
    assert data[-1024:] == b"\0" * 1024


def test_header_byte_quirks():
    data = _export_alpha()
    header = data[:512]  # alpha/ directory header
    assert header[0:6] == b"alpha/"
    # mode: 6 octal digits + space + NUL
    assert header[106:108] == b" \0"
    # uid/gid: 000000 + space + NUL
    assert header[108:116] == b"000000 \0"
    assert header[116:124] == b"000000 \0"
    # size: 11 octal digits + space, NO trailing NUL
    assert header[124:136] == b"00000000000 "
    # mtime: fixed epoch 0, 11 octal digits + space
    assert header[136:148] == b"00000000000 "
    # chksum: 6 octal digits + space + NUL
    assert header[154:156] == b" \0"
    assert header[156] == ord("5")  # directory typeflag
    assert header[257:265] == b"ustar\x0000"
    # devmajor/devminor written as zeros even for plain entries
    assert header[329:337] == b"000000 \0"
    assert header[337:345] == b"000000 \0"
    assert header[345:500] == b"\0" * 155  # prefix

    file_header = data[512:1024]
    assert file_header[156] == ord("0")  # file typeflag
    size = int(file_header[124:135].decode("ascii"), 8)
    assert size == (FIXTURES_SKILLS / "alpha" / "SKILL.md").stat().st_size


def test_export_is_deterministic():
    first = _export_alpha()
    second = _export_alpha()
    assert first == second
    assert build_skill_tar(str(FIXTURES_SKILLS / "alpha"), "alpha") == first


def test_digest_helper():
    data = _export_alpha()
    digest = digest_sha256(data)
    assert digest.startswith("sha256:")
    assert len(digest) == len("sha256:") + 64


def test_export_preserves_execute_bits(tmp_path):
    root = tmp_path / "skills"
    skill = root / "tool"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: tool\ndescription: d\n---\n", encoding="utf-8")
    script = skill / "run.sh"
    script.write_text("#!/bin/sh\n", encoding="utf-8")
    script.chmod(0o755)

    code, stdout, _ = run_producer(["--skill", "export", "tool"], skills_root=root)
    assert code == 0
    with tarfile.open(fileobj=io.BytesIO(stdout), mode="r:") as archive:
        member = archive.getmember("tool/run.sh")
    assert member.mode == 0o755


def test_export_rejects_symlinks(tmp_path):
    root = tmp_path / "skills"
    skill = root / "linked"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: linked\ndescription: d\n---\n", encoding="utf-8")
    (skill / "evil").symlink_to("/etc/passwd")

    code, stdout, stderr = run_producer(["--skill", "export", "linked"], skills_root=root)
    assert code == 1
    assert stdout == b""
    assert stderr == "Symlinks are not supported in skill bundles: linked/evil\n"
