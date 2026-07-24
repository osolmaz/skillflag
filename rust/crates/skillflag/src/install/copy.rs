use std::fs;
use std::path::Path;

use crate::core::errors::{Result, SkillflagError};

fn copy_tree(source: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if file_type.is_symlink() {
            #[cfg(unix)]
            {
                let link_target = fs::read_link(entry.path())?;
                std::os::unix::fs::symlink(link_target, &target)?;
            }
            #[cfg(not(unix))]
            {
                fs::copy(entry.path(), &target)?;
            }
        } else {
            // fs::copy preserves permissions (and therefore execute bits).
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Copy a skill directory into place. Fails when the destination exists
/// unless `force`, in which case the destination is removed and re-copied.
pub fn copy_skill_dir(source_dir: &Path, dest_dir: &Path, force: bool) -> Result<()> {
    if let Ok(metadata) = fs::symlink_metadata(dest_dir) {
        if !force {
            return Err(SkillflagError::new(format!(
                "Destination already exists: {}",
                dest_dir.display()
            )));
        }
        if metadata.is_dir() {
            fs::remove_dir_all(dest_dir)?;
        } else {
            fs::remove_file(dest_dir)?;
        }
    }

    if let Some(parent) = dest_dir.parent() {
        fs::create_dir_all(parent)?;
    }
    copy_tree(source_dir, dest_dir)
}
