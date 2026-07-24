//! Minimal frontmatter parser (deliberately NOT full YAML).
//!
//! Ports `typescript/src/shared/frontmatter.ts` exactly, including the
//! backtracking behavior of the reference regex
//! `^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)`.

use std::collections::HashMap;

fn is_js_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

/// Find the end index (exclusive) of the frontmatter block starting at
/// `start`: the first position `p >= start` where `\r?\n---` follows and the
/// closing `---` is followed by a newline or the end of input.
fn find_block_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut p = start;
    while p < bytes.len() {
        let after_newline = if bytes[p] == b'\r' && bytes.get(p + 1) == Some(&b'\n') {
            Some(p + 2)
        } else if bytes[p] == b'\n' {
            Some(p + 1)
        } else {
            None
        };
        if let Some(dash_start) = after_newline {
            if bytes[dash_start..].starts_with(b"---") {
                let tail = &bytes[dash_start + 3..];
                if tail.is_empty() || tail.starts_with(b"\n") || tail.starts_with(b"\r\n") {
                    return Some(p);
                }
            }
        }
        p += 1;
    }
    None
}

/// Extract the raw frontmatter block, or `None` when the content has none.
fn frontmatter_block(content: &str) -> Option<&str> {
    let bytes = content.as_bytes();
    if !content.starts_with("---") {
        return None;
    }
    // Whitespace run right after the opening `---` (matches the regex `\s*`).
    let mut run_end = 3;
    while run_end < bytes.len() && is_js_whitespace(bytes[run_end]) {
        run_end += 1;
    }
    // The block starts after a newline inside that run; the regex backtracks
    // from the last newline towards the first until the rest matches.
    for q in (3..run_end).rev() {
        if bytes[q] != b'\n' {
            continue;
        }
        let block_start = q + 1;
        if let Some(block_end) = find_block_end(bytes, block_start) {
            return Some(&content[block_start..block_end]);
        }
    }
    None
}

fn strip_yaml_quotes(value: &str) -> &str {
    let quoted = (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''));
    if quoted {
        if value.len() >= 2 {
            value[1..value.len() - 1].trim()
        } else {
            ""
        }
    } else {
        value
    }
}

/// Parse `key: value` lines out of the frontmatter block. Each line is split
/// at the FIRST `:`; keys and values are trimmed; one pair of matching
/// surrounding quotes is stripped from the value (then trimmed again); lines
/// without a `:` or with an empty key/value are skipped.
pub fn parse_frontmatter(content: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    let Some(block) = frontmatter_block(content) else {
        return fields;
    };

    for line in block.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.trim().is_empty() {
            continue;
        }
        let Some(idx) = line.find(':') else {
            continue;
        };
        let key = line[..idx].trim();
        let value = strip_yaml_quotes(line[idx + 1..].trim());
        if !key.is_empty() && !value.is_empty() {
            fields.insert(key.to_string(), value.to_string());
        }
    }

    fields
}

#[cfg(test)]
mod tests {
    use super::parse_frontmatter;

    #[test]
    fn parses_basic_fields() {
        let fields =
            parse_frontmatter("---\nname: alpha\ndescription: Alpha test skill\n---\n\nBody.\n");
        assert_eq!(fields.get("name").unwrap(), "alpha");
        assert_eq!(fields.get("description").unwrap(), "Alpha test skill");
    }

    #[test]
    fn parses_crlf_content() {
        let fields = parse_frontmatter("---\r\nname: a\r\ndescription: d\r\n---\r\nbody");
        assert_eq!(fields.get("name").unwrap(), "a");
        assert_eq!(fields.get("description").unwrap(), "d");
    }

    #[test]
    fn strips_matching_quotes_only() {
        let fields = parse_frontmatter("---\na: \"quoted\"\nb: 'single'\nc: \"mismatched'\n---\n");
        assert_eq!(fields.get("a").unwrap(), "quoted");
        assert_eq!(fields.get("b").unwrap(), "single");
        assert_eq!(fields.get("c").unwrap(), "\"mismatched'");
    }

    #[test]
    fn splits_at_first_colon() {
        let fields = parse_frontmatter("---\nurl: https://example.com\n---\n");
        assert_eq!(fields.get("url").unwrap(), "https://example.com");
    }

    #[test]
    fn skips_lines_without_colon_or_empty_parts() {
        let fields = parse_frontmatter("---\nnovalue:\n: nokey\nplain line\nok: yes\n---\n");
        assert_eq!(fields.len(), 1);
        assert_eq!(fields.get("ok").unwrap(), "yes");
    }

    #[test]
    fn returns_empty_without_frontmatter() {
        assert!(parse_frontmatter("# Title\n\nBody.").is_empty());
        assert!(parse_frontmatter("").is_empty());
        assert!(parse_frontmatter("--\nname: x\n---\n").is_empty());
    }

    #[test]
    fn returns_empty_for_unterminated_block() {
        assert!(parse_frontmatter("---\nname: x\n").is_empty());
        assert!(parse_frontmatter("---\nname: x\n--- trailing\n").is_empty());
    }

    #[test]
    fn allows_trailing_spaces_after_opening_fence() {
        let fields = parse_frontmatter("---   \nname: x\n---\n");
        assert_eq!(fields.get("name").unwrap(), "x");
    }

    #[test]
    fn closing_fence_at_end_of_input_without_newline() {
        let fields = parse_frontmatter("---\nname: x\n---");
        assert_eq!(fields.get("name").unwrap(), "x");
    }

    #[test]
    fn empty_block_between_fences() {
        assert!(parse_frontmatter("---\n---\n").is_empty());
        assert!(parse_frontmatter("---\n\n---\n").is_empty());
    }

    #[test]
    fn blank_lines_inside_block_are_skipped() {
        let fields = parse_frontmatter("---\nname: x\n\nversion: 1.0.0\n---\n");
        assert_eq!(fields.get("name").unwrap(), "x");
        assert_eq!(fields.get("version").unwrap(), "1.0.0");
    }

    #[test]
    fn later_duplicate_keys_win() {
        let fields = parse_frontmatter("---\nname: first\nname: second\n---\n");
        assert_eq!(fields.get("name").unwrap(), "second");
    }
}
