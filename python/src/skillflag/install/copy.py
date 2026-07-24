"""Skill directory copy with conflict handling (port of install/copy.ts)."""

from __future__ import annotations

import os
import shutil

from skillflag.install.errors import InstallError


def copy_skill_dir(source_dir: str, dest_dir: str, force: bool) -> None:
    if os.path.exists(dest_dir):
        if not force:
            raise InstallError(f"Destination already exists: {dest_dir}")
        if os.path.isdir(dest_dir) and not os.path.islink(dest_dir):
            shutil.rmtree(dest_dir)
        else:
            os.remove(dest_dir)

    parent = os.path.dirname(dest_dir)
    if parent:
        os.makedirs(parent, exist_ok=True)
    # copy2 preserves file modes, so execute bits survive the copy.
    shutil.copytree(source_dir, dest_dir)
