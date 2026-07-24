package core

import (
	"io"
	"io/fs"
)

// ShowSkill writes the raw SKILL.md bytes of a resolved skill to w.
func ShowSkill(skillFS fs.FS, w io.Writer) error {
	content, err := fs.ReadFile(skillFS, "SKILL.md")
	if err != nil {
		return err
	}
	_, err = w.Write(content)
	return err
}
