package core

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"path"
	"sort"
	"strings"
)

// SkillInfo describes a discovered skill for listing.
type SkillInfo struct {
	ID      string
	Root    Root
	Summary string
	Version string
}

// SkillListJSONItem preserves the exact key order of the reference output.
type SkillListJSONItem struct {
	ID      string `json:"id"`
	Digest  string `json:"digest"`
	Files   int    `json:"files,omitempty"`
	Summary string `json:"summary,omitempty"`
	Version string `json:"version,omitempty"`
}

// SkillListJSON is the payload of `--skill list --json`.
type SkillListJSON struct {
	SkillflagVersion string              `json:"skillflag_version"`
	Skills           []SkillListJSONItem `json:"skills"`
}

var summaryReplacer = strings.NewReplacer("\t", " ", "\n", " ")

func readSkillInfo(root Root, id string) SkillInfo {
	info := SkillInfo{ID: id, Root: root}
	content, err := fs.ReadFile(root.FS, path.Join(id, "SKILL.md"))
	if err != nil {
		return info
	}
	fields := ParseFrontmatter(string(content))
	if description := fields["description"]; description != "" {
		info.Summary = strings.TrimSpace(summaryReplacer.Replace(description))
	}
	info.Version = fields["version"]
	return info
}

// ListSkills merges skills from every root (first root wins on duplicate ids)
// and returns them sorted byte-wise by id.
func ListSkills(roots []Root) []SkillInfo {
	type picked struct {
		id   string
		root Root
	}
	seen := map[string]bool{}
	var picks []picked
	for _, root := range roots {
		for _, ref := range ListSkillDirs(root) {
			if !seen[ref.ID] {
				seen[ref.ID] = true
				picks = append(picks, picked{id: ref.ID, root: root})
			}
		}
	}

	infos := make([]SkillInfo, 0, len(picks))
	for _, p := range picks {
		infos = append(infos, readSkillInfo(p.root, p.id))
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].ID < infos[j].ID })
	return infos
}

// ListSkillsJSON builds the JSON listing including per-skill digests.
func ListSkillsJSON(roots []Root) (SkillListJSON, error) {
	skills := ListSkills(roots)
	items := make([]SkillListJSONItem, 0, len(skills))

	for _, skill := range skills {
		skillFS, subErr := fs.Sub(skill.Root.FS, skill.ID)
		if subErr != nil {
			return SkillListJSON{}, subErr
		}
		entries, fileCount, err := CollectSkillEntries(skillFS, skill.ID, skill.Root.NormalizeModes)
		if err != nil {
			return SkillListJSON{}, err
		}
		digest, err := DigestSkill(skillFS, entries)
		if err != nil {
			return SkillListJSON{}, err
		}
		items = append(items, SkillListJSONItem{
			ID:      skill.ID,
			Digest:  digest,
			Files:   fileCount,
			Summary: skill.Summary,
			Version: skill.Version,
		})
	}

	return SkillListJSON{SkillflagVersion: "0.1", Skills: items}, nil
}

// MarshalListJSON renders the payload as compact JSON without HTML escaping
// and without a trailing newline, matching JSON.stringify byte-for-byte.
func MarshalListJSON(payload SkillListJSON) ([]byte, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}
