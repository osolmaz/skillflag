use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::core::errors::{Result, SkillflagError};
use crate::core::paths::resolve_path;
use crate::install::copy::copy_skill_dir;
use crate::install::extract::extract_skill_tar_to_temp;
use crate::install::resolve::{resolve_skills_root, EnvLookup};
use crate::install::validate::{assert_skill_dir, read_skill_metadata};

/// One install source: a skill directory or a buffered tar stream.
#[derive(Debug, Clone)]
pub enum InstallInput {
    Dir(PathBuf),
    Tar(Vec<u8>),
}

pub struct InstallOptions<'a> {
    pub agent: &'a str,
    pub scope: &'a str,
    pub cwd: &'a Path,
    pub force: bool,
    pub env: &'a dyn EnvLookup,
}

#[derive(Debug, Clone)]
pub struct InstallResult {
    pub skill_id: String,
    pub installed_to: PathBuf,
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn make_temp_dir() -> Result<PathBuf> {
    let base = std::env::temp_dir();
    for _ in 0..64 {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let candidate = base.join(format!(
            "skill-install-{}-{}-{nanos:09}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err.into()),
        }
    }
    Err(SkillflagError::new(
        "Could not create a temporary directory.",
    ))
}

struct TempDirGuard(PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Install one skill bundle into one agent/scope destination.
///
/// The destination directory name is the frontmatter `name` from `SKILL.md`
/// (NOT the source directory name).
pub fn install_skill(input: &InstallInput, options: &InstallOptions) -> Result<InstallResult> {
    let mut _temp_guard: Option<TempDirGuard> = None;
    let root_dir = match input {
        InstallInput::Dir(dir) => resolve_path(options.cwd, dir),
        InstallInput::Tar(bytes) => {
            let temp_dir = make_temp_dir()?;
            _temp_guard = Some(TempDirGuard(temp_dir.clone()));
            extract_skill_tar_to_temp(bytes, &temp_dir)?
        }
    };

    assert_skill_dir(&root_dir)?;
    let meta = read_skill_metadata(&root_dir)?;
    let skill_id = meta.name;

    let skills_root = resolve_skills_root(options.agent, options.scope, options.cwd, options.env)?;
    let dest_dir = skills_root.join(&skill_id);

    copy_skill_dir(&root_dir, &dest_dir, options.force)?;

    Ok(InstallResult {
        skill_id,
        installed_to: dest_dir,
    })
}
