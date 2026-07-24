"""Single-skill install pipeline (port of typescript/src/install/install.ts)."""

from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass

from skillflag.install.copy import copy_skill_dir
from skillflag.install.extract import extract_skill_tar_to_temp
from skillflag.install.resolve import resolve_skills_root
from skillflag.install.validate import assert_skill_dir, read_skill_metadata


@dataclass(frozen=True)
class DirInput:
    dir: str


@dataclass(frozen=True)
class TarInput:
    data: bytes


InstallInput = DirInput | TarInput


@dataclass(frozen=True)
class InstallResult:
    skill_id: str
    installed_to: str


def install_skill(
    install_input: InstallInput,
    *,
    agent: str,
    scope: str,
    cwd: str,
    force: bool,
) -> InstallResult:
    temp_dir: str | None = None
    if isinstance(install_input, DirInput):
        root_dir = os.path.abspath(install_input.dir)
    else:
        temp_dir = tempfile.mkdtemp(prefix="skill-install-")
        try:
            root_dir = extract_skill_tar_to_temp(install_input.data, temp_dir)
        except BaseException:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise

    try:
        assert_skill_dir(root_dir)
        meta = read_skill_metadata(root_dir)
        skill_id = meta.name

        skills_root = resolve_skills_root(agent, scope, cwd)
        dest_dir = os.path.join(skills_root, skill_id)

        copy_skill_dir(root_dir, dest_dir, force)
        return InstallResult(skill_id=skill_id, installed_to=dest_dir)
    finally:
        if temp_dir is not None:
            shutil.rmtree(temp_dir, ignore_errors=True)
