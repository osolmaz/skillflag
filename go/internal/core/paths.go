package core

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

// Root is a skills root the producer core can enumerate and export from.
// Disk roots and the embedded bundled root share this abstraction via io/fs.
type Root struct {
	// FS is rooted at the skills root; each immediate subdirectory that
	// contains a SKILL.md is a skill.
	FS fs.FS
	// Key identifies the root for deduplication (absolute path for disk
	// roots, a synthetic marker for embedded roots).
	Key string
	// NormalizeModes forces tar entry modes to 0644/0755 for roots whose
	// backing store loses real file modes (e.g. go:embed).
	NormalizeModes bool
}

// DiskRoot builds a Root backed by the OS filesystem. dir should be absolute.
func DiskRoot(dir string) Root {
	return Root{FS: os.DirFS(dir), Key: dir}
}

// SkillRef is a discovered skill directory inside a Root.
type SkillRef struct {
	ID   string
	Root Root
}

var producerSkillsRoots = []string{"skills", filepath.Join(".agents", "skills")}

// FindSkillsRoots walks upward from start (a file or directory path) looking
// for skills/ then .agents/skills/ directories, returning every root found in
// the first ancestor directory that has any.
func FindSkillsRoots(start string) ([]string, error) {
	current, err := filepath.Abs(start)
	if err != nil {
		return nil, err
	}
	if info, statErr := os.Stat(current); statErr != nil || !info.IsDir() {
		current = filepath.Dir(current)
	}

	for {
		var roots []string
		for _, rel := range producerSkillsRoots {
			candidate := filepath.Join(current, rel)
			if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
				roots = append(roots, candidate)
			}
		}
		if len(roots) > 0 {
			return roots, nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			return nil, errors.New(
				"Could not find a skills/ or .agents/skills/ directory. Pass skillsRoot explicitly.",
			)
		}
		current = parent
	}
}

// FindSkillsRoot returns the first root found by FindSkillsRoots.
func FindSkillsRoot(start string) (string, error) {
	roots, err := FindSkillsRoots(start)
	if err != nil {
		return "", err
	}
	return roots[0], nil
}

// AssertValidSkillID validates a user-supplied skill id.
func AssertValidSkillID(id string) error {
	if id == "" || id == "." || id == ".." {
		return errors.New("Skill id is required.")
	}
	if strings.Contains(id, "/") || strings.Contains(id, "\\") {
		return fmt.Errorf("Invalid skill id: %s", id)
	}
	return nil
}

// ListSkillDirs enumerates skill directories directly under a root, sorted
// byte-wise by id. A missing/unreadable root yields no skills.
func ListSkillDirs(root Root) []SkillRef {
	dirents, err := fs.ReadDir(root.FS, ".")
	if err != nil {
		return nil
	}

	var skills []SkillRef
	for _, dirent := range dirents {
		if !dirent.IsDir() {
			continue
		}
		id := dirent.Name()
		if _, statErr := fs.Stat(root.FS, path.Join(id, "SKILL.md")); statErr == nil {
			skills = append(skills, SkillRef{ID: id, Root: root})
		}
	}

	sort.Slice(skills, func(i, j int) bool { return skills[i].ID < skills[j].ID })
	return skills
}

// ResolveSkillFS finds the first root containing the skill and returns a
// filesystem rooted at the skill directory plus whether modes must be
// normalized.
func ResolveSkillFS(roots []Root, id string) (fs.FS, bool, error) {
	if err := AssertValidSkillID(id); err != nil {
		return nil, false, err
	}
	for _, root := range roots {
		if _, err := fs.Stat(root.FS, path.Join(id, "SKILL.md")); err == nil {
			sub, subErr := fs.Sub(root.FS, id)
			if subErr != nil {
				return nil, false, subErr
			}
			return sub, root.NormalizeModes, nil
		}
	}
	return nil, false, fmt.Errorf("Skill not found: %s", id)
}
