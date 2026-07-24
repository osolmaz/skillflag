package install

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/osolmaz/skillflag/go/internal/core"
)

// SkillMetadata is the minimal SKILL.md frontmatter the installer requires.
type SkillMetadata struct {
	Name        string
	Description string
}

// AssertSkillDir requires SKILL.md at the bundle root.
func AssertSkillDir(rootDir string) error {
	if _, err := os.Stat(filepath.Join(rootDir, "SKILL.md")); err != nil {
		return errors.New("SKILL.md not found in skill root.")
	}
	return nil
}

// ReadSkillMetadata reads and validates SKILL.md frontmatter.
func ReadSkillMetadata(rootDir string) (SkillMetadata, error) {
	content, err := os.ReadFile(filepath.Join(rootDir, "SKILL.md"))
	if err != nil {
		return SkillMetadata{}, err
	}
	fields := core.ParseFrontmatter(string(content))
	name := fields["name"]
	description := fields["description"]

	if name == "" {
		return SkillMetadata{}, errors.New("SKILL.md metadata is missing name.")
	}
	if description == "" {
		return SkillMetadata{}, errors.New("SKILL.md metadata is missing description.")
	}
	return SkillMetadata{Name: name, Description: description}, nil
}
