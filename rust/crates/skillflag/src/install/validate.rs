use std::fs;
use std::path::Path;

use crate::core::errors::{Result, SkillflagError};
use crate::frontmatter::parse_frontmatter;

#[derive(Debug, Clone)]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
}

pub fn assert_skill_dir(root_dir: &Path) -> Result<()> {
    if root_dir.join("SKILL.md").exists() {
        Ok(())
    } else {
        Err(SkillflagError::new("SKILL.md not found in skill root."))
    }
}

pub fn read_skill_metadata(root_dir: &Path) -> Result<SkillMetadata> {
    let content = fs::read_to_string(root_dir.join("SKILL.md"))?;
    let fields = parse_frontmatter(&content);
    let name = fields
        .get("name")
        .cloned()
        .ok_or_else(|| SkillflagError::new("SKILL.md metadata is missing name."))?;
    let description = fields
        .get("description")
        .cloned()
        .ok_or_else(|| SkillflagError::new("SKILL.md metadata is missing description."))?;
    Ok(SkillMetadata { name, description })
}
