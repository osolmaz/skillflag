//! Skills bundled into the compiled binary/library.
//!
//! The bundled root behaves like a virtual skills directory. Entries use
//! normalized modes: 0644 for files and 0755 for directories, because the
//! embedding mechanism (`include_str!`) does not preserve on-disk modes.

/// One file bundled into the crate, addressed relative to the bundled
/// skills root (`<skill-id>/<relative-path>`, forward slashes).
pub struct BundledFile {
    pub path: &'static str,
    pub contents: &'static str,
}

/// Static table of bundled files. Add more entries here (and copy the files
/// under `crates/skillflag/skills/`) to bundle additional skills or assets.
pub const BUNDLED_FILES: &[BundledFile] = &[BundledFile {
    path: "skillflag/SKILL.md",
    contents: include_str!("../skills/skillflag/SKILL.md"),
}];

/// Sorted ids of bundled skills (top-level directories with a `SKILL.md`).
pub fn skill_ids() -> Vec<&'static str> {
    let mut ids: Vec<&'static str> = Vec::new();
    for file in BUNDLED_FILES {
        if let Some((top, rest)) = file.path.split_once('/') {
            if rest == "SKILL.md" && !ids.contains(&top) {
                ids.push(top);
            }
        }
    }
    ids.sort_unstable();
    ids
}

pub fn has_skill(id: &str) -> bool {
    skill_md(id).is_some()
}

/// Contents of `<id>/SKILL.md`, when the skill is bundled.
pub fn skill_md(id: &str) -> Option<&'static str> {
    BUNDLED_FILES.iter().find_map(|file| {
        let (top, rest) = file.path.split_once('/')?;
        (top == id && rest == "SKILL.md").then_some(file.contents)
    })
}

/// All bundled files that live under `<id>/`.
pub fn files_for(id: &str) -> Vec<&'static BundledFile> {
    BUNDLED_FILES
        .iter()
        .filter(|file| file.path.split_once('/').is_some_and(|(top, _)| top == id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_skillflag_skill_is_present() {
        assert_eq!(skill_ids(), vec!["skillflag"]);
        assert!(has_skill("skillflag"));
        assert!(!has_skill("nope"));
        assert!(skill_md("skillflag").unwrap().contains("name: skillflag"));
        assert_eq!(files_for("skillflag").len(), 1);
    }
}
