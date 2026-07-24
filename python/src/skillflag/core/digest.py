"""Digest helper for exported skill bundles."""

from __future__ import annotations

import hashlib


def digest_sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()
