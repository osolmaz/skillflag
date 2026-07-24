//! Injectable stream abstractions for the CLIs.
//!
//! Only stdin needs TTY awareness (interactive prompts and pipe detection),
//! so output streams are plain `std::io::Write` trait objects.

use std::io::{IsTerminal, Read};

/// A readable input stream that knows whether it is an interactive terminal.
pub trait InputStream: Read {
    fn is_tty(&self) -> bool {
        false
    }
}

/// The process stdin, with real TTY detection.
pub struct StdinStream(std::io::Stdin);

impl StdinStream {
    pub fn new() -> Self {
        Self(std::io::stdin())
    }
}

impl Default for StdinStream {
    fn default() -> Self {
        Self::new()
    }
}

impl Read for StdinStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buf)
    }
}

impl InputStream for StdinStream {
    fn is_tty(&self) -> bool {
        self.0.is_terminal()
    }
}

/// Wraps any reader with an explicit TTY flag. Useful for tests and for
/// embedders that manage their own stdio.
pub struct ReaderInput<R: Read> {
    reader: R,
    tty: bool,
}

impl<R: Read> ReaderInput<R> {
    pub fn new(reader: R, tty: bool) -> Self {
        Self { reader, tty }
    }
}

impl<R: Read> Read for ReaderInput<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.reader.read(buf)
    }
}

impl<R: Read> InputStream for ReaderInput<R> {
    fn is_tty(&self) -> bool {
        self.tty
    }
}

/// Read a single line (without the trailing newline) from an unbuffered
/// stream. Returns `None` on EOF before any byte was read.
pub(crate) fn read_line(stdin: &mut dyn InputStream) -> std::io::Result<Option<String>> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match stdin.read(&mut byte)? {
            0 => {
                if buf.is_empty() {
                    return Ok(None);
                }
                break;
            }
            _ => {
                if byte[0] == b'\n' {
                    break;
                }
                buf.push(byte[0]);
            }
        }
    }
    let mut line = String::from_utf8_lossy(&buf).into_owned();
    if line.ends_with('\r') {
        line.pop();
    }
    Ok(Some(line))
}

/// Drain any remaining bytes from a piped stdin so upstream writers do not
/// hit EPIPE when we exit early. Errors are ignored.
pub(crate) fn drain(stdin: &mut dyn InputStream) {
    let mut sink = [0u8; 8192];
    loop {
        match stdin.read(&mut sink) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }
}
