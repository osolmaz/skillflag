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

// tarTypeNames maps archive/tar type flags to the tar-stream type names used
// in the reference implementation's error messages.
var tarTypeNames = map[byte]string{
	tar.TypeReg:           "file",
	tar.TypeLink:          "link",
	tar.TypeSymlink:       "symlink",
	tar.TypeChar:          "character-device",
	tar.TypeBlock:         "block-device",
	tar.TypeDir:           "directory",
	tar.TypeFifo:          "fifo",
	tar.TypeCont:          "contiguous-file",
	tar.TypeXHeader:       "pax-header",
	tar.TypeXGlobalHeader: "pax-global-header",
	tar.TypeGNULongName:   "gnu-long-name",
	tar.TypeGNULongLink:   "gnu-long-link-path",
}

func tarTypeName(typeflag byte) string {
	if name, ok := tarTypeNames[typeflag]; ok {
		return name
	}
	return string(rune(typeflag))
}

// splitTarEntryName validates a raw tar entry name and splits it into the
// top-level directory and the remaining relative path.
func splitTarEntryName(rawName string) (top string, rel string, err error) {
	if rawName == "" || strings.Contains(rawName, "\\") {
		return "", "", fmt.Errorf("Invalid path in tar: %s", rawName)
	}
	name := strings.TrimSuffix(rawName, "/")
	if name == "" || isInvalidTarRelPath(name) {
		return "", "", fmt.Errorf("Invalid path in tar: %s", rawName)
	}
	top, rel, _ = strings.Cut(name, "/")
	return top, rel, nil
}

func extractTarEntry(header *tar.Header, reader *tar.Reader, absPath string, rel string) error {
	switch header.Typeflag {
	case tar.TypeDir:
		return os.MkdirAll(absPath, 0o777)
	case tar.TypeReg:
		if rel == "" {
			return errors.New("Tar must contain a single top-level directory.")
		}
		if err := os.MkdirAll(filepath.Dir(absPath), 0o777); err != nil {
			return err
		}
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		return os.WriteFile(absPath, data, 0o666)
	default:
		return fmt.Errorf("Unsupported tar entry type: %s", tarTypeName(header.Typeflag))
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

		top, rel, err := splitTarEntryName(header.Name)
		if err != nil {
			return "", err
		}
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
		if err := extractTarEntry(header, reader, absPath, rel); err != nil {
			return "", err
		}
	}

	if rootName == "" {
		return "", errors.New("Tar stream was empty.")
	}
	return filepath.Join(tempDir, rootName), nil
}
