//! Deterministic POSIX ustar writer.
//!
//! The byte layout is pinned by `docs/DETERMINISTIC_TAR.md`; every
//! implementation in the monorepo must emit byte-identical streams for the
//! same on-disk skill directory. Do NOT swap this for a tar library.

use std::fs;
use std::path::Path;

use crate::bundled;
use crate::core::errors::{Result, SkillflagError};
use crate::core::paths::SkillDirRef;

const BLOCK: usize = 512;

#[derive(Debug, Clone)]
pub struct TarEntry {
    /// Entry name with forward slashes; directories end with `/`.
    pub name: String,
    pub is_dir: bool,
    /// On-disk mode masked with 0o777 (normalized for bundled entries).
    pub mode: u32,
    /// File contents (empty for directories).
    pub data: Vec<u8>,
}

pub struct CollectedEntries {
    pub entries: Vec<TarEntry>,
    pub file_count: usize,
}

#[cfg(unix)]
fn mode_of(metadata: &fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o777
}

#[cfg(not(unix))]
fn mode_of(metadata: &fs::Metadata) -> u32 {
    if metadata.is_dir() {
        0o755
    } else {
        0o644
    }
}

fn is_invalid_rel_path(rel: &str) -> bool {
    rel.starts_with('/') || rel.split('/').any(|part| part == "..")
}

fn collect_dir(
    root: &Path,
    rel: &str,
    id: &str,
    dirs: &mut Vec<String>,
    files: &mut Vec<TarEntry>,
) -> Result<()> {
    dirs.push(rel.to_string());
    let abs_dir = if rel.is_empty() {
        root.to_path_buf()
    } else {
        let mut dir = root.to_path_buf();
        for part in rel.split('/') {
            dir.push(part);
        }
        dir
    };

    for entry in fs::read_dir(&abs_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel_child = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };

        if is_invalid_rel_path(&rel_child) {
            return Err(SkillflagError::new(format!(
                "Invalid path in skill: {id}/{rel_child}"
            )));
        }

        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_dir(root, &rel_child, id, dirs, files)?;
            continue;
        }
        if file_type.is_file() {
            let metadata = entry.metadata()?;
            files.push(TarEntry {
                name: format!("{id}/{rel_child}"),
                is_dir: false,
                mode: mode_of(&metadata),
                data: fs::read(entry.path())?,
            });
            continue;
        }
        if file_type.is_symlink() {
            return Err(SkillflagError::new(format!(
                "Symlinks are not supported in skill bundles: {id}/{rel_child}"
            )));
        }
        return Err(SkillflagError::new(format!(
            "Unsupported file type in skill bundle: {id}/{rel_child}"
        )));
    }

    Ok(())
}

fn collect_disk_entries(skill_dir: &Path, id: &str) -> Result<CollectedEntries> {
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<TarEntry> = Vec::new();
    collect_dir(skill_dir, "", id, &mut dirs, &mut files)?;

    let mut entries: Vec<TarEntry> = Vec::new();
    for rel in &dirs {
        let abs_dir = if rel.is_empty() {
            skill_dir.to_path_buf()
        } else {
            let mut dir = skill_dir.to_path_buf();
            for part in rel.split('/') {
                dir.push(part);
            }
            dir
        };
        let metadata = fs::metadata(&abs_dir)?;
        let name = if rel.is_empty() {
            format!("{id}/")
        } else {
            format!("{id}/{rel}/")
        };
        entries.push(TarEntry {
            name,
            is_dir: true,
            mode: mode_of(&metadata),
            data: Vec::new(),
        });
    }

    let file_count = files.len();
    entries.append(&mut files);
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(CollectedEntries {
        entries,
        file_count,
    })
}

fn collect_bundled_entries(id: &str) -> Result<CollectedEntries> {
    let files = bundled::files_for(id);
    if files.is_empty() {
        return Err(SkillflagError::new(format!("Skill not found: {id}")));
    }

    let mut dir_names: Vec<String> = vec![format!("{id}/")];
    let mut entries: Vec<TarEntry> = Vec::new();
    for file in &files {
        // Intermediate directories between the skill root and the file.
        let rel = &file.path[id.len() + 1..];
        let mut prefix = format!("{id}/");
        for part in rel.split('/').collect::<Vec<_>>().split_last().unwrap().1 {
            prefix.push_str(part);
            prefix.push('/');
            if !dir_names.contains(&prefix) {
                dir_names.push(prefix.clone());
            }
        }
        entries.push(TarEntry {
            name: file.path.to_string(),
            is_dir: false,
            mode: 0o644,
            data: file.contents.as_bytes().to_vec(),
        });
    }

    let file_count = entries.len();
    for name in dir_names {
        entries.push(TarEntry {
            name,
            is_dir: true,
            mode: 0o755,
            data: Vec::new(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(CollectedEntries {
        entries,
        file_count,
    })
}

/// Collect one entry per directory (including the skill root) and one per
/// regular file, sorted by entry name (byte-wise lexicographic).
pub fn collect_skill_entries(skill_dir: &SkillDirRef, id: &str) -> Result<CollectedEntries> {
    match skill_dir {
        SkillDirRef::Disk(dir) => collect_disk_entries(dir, id),
        SkillDirRef::Bundled(bundled_id) => {
            debug_assert_eq!(bundled_id, id);
            collect_bundled_entries(id)
        }
    }
}

/// Write `value` as 6 octal digits + space + NUL into an 8-byte field.
fn write_octal_8(field: &mut [u8], value: u32) {
    let digits = format!("{value:06o}");
    field[..6].copy_from_slice(digits.as_bytes());
    field[6] = b' ';
    field[7] = 0;
}

fn build_header(entry: &TarEntry) -> Result<[u8; BLOCK]> {
    let mut header = [0u8; BLOCK];
    let name = entry.name.as_bytes();
    if name.len() > 100 {
        return Err(SkillflagError::new(format!(
            "Tar entry name exceeds 100 bytes: {}",
            entry.name
        )));
    }
    header[..name.len()].copy_from_slice(name);
    write_octal_8(&mut header[100..108], entry.mode);
    write_octal_8(&mut header[108..116], 0); // uid
    write_octal_8(&mut header[116..124], 0); // gid
    let size = if entry.is_dir { 0 } else { entry.data.len() };
    header[124..136].copy_from_slice(format!("{size:011o} ").as_bytes());
    header[136..148].copy_from_slice(b"00000000000 "); // mtime: fixed epoch 0
    header[148..156].copy_from_slice(b"        "); // chksum placeholder
    header[156] = if entry.is_dir { b'5' } else { b'0' };
    header[257..263].copy_from_slice(b"ustar\0");
    header[263..265].copy_from_slice(b"00");
    write_octal_8(&mut header[329..337], 0); // devmajor
    write_octal_8(&mut header[337..345], 0); // devminor

    let checksum: u32 = header.iter().map(|&b| u32::from(b)).sum();
    let digits = format!("{checksum:06o}");
    header[148..154].copy_from_slice(digits.as_bytes());
    header[154] = b' ';
    header[155] = 0;
    Ok(header)
}

/// Serialize entries into the deterministic tar stream, including the two
/// 512-byte zero trailer blocks.
pub fn write_tar(entries: &[TarEntry]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    for entry in entries {
        out.extend_from_slice(&build_header(entry)?);
        if !entry.is_dir {
            out.extend_from_slice(&entry.data);
            let remainder = entry.data.len() % BLOCK;
            if remainder != 0 {
                out.resize(out.len() + BLOCK - remainder, 0);
            }
        }
    }
    out.resize(out.len() + 2 * BLOCK, 0);
    Ok(out)
}

/// Convenience: collect + serialize; returns the tar bytes and file count.
pub fn build_skill_tar(skill_dir: &SkillDirRef, id: &str) -> Result<(Vec<u8>, usize)> {
    let collected = collect_skill_entries(skill_dir, id)?;
    let tar = write_tar(&collected.entries)?;
    Ok((tar, collected.file_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, is_dir: bool, mode: u32, data: &[u8]) -> TarEntry {
        TarEntry {
            name: name.to_string(),
            is_dir,
            mode,
            data: data.to_vec(),
        }
    }

    #[test]
    fn header_layout_matches_contract() {
        let header = build_header(&entry("alpha/", true, 0o775, b"")).unwrap();
        assert_eq!(&header[..6], b"alpha/");
        assert_eq!(&header[100..108], b"000775 \0");
        assert_eq!(&header[108..116], b"000000 \0");
        assert_eq!(&header[116..124], b"000000 \0");
        assert_eq!(&header[124..136], b"00000000000 ");
        assert_eq!(&header[136..148], b"00000000000 ");
        assert_eq!(header[156], b'5');
        assert_eq!(&header[257..263], b"ustar\0");
        assert_eq!(&header[263..265], b"00");
        assert_eq!(&header[329..337], b"000000 \0");
        assert_eq!(&header[337..345], b"000000 \0");
        // Checksum: 6 octal digits + space + NUL.
        assert!(header[148..154].iter().all(u8::is_ascii_digit));
        assert_eq!(header[154], b' ');
        assert_eq!(header[155], 0);
    }

    #[test]
    fn file_data_is_padded_and_trailer_appended() {
        let tar = write_tar(&[entry("a/x", false, 0o644, b"hello\n")]).unwrap();
        assert_eq!(tar.len(), 512 + 512 + 1024);
        assert_eq!(&tar[512..518], b"hello\n");
        assert!(tar[518..1024].iter().all(|&b| b == 0));
        assert!(tar[1024..].iter().all(|&b| b == 0));
    }

    #[test]
    fn long_names_are_rejected() {
        let name = "a/".to_string() + &"x".repeat(120);
        let err = write_tar(&[entry(&name, false, 0o644, b"")]).unwrap_err();
        assert!(err.message.starts_with("Tar entry name exceeds 100 bytes:"));
    }

    #[test]
    fn bundled_entries_use_normalized_modes() {
        let collected = collect_bundled_entries("skillflag").unwrap();
        assert_eq!(collected.file_count, 1);
        let names: Vec<&str> = collected.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["skillflag/", "skillflag/SKILL.md"]);
        assert_eq!(collected.entries[0].mode, 0o755);
        assert_eq!(collected.entries[1].mode, 0o644);
    }
}
