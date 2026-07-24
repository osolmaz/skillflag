package core

import (
	"regexp"
	"strings"
)

// frontmatterRe mirrors the reference implementation's regex:
// /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
var frontmatterRe = regexp.MustCompile(`^---\s*\r?` + "\n" + `([\s\S]*?)\r?` + "\n" + `---(?:\r?` + "\n" + `|$)`)

var lineSplitRe = regexp.MustCompile(`\r?\n`)

func stripYamlQuotes(value string) string {
	if (strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`)) ||
		(strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'")) {
		if len(value) < 2 {
			// A lone quote character: JS "\"".slice(1, -1) yields "".
			return ""
		}
		return strings.TrimSpace(value[1 : len(value)-1])
	}
	return value
}

// ParseFrontmatter extracts the minimal key/value frontmatter block from a
// SKILL.md document. This deliberately is NOT a full YAML parser; it ports
// typescript/src/shared/frontmatter.ts exactly.
func ParseFrontmatter(content string) map[string]string {
	fields := map[string]string{}

	match := frontmatterRe.FindStringSubmatch(content)
	if match == nil {
		return fields
	}

	for _, line := range lineSplitRe.Split(match[1], -1) {
		if strings.TrimSpace(line) == "" {
			continue
		}
		idx := strings.Index(line, ":")
		if idx == -1 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := stripYamlQuotes(strings.TrimSpace(line[idx+1:]))
		if key != "" && value != "" {
			fields[key] = value
		}
	}

	return fields
}
