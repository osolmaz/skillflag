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
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		switch {
		case entry.IsDir():
			if err := copyTree(srcPath, dstPath); err != nil {
				return err
			}
		case entry.Type()&os.ModeSymlink != 0:
			target, linkErr := os.Readlink(srcPath)
			if linkErr != nil {
				return linkErr
			}
			if err := os.Symlink(target, dstPath); err != nil {
				return err
			}
		default:
			info, infoErr := entry.Info()
			if infoErr != nil {
				return infoErr
			}
			data, readErr := os.ReadFile(srcPath)
			if readErr != nil {
				return readErr
			}
			if err := os.WriteFile(dstPath, data, info.Mode().Perm()); err != nil {
				return err
			}
			if err := os.Chmod(dstPath, info.Mode().Perm()); err != nil {
				return err
			}
		}
	}
	return nil
}
