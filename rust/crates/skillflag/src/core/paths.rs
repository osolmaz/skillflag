use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::bundled;
use crate::core::errors::{Result, SkillflagError};

/// A skills root: either a directory on disk or the virtual bundled root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillsRoot {
    Dir(PathBuf),
    Bundled,
}

/// A resolved skill directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillDirRef {
    Disk(PathBuf),
    /// Skill id inside the bundled root.
    Bundled(String),
}

const PRODUCER_SKILLS_ROOTS: [&[&str]; 2] = [&["skills"], &[".agents", "skills"]];

/// Lexically normalize a path: resolve `.` and `..` components without
/// touching the filesystem (mirrors Node's `path.resolve` semantics).
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(name) => out.push(name),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    }
}

/// Resolve `path` against `cwd` (when relative) and normalize lexically.
pub fn resolve_path(cwd: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        normalize(path)
    } else {
        normalize(&cwd.join(path))
    }
}

/// Resolve and dedupe skills roots, preserving order.
pub fn resolve_skills_roots(roots: &[PathBuf], cwd: &Path) -> Vec<PathBuf> {
    let mut resolved: Vec<PathBuf> = Vec::new();
    for root in roots {
        let root = resolve_path(cwd, root);
        if !resolved.contains(&root) {
            resolved.push(root);
        }
    }
    resolved
}

fn existing_producer_roots(dir: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for segments in PRODUCER_SKILLS_ROOTS {
        let mut candidate = dir.to_path_buf();
        for segment in segments {
            candidate.push(segment);
        }
        if candidate.is_dir() {
            roots.push(candidate);
        }
    }
    roots
}

/// Walk upward from `start` looking for `skills/` then `.agents/skills/`
/// directories. Returns every root found at the first ancestor that has any.
pub fn find_skills_roots(start: impl AsRef<Path>) -> Result<Vec<PathBuf>> {
    let start = start.as_ref();
    let mut current = std::path::absolute(start).unwrap_or_else(|_| start.to_path_buf());
    let is_dir = fs::metadata(&current).map(|m| m.is_dir()).unwrap_or(false);
    if !is_dir {
        if let Some(parent) = current.parent() {
            current = parent.to_path_buf();
        }
    }

    loop {
        let roots = existing_producer_roots(&current);
        if !roots.is_empty() {
            return Ok(roots);
        }
        match current.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => current = parent.to_path_buf(),
            _ => {
                return Err(SkillflagError::new(
                    "Could not find a skills/ or .agents/skills/ directory. Pass skillsRoot explicitly.",
                ))
            }
        }
    }
}

/// First root returned by [`find_skills_roots`].
pub fn find_skills_root(start: impl AsRef<Path>) -> Result<PathBuf> {
    Ok(find_skills_roots(start)?.remove(0))
}

pub fn assert_valid_skill_id(id: &str) -> Result<()> {
    if id.is_empty() || id == "." || id == ".." {
        return Err(SkillflagError::new("Skill id is required."));
    }
    if id.contains('/') || id.contains('\\') {
        return Err(SkillflagError::new(format!("Invalid skill id: {id}")));
    }
    Ok(())
}

/// List skill directories (id + location) under one root, sorted by id.
pub fn list_skill_dirs(root: &SkillsRoot) -> Vec<(String, SkillDirRef)> {
    match root {
        SkillsRoot::Bundled => bundled::skill_ids()
            .into_iter()
            .map(|id| (id.to_string(), SkillDirRef::Bundled(id.to_string())))
            .collect(),
        SkillsRoot::Dir(dir) => {
            let Ok(read_dir) = fs::read_dir(dir) else {
                return Vec::new();
            };
            let mut skills = Vec::new();
            for entry in read_dir.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if !file_type.is_dir() {
                    continue;
                }
                let Ok(id) = entry.file_name().into_string() else {
                    continue;
                };
                let skill_dir = entry.path();
                if skill_dir.join("SKILL.md").exists() {
                    skills.push((id, SkillDirRef::Disk(skill_dir)));
                }
            }
            skills.sort_by(|a, b| a.0.cmp(&b.0));
            skills
        }
    }
}

/// Resolve a skill id against roots in order; the first root wins.
pub fn resolve_skill_dir_from_roots(roots: &[SkillsRoot], id: &str) -> Result<SkillDirRef> {
    assert_valid_skill_id(id)?;
    for root in roots {
        match root {
            SkillsRoot::Dir(dir) => {
                let skill_dir = dir.join(id);
                if skill_dir.join("SKILL.md").exists() {
                    return Ok(SkillDirRef::Disk(skill_dir));
                }
            }
            SkillsRoot::Bundled => {
                if bundled::has_skill(id) {
                    return Ok(SkillDirRef::Bundled(id.to_string()));
                }
            }
        }
    }
    Err(SkillflagError::new(format!("Skill not found: {id}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_and_invalid_skill_ids() {
        assert!(assert_valid_skill_id("alpha").is_ok());
        for id in ["", ".", ".."] {
            assert_eq!(
                assert_valid_skill_id(id).unwrap_err().message,
                "Skill id is required."
            );
        }
        assert_eq!(
            assert_valid_skill_id("a/b").unwrap_err().message,
            "Invalid skill id: a/b"
        );
        assert_eq!(
            assert_valid_skill_id("a\\b").unwrap_err().message,
            "Invalid skill id: a\\b"
        );
    }

    #[test]
    fn normalize_resolves_dots() {
        assert_eq!(
            resolve_path(Path::new("/base"), Path::new("a/./b/../c")),
            PathBuf::from("/base/a/c")
        );
        assert_eq!(
            resolve_path(Path::new("/base"), Path::new("/abs/./x")),
            PathBuf::from("/abs/x")
        );
    }

    #[test]
    fn bundled_root_lists_bundled_skills() {
        let dirs = list_skill_dirs(&SkillsRoot::Bundled);
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0].0, "skillflag");
    }
}
