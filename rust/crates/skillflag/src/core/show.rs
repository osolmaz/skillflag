use std::fs;

use crate::bundled;
use crate::core::errors::{Result, SkillflagError};
use crate::core::paths::SkillDirRef;

/// Raw bytes of the skill's `SKILL.md`, with nothing added.
pub fn skill_md_bytes(skill_dir: &SkillDirRef) -> Result<Vec<u8>> {
    match skill_dir {
        SkillDirRef::Disk(dir) => Ok(fs::read(dir.join("SKILL.md"))?),
        SkillDirRef::Bundled(id) => bundled::skill_md(id)
            .map(|content| content.as_bytes().to_vec())
            .ok_or_else(|| SkillflagError::new(format!("Skill not found: {id}"))),
    }
}
