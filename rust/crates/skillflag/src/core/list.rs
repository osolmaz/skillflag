use std::fs;

use crate::bundled;
use crate::core::digest::digest_sha256;
use crate::core::errors::Result;
use crate::core::paths::{list_skill_dirs, SkillDirRef, SkillsRoot};
use crate::core::tar::{collect_skill_entries, write_tar};
use crate::frontmatter::parse_frontmatter;

#[derive(Debug, Clone)]
pub struct SkillInfo {
    pub id: String,
    pub dir: SkillDirRef,
    pub summary: Option<String>,
    pub version: Option<String>,
}

fn skill_md_text(dir: &SkillDirRef) -> Option<String> {
    match dir {
        SkillDirRef::Disk(path) => fs::read_to_string(path.join("SKILL.md")).ok(),
        SkillDirRef::Bundled(id) => bundled::skill_md(id).map(str::to_string),
    }
}

fn read_skill_info(id: String, dir: SkillDirRef) -> SkillInfo {
    let Some(content) = skill_md_text(&dir) else {
        return SkillInfo {
            id,
            dir,
            summary: None,
            version: None,
        };
    };
    let fields = parse_frontmatter(&content);
    let summary = fields
        .get("description")
        .map(|d| d.replace(['\t', '\n'], " ").trim().to_string())
        .filter(|s| !s.is_empty());
    let version = fields.get("version").cloned().filter(|v| !v.is_empty());
    SkillInfo {
        id,
        dir,
        summary,
        version,
    }
}

/// List skills across roots, sorted byte-wise by id. When the same id exists
/// in several roots, the FIRST root wins.
pub fn list_skills(roots: &[SkillsRoot]) -> Vec<SkillInfo> {
    let mut seen: Vec<(String, SkillDirRef)> = Vec::new();
    for root in roots {
        for (id, dir) in list_skill_dirs(root) {
            if !seen.iter().any(|(seen_id, _)| *seen_id == id) {
                seen.push((id, dir));
            }
        }
    }

    let mut infos: Vec<SkillInfo> = seen
        .into_iter()
        .map(|(id, dir)| read_skill_info(id, dir))
        .collect();
    infos.sort_by(|a, b| a.id.cmp(&b.id));
    infos
}

/// Escape a string the way `JSON.stringify` does.
fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Build the compact `list --json` payload (no trailing newline; fixed key
/// order: id, digest, files, summary, version; optional fields omitted).
pub fn list_skills_json(roots: &[SkillsRoot]) -> Result<String> {
    let skills = list_skills(roots);
    let mut items: Vec<String> = Vec::with_capacity(skills.len());
    for skill in &skills {
        let collected = collect_skill_entries(&skill.dir, &skill.id)?;
        let tar = write_tar(&collected.entries)?;
        let digest = digest_sha256(&tar);

        let mut item = format!(
            "{{\"id\":{},\"digest\":{}",
            json_string(&skill.id),
            json_string(&digest)
        );
        if collected.file_count > 0 {
            item.push_str(&format!(",\"files\":{}", collected.file_count));
        }
        if let Some(summary) = &skill.summary {
            item.push_str(&format!(",\"summary\":{}", json_string(summary)));
        }
        if let Some(version) = &skill.version {
            item.push_str(&format!(",\"version\":{}", json_string(version)));
        }
        item.push('}');
        items.push(item);
    }
    Ok(format!(
        "{{\"skillflag_version\":\"0.1\",\"skills\":[{}]}}",
        items.join(",")
    ))
}

#[cfg(test)]
mod tests {
    use super::json_string;

    #[test]
    fn json_string_escapes_like_json_stringify() {
        assert_eq!(json_string("plain"), "\"plain\"");
        assert_eq!(json_string("a\"b\\c"), "\"a\\\"b\\\\c\"");
        assert_eq!(
            json_string("tab\tnl\ncr\rbs\u{8}ff\u{c}"),
            "\"tab\\tnl\\ncr\\rbs\\bff\\f\""
        );
        assert_eq!(json_string("\u{1}\u{1f}"), "\"\\u0001\\u001f\"");
        assert_eq!(json_string("ünïcode"), "\"ünïcode\"");
    }
}
