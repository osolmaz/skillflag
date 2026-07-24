"""Producer-side error type."""

from __future__ import annotations


class SkillflagError(Exception):
    """Error raised by the Skillflag producer. Carries the process exit code."""

    def __init__(self, message: str, exit_code: int = 1) -> None:
        super().__init__(message)
        self.exit_code = exit_code
