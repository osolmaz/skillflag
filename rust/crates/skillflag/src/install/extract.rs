//! Safe tar extraction for the installer's stdin input.
//!
//! Hand-rolled ustar reader (plus minimal PAX/GNU long-name support) with the
//! same security posture and error messages as the TypeScript reference:
//! absolute paths, `..` segments, empty segments, and backslashes are
//! rejected; only regular files and directories are allowed; the archive must
//! contain a single top-level directory. Extracted files are written with
//! default permissions and nothing from the bundle is ever executed.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::core::errors::{Result, SkillflagError};

const BLOCK: usize = 512;

fn invalid_header() -> SkillflagError {
    SkillflagError::new(
        "Invalid tar header. Maybe the tar is corrupted or it needs to be gunzipped?",
    )
}

fn parse_octal(field: &[u8]) -> Result<u64> {
    let trimmed: Vec<u8> = field
        .iter()
        .copied()
        .filter(|&b| b != 0 && b != b' ')
        .collect();
    if trimmed.is_empty() {
        return Ok(0);
    }
    let text = std::str::from_utf8(&trimmed).map_err(|_| invalid_header())?;
    u64::from_str_radix(text, 8).map_err(|_| invalid_header())
}

fn nul_terminated_str(field: &[u8]) -> String {
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).into_owned()
}

/// tar-stream compatible type names for error messages.
fn type_name(typeflag: u8) -> String {
    match typeflag {
        b'1' => "link".to_string(),
        b'2' => "symlink".to_string(),
        b'3' => "character-device".to_string(),
        b'4' => "block-device".to_string(),
        b'6' => "fifo".to_string(),
        b'7' => "contiguous-file".to_string(),
        other => (other as char).to_string(),
    }
}

fn verify_checksum(header: &[u8]) -> Result<()> {
    let expected = parse_octal(&header[148..156])?;
    let mut unsigned: u64 = 0;
    let mut signed: i64 = 0;
    for (index, &byte) in header.iter().enumerate() {
        let value = if (148..156).contains(&index) {
            b' '
        } else {
            byte
        };
        unsigned += u64::from(value);
        signed += i64::from(value as i8);
    }
    if unsigned == expected || signed == expected as i64 {
        Ok(())
    } else {
        Err(invalid_header())
    }
}

fn parse_pax_records(data: &[u8]) -> Result<HashMap<String, String>> {
    let mut records = HashMap::new();
    let mut rest = data;
    while !rest.is_empty() {
        let space = rest
            .iter()
            .position(|&b| b == b' ')
            .ok_or_else(invalid_header)?;
        let len: usize = std::str::from_utf8(&rest[..space])
            .ok()
            .and_then(|s| s.parse().ok())
            .ok_or_else(invalid_header)?;
        if len == 0 || len > rest.len() {
            return Err(invalid_header());
        }
        let record = &rest[space + 1..len];
        let record = record.strip_suffix(b"\n").unwrap_or(record);
        let text = String::from_utf8_lossy(record);
        if let Some((key, value)) = text.split_once('=') {
            records.insert(key.to_string(), value.to_string());
        }
        rest = &rest[len..];
    }
    Ok(records)
}

fn is_invalid_rel_path(rel: &str) -> bool {
    rel.starts_with('/') || rel.split('/').any(|part| part == ".." || part.is_empty())
}

struct TarReader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

struct RawEntry {
    name: String,
    typeflag: u8,
    data: Vec<u8>,
}

impl<'a> TarReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn next_block(&mut self) -> Option<&'a [u8]> {
        if self.pos + BLOCK > self.bytes.len() {
            return None;
        }
        let block = &self.bytes[self.pos..self.pos + BLOCK];
        self.pos += BLOCK;
        Some(block)
    }

    /// Next raw entry, or `None` at the end of the archive.
    fn next_entry(&mut self) -> Result<Option<RawEntry>> {
        let Some(header) = self.next_block() else {
            // EOF at a block boundary (possibly with a short trailing
            // fragment of zeros) ends the archive.
            if self.bytes[self.pos..].iter().all(|&b| b == 0) {
                return Ok(None);
            }
            return Err(SkillflagError::new("Unexpected end of tar data."));
        };
        if header.iter().all(|&b| b == 0) {
            return Ok(None);
        }
        verify_checksum(header)?;

        let mut name = nul_terminated_str(&header[..100]);
        let prefix = nul_terminated_str(&header[345..500]);
        if !prefix.is_empty() {
            name = format!("{prefix}/{name}");
        }
        let size = parse_octal(&header[124..136])? as usize;
        let typeflag = header[156];

        let mut data = Vec::with_capacity(size);
        let mut remaining = size;
        while remaining > 0 {
            let block = self
                .next_block()
                .ok_or_else(|| SkillflagError::new("Unexpected end of tar data."))?;
            let take = remaining.min(BLOCK);
            data.extend_from_slice(&block[..take]);
            remaining -= take;
        }

        Ok(Some(RawEntry {
            name,
            typeflag,
            data,
        }))
    }
}

/// Extract a skill tar into a fresh temp dir; returns the extracted skill
/// root (`<temp_dir>/<top-level-dir>`).
pub fn extract_skill_tar_to_temp(tar_bytes: &[u8], temp_dir: &Path) -> Result<PathBuf> {
    let mut reader = TarReader::new(tar_bytes);
    let mut root_name: Option<String> = None;
    let mut global_pax: HashMap<String, String> = HashMap::new();
    let mut next_pax: Option<HashMap<String, String>> = None;
    let mut next_long_name: Option<String> = None;

    while let Some(entry) = reader.next_entry()? {
        match entry.typeflag {
            b'x' => {
                next_pax = Some(parse_pax_records(&entry.data)?);
                continue;
            }
            b'g' => {
                global_pax.extend(parse_pax_records(&entry.data)?);
                continue;
            }
            b'L' => {
                let name = nul_terminated_str(&entry.data);
                next_long_name = Some(name);
                continue;
            }
            b'K' => {
                // GNU long linkname; link entries are rejected below anyway.
                continue;
            }
            _ => {}
        }

        let pax = next_pax.take();
        let long_name = next_long_name.take();
        let raw_name = pax
            .as_ref()
            .and_then(|records| records.get("path").cloned())
            .or(long_name)
            .or_else(|| global_pax.get("path").cloned())
            .unwrap_or(entry.name);

        if raw_name.is_empty() || raw_name.contains('\\') {
            return Err(SkillflagError::new(format!(
                "Invalid path in tar: {raw_name}"
            )));
        }
        let name = raw_name.strip_suffix('/').unwrap_or(&raw_name);
        if name.is_empty() || is_invalid_rel_path(name) {
            return Err(SkillflagError::new(format!(
                "Invalid path in tar: {raw_name}"
            )));
        }

        let (top, rel_path) = match name.split_once('/') {
            Some((top, rest)) => (top, rest),
            None => (name, ""),
        };
        match &root_name {
            None => root_name = Some(top.to_string()),
            Some(existing) if existing != top => {
                return Err(SkillflagError::new(
                    "Tar must contain a single top-level directory.",
                ));
            }
            Some(_) => {}
        }

        let abs_path = if rel_path.is_empty() {
            temp_dir.join(top)
        } else {
            let mut path = temp_dir.join(top);
            for part in rel_path.split('/') {
                path.push(part);
            }
            path
        };

        match entry.typeflag {
            b'5' => {
                fs::create_dir_all(&abs_path)?;
            }
            b'0' | 0 => {
                if rel_path.is_empty() {
                    return Err(SkillflagError::new(
                        "Tar must contain a single top-level directory.",
                    ));
                }
                if let Some(parent) = abs_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&abs_path, &entry.data)?;
            }
            other => {
                return Err(SkillflagError::new(format!(
                    "Unsupported tar entry type: {}",
                    type_name(other)
                )));
            }
        }
    }

    match root_name {
        Some(root) => Ok(temp_dir.join(root)),
        None => Err(SkillflagError::new("Tar stream was empty.")),
    }
}
