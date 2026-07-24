package install

import (
	"bytes"
	"os"
	"path/filepath"
)

// Input is one install source: a skill directory or a buffered tar bundle.
type Input struct {
	// Dir, when non-empty, is a path to a directory containing SKILL.md.
	Dir string
	// Tar, when Dir is empty, holds the tar stream bytes.
	Tar []byte
}

// Result reports a completed install.
type Result struct {
	SkillID     string
	InstalledTo string
}

// InstallOptions selects the destination for InstallSkill.
type InstallOptions struct {
	Agent string
	Scope string
	Cwd   string
	Force bool
}

// InstallSkill installs one skill bundle into one agent/scope destination.
func InstallSkill(input Input, options InstallOptions) (Result, error) {
	var rootDir string
	if input.Dir != "" {
		rootDir = absAgainst(input.Dir, options.Cwd)
	} else {
		tempDir, err := os.MkdirTemp("", "skill-install-")
		if err != nil {
			return Result{}, err
		}
		defer os.RemoveAll(tempDir)
		rootDir, err = ExtractSkillTarToTemp(bytes.NewReader(input.Tar), tempDir)
		if err != nil {
			return Result{}, err
		}
	}

	if err := AssertSkillDir(rootDir); err != nil {
		return Result{}, err
	}
	meta, err := ReadSkillMetadata(rootDir)
	if err != nil {
		return Result{}, err
	}

	skillsRoot, err := ResolveSkillsRoot(options.Agent, options.Scope, options.Cwd)
	if err != nil {
		return Result{}, err
	}
	destDir := filepath.Join(skillsRoot, meta.Name)

	if err := CopySkillDir(rootDir, destDir, options.Force); err != nil {
		return Result{}, err
	}
	return Result{SkillID: meta.Name, InstalledTo: destDir}, nil
}

func absAgainst(path string, cwd string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	if cwd != "" {
		return filepath.Join(cwd, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return filepath.Clean(path)
	}
	return abs
}
