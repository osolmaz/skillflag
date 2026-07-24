"""Binary-safe stream helpers for injectable stdin/stdout/stderr."""

from __future__ import annotations

from typing import IO, Any


def write_bytes(stream: IO[Any], data: bytes) -> None:
    """Write raw bytes, using the .buffer of text streams when present."""
    buffer = getattr(stream, "buffer", None)
    if buffer is not None:
        buffer.write(data)
        return
    try:
        stream.write(data)
    except TypeError:
        stream.write(data.decode("utf-8", errors="surrogateescape"))


def write_text(stream: IO[Any], text: str) -> None:
    """Write text to either a text or a binary stream."""
    try:
        stream.write(text)
    except TypeError:
        stream.write(text.encode("utf-8"))


def read_all_bytes(stream: IO[Any]) -> bytes:
    """Read the remainder of the stream as bytes."""
    buffer = getattr(stream, "buffer", None)
    source = buffer if buffer is not None else stream
    data = source.read()
    if data is None:
        return b""
    if isinstance(data, str):
        return data.encode("utf-8")
    return bytes(data)


def read_line(stream: IO[Any]) -> str | None:
    """Read one line; None on EOF."""
    line = stream.readline()
    if isinstance(line, bytes):
        line = line.decode("utf-8")
    if line == "":
        return None
    return line.rstrip("\r\n")


def stream_isatty(stream: IO[Any]) -> bool:
    isatty = getattr(stream, "isatty", None)
    if callable(isatty):
        try:
            return bool(isatty())
        except (OSError, ValueError):
            return False
    return False
