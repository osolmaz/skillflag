package install

import (
	"fmt"
	"os"
	"path/filepath"
)

// CopySkillDir copies the skill tree to destDir. An existing destination is
// an error unless force is set (then it is removed first). Execute bits are
// preserved.
func CopySkillDir(sourceDir string, destDir string, force bool) error {
	if _, err := os.Lstat(destDir); err == nil {
		if !force {
			return fmt.Errorf("Destination already exists: %s", destDir)
		}
		if err := os.RemoveAll(destDir); err != nil {
			return err
		}
	}

	if err := os.MkdirAll(filepath.Dir(destDir), 0o777); err != nil {
		return err
	}
	return copyTree(sourceDir, destDir)
}

func copyTree(src string, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
	if err := os.Mkdir(dst, srcInfo.Mode().Perm()); err != nil {
		return err
	}
	if err := os.Chmod(dst, srcInfo.Mode().Perm()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := copyEntry(entry, filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func copyEntry(entry os.DirEntry, srcPath string, dstPath string) error {
	switch {
	case entry.IsDir():
		return copyTree(srcPath, dstPath)
	case entry.Type()&os.ModeSymlink != 0:
		target, err := os.Readlink(srcPath)
		if err != nil {
			return err
		}
		return os.Symlink(target, dstPath)
	default:
		return copyFilePreservingMode(entry, srcPath, dstPath)
	}
}

func copyFilePreservingMode(entry os.DirEntry, srcPath string, dstPath string) error {
	info, err := entry.Info()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(srcPath)
	if err != nil {
		return err
	}
	// #nosec G703 -- dstPath is built from the resolved install destination
	// plus directory entry names of a validated source tree; tar input has
	// already been checked against traversal and absolute paths.
	if err := os.WriteFile(dstPath, data, info.Mode().Perm()); err != nil {
		return err
	}
	return os.Chmod(dstPath, info.Mode().Perm())
}
