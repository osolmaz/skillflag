package core

import (
	"fmt"
	"io/fs"
	"sort"
	"strings"
)

// TarEntry is one entry of the deterministic export stream.
type TarEntry struct {
	// Name is the full tar entry name (directories end with "/").
	Name string
	// IsDir marks directory entries.
	IsDir bool
	// Mode is the permission bits to encode (already masked with 0o777).
	Mode int64
	// Size is the file size in bytes (0 for directories).
	Size int64
	// Rel is the path of the entry within the skill filesystem ("." for the
	// skill root directory).
	Rel string
}

func isInvalidExportRelPath(relPosix string) bool {
	if strings.HasPrefix(relPosix, "/") {
		return true
	}
	for _, part := range strings.Split(relPosix, "/") {
		if part == ".." {
			return true
		}
	}
	return false
}

// CollectSkillEntries walks a skill directory and returns its tar entries
// sorted byte-wise by entry name, plus the number of regular files.
func CollectSkillEntries(skillFS fs.FS, id string, normalizeModes bool) ([]TarEntry, int, error) {
	var dirRels []string
	var files []TarEntry

	var walk func(rel string) error
	walk = func(rel string) error {
		dirRels = append(dirRels, rel)
		dirPath := "."
		if rel != "" {
			dirPath = rel
		}
		dirents, err := fs.ReadDir(skillFS, dirPath)
		if err != nil {
			return err
		}

		for _, dirent := range dirents {
			name := dirent.Name()
			relChild := name
			if rel != "" {
				relChild = rel + "/" + name
			}

			if isInvalidExportRelPath(relChild) {
				return fmt.Errorf("Invalid path in skill: %s/%s", id, relChild)
			}

			switch {
			case dirent.IsDir():
				if err := walk(relChild); err != nil {
					return err
				}
			case dirent.Type().IsRegular():
				info, infoErr := dirent.Info()
				if infoErr != nil {
					return infoErr
				}
				mode := int64(info.Mode().Perm())
				if normalizeModes {
					mode = 0o644
				}
				files = append(files, TarEntry{
					Name: id + "/" + relChild,
					Mode: mode,
					Size: info.Size(),
					Rel:  relChild,
				})
			case dirent.Type()&fs.ModeSymlink != 0:
				return fmt.Errorf("Symlinks are not supported in skill bundles: %s/%s", id, relChild)
			default:
				return fmt.Errorf("Unsupported file type in skill bundle: %s/%s", id, relChild)
			}
		}
		return nil
	}

	if err := walk(""); err != nil {
		return nil, 0, err
	}

	entries := make([]TarEntry, 0, len(dirRels)+len(files))
	for _, rel := range dirRels {
		statPath := "."
		name := id + "/"
		if rel != "" {
			statPath = rel
			name = id + "/" + rel + "/"
		}
		mode := int64(0o755)
		if !normalizeModes {
			info, err := fs.Stat(skillFS, statPath)
			if err != nil {
				return nil, 0, err
			}
			mode = int64(info.Mode().Perm())
		}
		entries = append(entries, TarEntry{Name: name, IsDir: true, Mode: mode, Rel: statPath})
	}
	entries = append(entries, files...)

	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	return entries, len(files), nil
}
