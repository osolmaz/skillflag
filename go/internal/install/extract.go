package install

import (
	"archive/tar"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func isInvalidTarRelPath(relPosix string) bool {
	if strings.HasPrefix(relPosix, "/") {
		return true
	}
	for _, part := range strings.Split(relPosix, "/") {
		if part == ".." || part == "" {
			return true
		}
	}
	return false
}

// tarTypeName maps archive/tar type flags to the tar-stream type names used
// in the reference implementation's error messages.
func tarTypeName(typeflag byte) string {
	switch typeflag {
	case tar.TypeReg, tar.TypeRegA:
		return "file"
	case tar.TypeLink:
		return "link"
	case tar.TypeSymlink:
		return "symlink"
	case tar.TypeChar:
		return "character-device"
	case tar.TypeBlock:
		return "block-device"
	case tar.TypeDir:
		return "directory"
	case tar.TypeFifo:
		return "fifo"
	case tar.TypeCont:
		return "contiguous-file"
	case tar.TypeXHeader:
		return "pax-header"
	case tar.TypeXGlobalHeader:
		return "pax-global-header"
	case tar.TypeGNULongName:
		return "gnu-long-name"
	case tar.TypeGNULongLink:
		return "gnu-long-link-path"
	default:
		return string(rune(typeflag))
	}
}

// ExtractSkillTarToTemp safely extracts a skill tar stream into tempDir and
// returns the extracted skill root directory. The stream must contain a
// single top-level directory; only regular files and directories are allowed.
// Nothing from the bundle is ever executed.
func ExtractSkillTarToTemp(r io.Reader, tempDir string) (string, error) {
	reader := tar.NewReader(r)
	rootName := ""

	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}

		rawName := header.Name
		if rawName == "" || strings.Contains(rawName, "\\") {
			return "", fmt.Errorf("Invalid path in tar: %s", rawName)
		}
		name := strings.TrimSuffix(rawName, "/")
		if name == "" || isInvalidTarRelPath(name) {
			return "", fmt.Errorf("Invalid path in tar: %s", rawName)
		}

		top, rel, _ := strings.Cut(name, "/")
		if rootName == "" {
			rootName = top
		}
		if rootName != top {
			return "", errors.New("Tar must contain a single top-level directory.")
		}

		absPath := filepath.Join(tempDir, top)
		if rel != "" {
			absPath = filepath.Join(absPath, filepath.FromSlash(rel))
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(absPath, 0o777); err != nil {
				return "", err
			}
		case tar.TypeReg:
			if rel == "" {
				return "", errors.New("Tar must contain a single top-level directory.")
			}
			if err := os.MkdirAll(filepath.Dir(absPath), 0o777); err != nil {
				return "", err
			}
			data, readErr := io.ReadAll(reader)
			if readErr != nil {
				return "", readErr
			}
			if err := os.WriteFile(absPath, data, 0o666); err != nil {
				return "", err
			}
		default:
			return "", fmt.Errorf("Unsupported tar entry type: %s", tarTypeName(header.Typeflag))
		}
	}

	if rootName == "" {
		return "", errors.New("Tar stream was empty.")
	}
	return filepath.Join(tempDir, rootName), nil
}
