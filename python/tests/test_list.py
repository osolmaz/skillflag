from __future__ import annotations

import hashlib
import json

from conftest import FIXTURES_SKILLS, make_skill_dir, run_producer


def test_list_text_format():
    code, stdout, stderr = run_producer(["--skill", "list"])
    assert code == 0
    assert stderr == ""
    assert stdout == b"alpha\tAlpha test skill\nbeta\tBeta test skill\n"


def test_list_ignores_dirs_without_skill_md():
    code, stdout, _ = run_producer(["--skill", "list"])
    assert code == 0
    assert b"ignored" not in stdout


def test_list_zero_skills_prints_nothing(tmp_path):
    empty = tmp_path / "skills"
    empty.mkdir()
    code, stdout, stderr = run_producer(["--skill", "list"], skills_root=empty)
    assert code == 0
    assert stdout == b""
    assert stderr == ""


def test_list_skill_without_summary_prints_id_only(tmp_path):
    root = tmp_path / "skills"
    root.mkdir()
    skill = root / "bare"
    skill.mkdir()
    (skill / "SKILL.md").write_text("---\nname: bare\n---\nBody\n", encoding="utf-8")
    code, stdout, _ = run_producer(["--skill", "list"], skills_root=root)
    assert code == 0
    assert stdout == b"bare\n"


def test_list_summary_replaces_tabs_and_newlines(tmp_path):
    root = tmp_path / "skills"
    root.mkdir()
    skill = root / "multi"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        '---\nname: multi\ndescription: "a\tb"\n---\n', encoding="utf-8"
    )
    code, stdout, _ = run_producer(["--skill", "list"], skills_root=root)
    assert code == 0
    assert stdout == b"multi\ta b\n"


def test_list_json_format_and_key_order():
    code, stdout, _ = run_producer(["--skill", "list", "--json"])
    assert code == 0
    # Compact JSON, no trailing newline.
    assert not stdout.endswith(b"\n")
    assert b": " not in stdout and b", " not in stdout

    payload = json.loads(stdout)
    assert list(payload.keys()) == ["skillflag_version", "skills"]
    assert payload["skillflag_version"] == "0.1"
    ids = [skill["id"] for skill in payload["skills"]]
    assert ids == ["alpha", "beta"]
    alpha = payload["skills"][0]
    assert list(alpha.keys()) == ["id", "digest", "files", "summary"]
    assert alpha["files"] == 2
    assert alpha["summary"] == "Alpha test skill"


def test_list_json_digest_matches_export_bytes():
    code, list_out, _ = run_producer(["--skill", "list", "--json"])
    assert code == 0
    payload = json.loads(list_out)
    for skill in payload["skills"]:
        export_code, export_out, _ = run_producer(["--skill", "export", skill["id"]])
        assert export_code == 0
        assert skill["digest"] == "sha256:" + hashlib.sha256(export_out).hexdigest()


def test_list_json_includes_version_when_present(tmp_path):
    root = tmp_path / "skills"
    root.mkdir()
    skill = root / "versioned"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        "---\nname: versioned\ndescription: d\nversion: 1.2.3\n---\n", encoding="utf-8"
    )
    code, stdout, _ = run_producer(["--skill", "list", "--json"], skills_root=root)
    assert code == 0
    item = json.loads(stdout)["skills"][0]
    assert list(item.keys()) == ["id", "digest", "files", "summary", "version"]
    assert item["version"] == "1.2.3"


def test_first_root_wins_for_duplicate_ids(tmp_path):
    override_root = tmp_path / "override"
    make_skill_dir(override_root, "alpha", description="Overridden alpha")
    code, stdout, _ = run_producer(
        ["--skill", "list"], skills_root=[override_root, FIXTURES_SKILLS]
    )
    assert code == 0
    assert stdout == b"alpha\tOverridden alpha\nbeta\tBeta test skill\n"


def test_skills_sorted_bytewise_by_id(tmp_path):
    root = tmp_path / "skills"
    for dir_name in ("b-skill", "a-skill", "Z-skill"):
        make_skill_dir(root, dir_name)
    code, stdout, _ = run_producer(["--skill", "list"], skills_root=root)
    assert code == 0
    ids = [line.split(b"\t")[0] for line in stdout.splitlines()]
    assert ids == [b"Z-skill", b"a-skill", b"b-skill"]
